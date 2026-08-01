//! 云端认证 commands
//!
//! 对接自建服务器 API（server-planning/API-implementation.md），
//! 替代原来的 Supabase REST 直连。
//!
//! 认证流程：
//! 1. 登录/注册 → 服务器返回 JWT access_token + refresh_token
//! 2. token 存于 AppState.tokens（内存），后续请求带 `Authorization: Bearer`
//! 3. 会话恢复：内存 token 无效时，用本地凭据（username+password）自动登录

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::modules::cloud_auth;
use crate::modules::data_manager;
use crate::modules::server_api;
use crate::state::AppState;

// ============ 本地凭据 commands ============

#[tauri::command]
pub async fn save_credentials(
    app: AppHandle,
    username: String,
    password: String,
    auto_login: bool,
) -> Result<(), String> {
    cloud_auth::save_credentials(&app, &username, &password, auto_login)
}

#[tauri::command]
pub async fn load_credentials(app: AppHandle) -> Result<Option<cloud_auth::Credentials>, String> {
    cloud_auth::load_credentials(&app)
}

#[tauri::command]
pub async fn clear_credentials(app: AppHandle) -> Result<(), String> {
    cloud_auth::clear_credentials(&app)
}

// ============ 云端登录/注册 commands ============

/// 服务器返回的 user 对象（字段按 API 文档，宽松解析）
#[derive(Debug, Deserialize)]
struct ApiUser {
    id: String,
    #[serde(default)]
    username: String,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    nickname: Option<String>,
}

/// 服务器返回的认证响应
#[derive(Debug, Deserialize)]
struct ApiAuthResponse {
    user: ApiUser,
    access_token: String,
    refresh_token: String,
}

/// 登录返回值（与前端 src/api/auth.ts 的 LoginResult 对齐）
#[derive(Debug, Serialize)]
pub struct LoginResult {
    pub success: bool,
    pub user: Option<cloud_auth::Session>,
    pub error: Option<String>,
}

/// 注册返回值（与前端 src/api/auth.ts 的 RegisterResult 对齐）
#[derive(Debug, Serialize)]
pub struct RegisterResult {
    pub success: bool,
    pub error: Option<String>,
}

/// 连接测试返回值（与前端 src/api/auth.ts 的 ConnectionTestResult 对齐）
#[derive(Debug, Serialize)]
pub struct ConnectionTestResult {
    pub ok: bool,
    pub latency: Option<u64>,
    pub error: Option<String>,
}

/// 从 API user 构造 Session（admin 字段服务器暂无，默认 false）
fn api_user_to_session(user: ApiUser) -> cloud_auth::Session {
    cloud_auth::Session {
        id: user.id,
        username: if !user.username.is_empty() {
            user.username
        } else {
            user.nickname.unwrap_or_default()
        },
        admin: false,
    }
}

/// 登录：调用自建 API，成功后保存 tokens + session
#[tauri::command]
pub async fn cloud_login(
    state: State<'_, AppState>,
    username: String,
    password: String,
) -> Result<LoginResult, String> {
    perform_login(&state, &username, &password).await
}

/// 登录核心逻辑（供 cloud_login 和自动登录复用）
async fn perform_login(
    state: &State<'_, AppState>,
    username: &str,
    password: &str,
) -> Result<LoginResult, String> {
    let body = serde_json::json!({
        "username": username,
        "password": password,
    });

    let (status, resp_body) = match server_api::post("/api/v1/auth/login", &body, None).await {
        Ok(r) => r,
        Err(e) => {
            return Ok(LoginResult {
                success: false,
                user: None,
                error: Some(e),
            });
        }
    };

    if status != 200 {
        // 尝试解析服务器错误信息
        let error = server_api::parse_json(&resp_body)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(|s| s.to_string()))
            .unwrap_or_else(|| format!("登录失败 (HTTP {})", status));
        return Ok(LoginResult {
            success: false,
            user: None,
            error: Some(error),
        });
    }

    let auth: ApiAuthResponse = match server_api::parse_json(&resp_body) {
        Ok(v) => serde_json::from_value(v).map_err(|e| format!("响应格式错误: {}", e))?,
        Err(e) => return Err(e),
    };

    let session = api_user_to_session(auth.user);

    // 保存 tokens + session
    server_api::set_tokens(&state.tokens, &auth.access_token, &auth.refresh_token).await;
    {
        let mut guard = state.cloud_session.lock().map_err(|e| e.to_string())?;
        *guard = Some(session.clone());
    }

    Ok(LoginResult {
        success: true,
        user: Some(session),
        error: None,
    })
}

