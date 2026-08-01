//! 自建服务器 API 通用模块
//!
//! 替代原来的 Supabase REST 直连，统一封装：
//! - 服务器地址（IP/域名）
//! - 通用 HTTP 客户端（自动携带 JWT Bearer token）
//! - 401 自动刷新 token 并重试
//!
//! 服务器端对接文档见 server-planning/API-implementation.md。

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use std::sync::atomic::AtomicBool;
use tokio::sync::Mutex;

/// 自建服务器地址（域名备案后替换）
pub const SERVER_URL: &str = "http://115.159.49.112";
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

/// 读取 access token
pub async fn get_access_token(store: &TokenStore) -> Option<String> {
    store.access_token.lock().await.clone()
}

/// 读取 refresh token
pub async fn get_refresh_token(store: &TokenStore) -> Option<String> {
    store.refresh_token.lock().await.clone()
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

/// 通用 GET 请求（带 token，无 token 时匿名请求）
///
/// 返回 `(状态码, 响应体文本)`。
pub async fn get(path: &str, token: Option<&str>) -> Result<(u16, String), String> {
    let client = reqwest::Client::new();
    let url = format!("{}{}", SERVER_URL, path);
    let resp = client
        .get(&url)
        .headers(build_headers(token))
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    Ok((status, body))
}

/// 通用 POST 请求（JSON body）
pub async fn post(
    path: &str,
    body: &serde_json::Value,
    token: Option<&str>,
) -> Result<(u16, String), String> {
    let client = reqwest::Client::new();
    let url = format!("{}{}", SERVER_URL, path);
    let resp = client
        .post(&url)
        .headers(build_headers(token))
        .json(body)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    Ok((status, body))
}

/// 通用 PUT 请求（JSON body）
pub async fn put(
    path: &str,
    body: &serde_json::Value,
    token: Option<&str>,
) -> Result<(u16, String), String> {
    let client = reqwest::Client::new();
    let url = format!("{}{}", SERVER_URL, path);
    let resp = client
        .put(&url)
        .headers(build_headers(token))
        .json(body)
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    Ok((status, body))
}

/// 通用 DELETE 请求
pub async fn delete(
    path: &str,
    token: Option<&str>,
) -> Result<(u16, String), String> {
    let client = reqwest::Client::new();
    let url = format!("{}{}", SERVER_URL, path);
    let resp = client
        .delete(&url)
        .headers(build_headers(token))
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    Ok((status, body))
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
}
