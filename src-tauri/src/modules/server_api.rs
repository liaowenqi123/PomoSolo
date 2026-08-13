//! 自建服务器 API 通用模块
//!
//! 替代原来的 Supabase REST 直连，统一封装：
//! - 服务器地址（IP/域名）
//! - 通用 HTTP 客户端（自动携带 JWT Bearer token）
//! - 401 自动刷新 token 并重试
//!
//! 服务器端对接文档见 server-planning/API-implementation.md。

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::Mutex;

/// 自建服务器地址（混合部署：API/WS/公告走 api.pomogrow.top，安装包下载仍走 GitHub CDN）
pub const SERVER_URL: &str = "https://api.pomogrow.top";
/// REST API 前缀
pub const API_BASE: &str = "/api/v1";

/// 全局 token 存储（登录成功后写入）
pub struct TokenStore {
    /// JWT access token
    pub access_token: Mutex<Option<String>>,
    /// refresh token（登出/刷新用）
    pub refresh_token: Mutex<Option<String>>,
    /// 是否正在刷新（避免并发刷新风暴）
    pub refreshing: AtomicBool,
}

impl TokenStore {
    pub fn new() -> Self {
        Self {
            access_token: Mutex::new(None),
            refresh_token: Mutex::new(None),
            refreshing: AtomicBool::new(false),
        }
    }
}

/// 更新 token（登录/刷新成功后调用）
pub async fn set_tokens(store: &TokenStore, access: &str, refresh: &str) {
    *store.access_token.lock().await = Some(access.to_string());
    *store.refresh_token.lock().await = Some(refresh.to_string());
}

/// 清空 token（登出时调用）
pub async fn clear_tokens(store: &TokenStore) {
    *store.access_token.lock().await = None;
    *store.refresh_token.lock().await = None;
}

/// 读取 refresh token
pub async fn get_refresh_token(store: &TokenStore) -> Option<String> {
    store.refresh_token.lock().await.clone()
}

/// 当前 unix 时间（秒）
fn now_unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 解析 JWT 的 `exp`（unix 秒）。非 JWT 或缺失返回 None。
///
/// JWT 结构：`header.payload.signature`，payload 为 base64url 编码的 JSON。
pub fn jwt_expiry(access: &str) -> Option<u64> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    let payload_part = access.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload_part).ok()?;
    let v: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    v.get("exp").and_then(|e| e.as_u64())
}

/// 解析 refresh 响应（纯函数，便于单测）。
/// 返回 `(new_access_token, 可选 new_refresh_token)`；滚动刷新时服务器会返回新 refresh token。
fn parse_refresh_response(body: &str) -> Option<(String, Option<String>)> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let access = v.get("access_token")?.as_str()?.to_string();
    let new_refresh = v
        .get("refresh_token")
        .and_then(|r| r.as_str())
        .map(|s| s.to_string());
    Some((access, new_refresh))
}

/// 使用 refresh token 刷新 access token（滚动刷新，成功后更新本地 tokens）
pub async fn refresh_access_token(store: &TokenStore) -> Result<String, String> {
    let refresh = get_refresh_token(store)
        .await
        .ok_or_else(|| "登录状态已失效，请重新登录".to_string())?;
    let body = serde_json::json!({ "refresh_token": refresh });
    let (status, resp_body) = post("/api/v1/auth/refresh", &body, None).await?;
    if status != 200 {
        return Err(format!("刷新登录态失败 (HTTP {})", status));
    }
    let (access, new_refresh) = parse_refresh_response(&resp_body)
        .ok_or_else(|| "刷新登录态失败：响应格式错误".to_string())?;
    if let Some(nr) = new_refresh {
        set_tokens(store, &access, &nr).await;
    } else {
        *store.access_token.lock().await = Some(access.clone());
    }
    Ok(access)
}

/// 读取当前 access token；若有效直接返回
async fn current_valid_token(store: &TokenStore) -> Option<String> {
    let guard = store.access_token.lock().await;
    let at = guard.as_ref()?;
    match jwt_expiry(at) {
        // 有效且剩余时间 > 60s → 直接使用（提前刷新，避免请求间隙过期）
        Some(exp) if exp.saturating_sub(now_unix_secs()) > 60 => Some(at.clone()),
        // 已过期/临近过期 → 需要刷新
        Some(_) => None,
        // 无 exp（格式异常）→ 原样返回，交由 401 兜底
        None => Some(at.clone()),
    }
}

/// 获取有效 access token：已过期/临近过期则自动用 refresh token 刷新。
///
/// 并发安全：多个调用方同时触发时只有一个执行刷新，其余等待其结果。
/// 刷新失败（如 refresh token 已失效）返回 None，调用方应提示重新登录。
pub async fn get_valid_access_token(store: &TokenStore) -> Option<String> {
    if let Some(at) = current_valid_token(store).await {
        return Some(at);
    }

    // 抢占刷新权；失败说明已有任务在刷新，等待其完成
    if store
        .refreshing
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            if let Some(at) = current_valid_token(store).await {
                return Some(at);
            }
            // 刷新方已释放：再尝试抢占并自己刷新（可能上一次刷新失败）
            if !store.refreshing.load(Ordering::Acquire)
                && store
                    .refreshing
                    .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
                    .is_ok()
            {
                break;
            }
            if tokio::time::Instant::now() >= deadline {
                return None;
            }
        }
    }

    let result = refresh_access_token(store).await;
    store.refreshing.store(false, Ordering::Release);
    result.ok()
}