/// 注册：调用自建 API
#[tauri::command]
pub async fn cloud_register(
    username: String,
    password: String,
) -> Result<RegisterResult, String> {
    if username.trim().len() < 2 {
        return Ok(RegisterResult {
            success: false,
            error: Some("用户名至少需要2个字符".to_string()),
        });
    }
    if password.len() < 6 {
        return Ok(RegisterResult {
            success: false,
            error: Some("密码至少需要6个字符".to_string()),
        });
    }

    let body = serde_json::json!({
        "username": username,
        "password": password,
    });

    let (status, resp_body) = match server_api::post("/api/v1/auth/register", &body, None).await {
        Ok(r) => r,
        Err(e) => {
            return Ok(RegisterResult {
                success: false,
                error: Some(e),
            });
        }
    };

    if status == 201 || status == 200 {
        return Ok(RegisterResult {
            success: true,
            error: None,
        });
    }

    // 409 = 用户名已存在；其余解析服务器 error 字段
    let error = server_api::parse_json(&resp_body)
        .ok()
        .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(|s| s.to_string()))
        .unwrap_or_else(|| {
            if status == 409 {
                "用户名已注册".to_string()
            } else {
                format!("注册失败 (HTTP {})", status)
            }
        });

    Ok(RegisterResult {
        success: false,
        error: Some(error),
    })
}

/// 退出登录：调用服务器使 refresh token 失效 + 清理本地
#[tauri::command]
pub async fn cloud_logout(state: State<'_, AppState>) -> Result<(), String> {
    // 通知服务器作废 refresh token
    let refresh = server_api::get_refresh_token(&state.tokens).await;
    if let Some(rt) = refresh {
        let body = serde_json::json!({ "refresh_token": rt });
        let _ = server_api::post("/api/v1/auth/logout", &body, None).await;
    }

    // 清理本地 tokens + session
    server_api::clear_tokens(&state.tokens).await;
    {
        let mut guard = state.cloud_session.lock().map_err(|e| e.to_string())?;
        *guard = None;
    }
    Ok(())
}

/// 获取当前会话
///
/// 1. 有 access token + 内存会话 → 直接返回
/// 2. 无内存会话 → 尝试用本地凭据自动登录（username+password → /auth/login）
/// 3. 否则返回 None
#[tauri::command]
pub async fn cloud_get_session(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Option<cloud_auth::Session>, String> {
    // 1. 内存会话存在则直接返回
    {
        let guard = state.cloud_session.lock().map_err(|e| e.to_string())?;
        if let Some(s) = guard.as_ref() {
            return Ok(Some(s.clone()));
        }
    }

    // 2. 内存会话为空：尝试用本地凭据自动登录
    let creds = match cloud_auth::load_credentials(&app) {
        Ok(Some(c)) => c,
        _ => return Ok(None),
    };

    if !creds.auto_login.unwrap_or(false) {
        return Ok(None);
    }

    let (username, password) = match (creds.username, creds.password) {
        (u, Some(p)) if !u.is_empty() && !p.is_empty() => (u, p),
        _ => return Ok(None),
    };

    eprintln!("[cloud_auth] 内存会话为空，尝试用本地凭据自动登录: {}", username);

    match perform_login(&state, &username, &password).await {
        Ok(result) if result.success => {
            eprintln!("[cloud_auth] 自动登录成功");
            Ok(result.user)
        }
        Ok(result) => {
            // 自动登录失败（密码改了、账号删了等）——清除无效凭据，避免反复尝试
            eprintln!(
                "[cloud_auth] 自动登录失败: {}，清除本地凭据",
                result.error.unwrap_or_else(|| "未知错误".to_string())
            );
            let _ = cloud_auth::clear_credentials(&app);
            Ok(None)
        }
        Err(e) => {
            // 网络错误等非业务异常——保留凭据，下次启动再试
            eprintln!("[cloud_auth] 自动登录网络异常: {}，保留凭据", e);
            Ok(None)
        }
    }
}

/// 测试服务器连接
#[tauri::command]
pub async fn cloud_test_connection() -> Result<ConnectionTestResult, String> {
    let start = std::time::Instant::now();

    // 用 /api/status 或 /health 测试（服务器实现文档定义了两个）
    let (status, _) = match server_api::get("/api/v1/health", None).await {
        Ok(r) => r,
        Err(e) => {
            return Ok(ConnectionTestResult {
                ok: false,
                latency: Some(start.elapsed().as_millis() as u64),
                error: Some(e),
            });
        }
    };

    let ok = status == 200;
    Ok(ConnectionTestResult {
        ok,
        latency: Some(start.elapsed().as_millis() as u64),
        error: if ok {
            None
        } else {
            Some(format!("HTTP {}", status))
        },
    })
}

// ============ API Key / API Mode commands ============

/// 读取本地模式 API Key
#[tauri::command]
pub async fn get_api_key(app: AppHandle) -> Result<Option<String>, String> {
    let data = data_manager::read_data(&app)?;
    Ok(data
        .get("apiKey")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string()))
}

/// 保存本地模式 API Key
///
/// 同时同步到 `ChartsState.inner.api_key`。
#[tauri::command]
pub async fn save_api_key(app: AppHandle, api_key: String) -> Result<bool, String> {
    let mut data = data_manager::read_data(&app)?;
    data["apiKey"] = serde_json::Value::String(api_key.clone());
    data_manager::write_data(&app, &data)?;

    let charts_state = app.state::<crate::state::ChartsState>();
    let mut guard = charts_state.inner.lock().await;
    guard.api_key = if api_key.is_empty() {
        None
    } else {
        Some(api_key)
    };

    Ok(true)
}

/// 读取 API 模式（"cloud" 或 "local"）
#[tauri::command]
pub async fn get_api_mode(app: AppHandle) -> Result<String, String> {
    let data = data_manager::read_data(&app)?;
    Ok(data
        .get("apiMode")
        .and_then(|v| v.as_str())
        .unwrap_or("cloud")
        .to_string())
}

/// 设置 API 模式
#[tauri::command]
pub async fn set_api_mode(app: AppHandle, mode: String) -> Result<bool, String> {
    let mut data = data_manager::read_data(&app)?;
    data["apiMode"] = serde_json::Value::String(mode);
    data_manager::write_data(&app, &data)?;
    Ok(true)
}

// ============ 用户反馈 commands ============
//
// 对接自建 API /api/v1/feedback（替代 Supabase feedback 表）。

/// 反馈记录（与前端 src/api/feedback.ts 的 FeedbackItem 对齐）
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackItem {
    pub id: i64,
    pub feedback_content: String,
    pub feedback_status: i64,
    pub create_time: Option<String>,
    pub remark: Option<String>,
}

/// 服务器返回的反馈行（字段名为 content/status/create_time）
#[derive(Debug, Deserialize)]
struct ApiFeedbackRow {
    #[serde(default)]
    id: i64,
    #[serde(default)]
    content: String,
    #[serde(default)]
    status: i64,
    #[serde(default)]
    create_time: Option<String>,
    #[serde(default)]
    remark: Option<String>,
}

impl From<ApiFeedbackRow> for FeedbackItem {
    fn from(r: ApiFeedbackRow) -> Self {
        FeedbackItem {
            id: r.id,
            feedback_content: r.content,
            feedback_status: r.status,
            create_time: r.create_time,
            remark: r.remark,
        }
    }
}

/// 提交反馈
#[tauri::command]
pub async fn submit_feedback(
    state: State<'_, AppState>,
    content: String,
) -> Result<bool, String> {
    let content = content.trim();
    if content.is_empty() {
        return Err("反馈内容不能为空".to_string());
    }
    if content.len() > 500 {
        return Err("反馈内容不能超过 500 字".to_string());
    }

    // 需要登录
    let logged_in = {
        let guard = state.cloud_session.lock().map_err(|e| e.to_string())?;
        guard.is_some()
    };
    if !logged_in {
        return Err("请先登录后再提交反馈".to_string());
    }
    let token = server_api::get_access_token(&state.tokens).await;

    let body = serde_json::json!({ "content": content });
    let (status, resp_body) = match server_api::post("/api/v1/feedback", &body, token.as_deref()).await
    {
        Ok(r) => r,
        Err(e) => return Err(format!("提交反馈失败: {}", e)),
    };

    if status == 201 || status == 200 {
        Ok(true)
    } else {
        let err = server_api::parse_json(&resp_body)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(|s| s.to_string()))
            .unwrap_or_else(|| format!("提交反馈失败 (HTTP {})", status));
        Err(err)
    }
}

/// 获取当前用户的反馈列表
#[tauri::command]
pub async fn get_user_feedbacks(state: State<'_, AppState>) -> Result<Vec<FeedbackItem>, String> {
    let logged_in = {
        let guard = state.cloud_session.lock().map_err(|e| e.to_string())?;
        guard.is_some()
    };
    if !logged_in {
        return Ok(Vec::new()); // 未登录返回空列表
    }
    let token = server_api::get_access_token(&state.tokens).await;

    let (status, resp_body) = match server_api::get("/api/v1/feedback", token.as_deref()).await {
        Ok(r) => r,
        Err(e) => return Err(format!("查询反馈失败: {}", e)),
    };

    if !(status == 200) {
        return Err(format!("查询反馈失败 (HTTP {})", status));
    }

    let value = server_api::parse_json(&resp_body)?;
    let rows: Vec<ApiFeedbackRow> = value
        .get("feedbacks")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| serde_json::from_value(item.clone()).ok())
                .collect()
        })
        .unwrap_or_default();

    Ok(rows.into_iter().map(FeedbackItem::from).collect())
}

/// 删除指定反馈
#[tauri::command]
pub async fn delete_feedback(state: State<'_, AppState>, feedback_id: i64) -> Result<bool, String> {
    let logged_in = {
        let guard = state.cloud_session.lock().map_err(|e| e.to_string())?;
        guard.is_some()
    };
    if !logged_in {
        return Err("请先登录后再操作".to_string());
    }
    let token = server_api::get_access_token(&state.tokens).await;

    let path = format!("/api/v1/feedback/{}", feedback_id);
    let (status, resp_body) = match server_api::delete(&path, token.as_deref()).await {
        Ok(r) => r,
        Err(e) => return Err(format!("删除反馈失败: {}", e)),
    };

    if status == 204 || status == 200 {
        Ok(true)
    } else {
        let err = server_api::parse_json(&resp_body)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(|s| s.to_string()))
            .unwrap_or_else(|| format!("删除反馈失败 (HTTP {})", status));
        Err(err)
    }
}