/// 构造带 Bearer token 的请求头（无 token 时为空）
fn build_headers(token: Option<&str>) -> HeaderMap {
    let mut headers = HeaderMap::new();
    if let Some(t) = token {
        if let Ok(v) = HeaderValue::from_str(&format!("Bearer {}", t)) {
            headers.insert(AUTHORIZATION, v);
        }
    }
    headers
}

/// 统一 HTTP 请求实现：构造客户端 + 发送 + 读取状态码/响应体
async fn request(
    method: reqwest::Method,
    path: &str,
    body: Option<&serde_json::Value>,
    token: Option<&str>,
) -> Result<(u16, String), String> {
    let client = reqwest::Client::new();
    let url = format!("{}{}", SERVER_URL, path);
    let mut req = client
        .request(method, &url)
        .headers(build_headers(token))
        .timeout(std::time::Duration::from_secs(15));
    if let Some(b) = body {
        req = req.json(b);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    Ok((status, body))
}

/// 通用 GET 请求（带 token，无 token 时匿名请求）
///
/// 返回 `(状态码, 响应体文本)`。
pub async fn get(path: &str, token: Option<&str>) -> Result<(u16, String), String> {
    request(reqwest::Method::GET, path, None, token).await
}

/// 通用 POST 请求（JSON body）
pub async fn post(
    path: &str,
    body: &serde_json::Value,
    token: Option<&str>,
) -> Result<(u16, String), String> {
    request(reqwest::Method::POST, path, Some(body), token).await
}

/// 通用 PUT 请求（JSON body）
pub async fn put(
    path: &str,
    body: &serde_json::Value,
    token: Option<&str>,
) -> Result<(u16, String), String> {
    request(reqwest::Method::PUT, path, Some(body), token).await
}

/// 通用 DELETE 请求
pub async fn delete(
    path: &str,
    token: Option<&str>,
) -> Result<(u16, String), String> {
    request(reqwest::Method::DELETE, path, None, token).await
}

/// 从响应体中解析 JSON 值（失败返回错误信息）
pub fn parse_json(body: &str) -> Result<serde_json::Value, String> {
    serde_json::from_str(body).map_err(|e| format!("响应解析失败: {} (body: {})", e, truncate(body, 200)))
}

/// 截断长字符串（用于错误信息展示）
fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_server_url_is_valid() {
        assert!(SERVER_URL.starts_with("http://") || SERVER_URL.starts_with("https://"));
        assert!(API_BASE.starts_with('/'));
    }

    #[test]
    fn test_truncate_short_string() {
        assert_eq!(truncate("abc", 10), "abc");
    }

    #[test]
    fn test_truncate_long_string() {
        let long = "x".repeat(500);
        let t = truncate(&long, 200);
        assert_eq!(t.len(), 203); // 200 + "..."
        assert!(t.ends_with("..."));
    }

    #[test]
    fn test_parse_json_valid() {
        let v = parse_json(r#"{"ok": true}"#).expect("解析应成功");
        assert_eq!(v["ok"], serde_json::json!(true));
    }

    #[test]
    fn test_parse_json_invalid() {
        assert!(parse_json("not json").is_err());
    }

    // ===== JWT / token 刷新相关 =====

    /// 构造 JWT（payload 用 base64url 无 padding 编码），signature 随意
    fn make_jwt(payload: &serde_json::Value) -> String {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
        let payload_b64 = URL_SAFE_NO_PAD.encode(serde_json::to_vec(payload).unwrap());
        format!("header.{}.signature", payload_b64)
    }

    #[test]
    fn test_jwt_expiry_valid() {
        let token = make_jwt(&serde_json::json!({ "exp": 1750000000, "sub": "u1" }));
        assert_eq!(jwt_expiry(&token), Some(1750000000));
    }

    #[test]
    fn test_jwt_expiry_missing() {
        let token = make_jwt(&serde_json::json!({ "sub": "u1" }));
        assert_eq!(jwt_expiry(&token), None);
    }

    #[test]
    fn test_jwt_expiry_invalid_token() {
        assert_eq!(jwt_expiry("not-a-jwt"), None);
        assert_eq!(jwt_expiry("a.b.c"), None);
        assert_eq!(jwt_expiry(""), None);
    }

    #[test]
    fn test_parse_refresh_response_with_new_refresh() {
        let body = r#"{"access_token": "new-access", "refresh_token": "new-refresh"}"#;
        let parsed = parse_refresh_response(body).expect("解析应成功");
        assert_eq!(parsed.0, "new-access");
        assert_eq!(parsed.1.as_deref(), Some("new-refresh"));
    }

    #[test]
    fn test_parse_refresh_response_access_only() {
        let body = r#"{"access_token": "new-access"}"#;
        let parsed = parse_refresh_response(body).expect("解析应成功");
        assert_eq!(parsed.0, "new-access");
        assert_eq!(parsed.1, None);
    }

    #[test]
    fn test_parse_refresh_response_invalid() {
        assert!(parse_refresh_response("not json").is_none());
        assert!(parse_refresh_response(r#"{"error": "bad"}"#).is_none());
    }

    #[test]
    fn test_now_unix_secs_reasonable() {
        // 2026 年左右的 unix 时间应在 17 亿 ~ 18 亿之间
        let now = now_unix_secs();
        assert!(now > 1_700_000_000, "unix 时间应大于 2023-11");
    }
}
