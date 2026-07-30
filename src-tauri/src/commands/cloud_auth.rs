//! 云端认证 commands
//!
//! 对接 modules/cloud_auth.rs（本地凭据存储）+ Supabase REST API（云端登录/注册）

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::modules::cloud_auth;
use crate::modules::cloud_auth::{hash_password, SUPABASE_ANON_KEY, SUPABASE_URL};
use crate::modules::data_manager;
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

/// Supabase users 表行
#[derive(Debug, Deserialize)]
struct UserRow {
    id: i64,
    username: String,
    password_hash: String,
    salt: String,
    admin: Option<bool>,
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

/// 构造 Supabase REST 客户端，附带必要鉴权头
fn supabase_client() -> reqwest::Client {
    let mut headers = reqwest::header::HeaderMap::new();
    if let Ok(k) = reqwest::header::HeaderValue::from_str(SUPABASE_ANON_KEY) {
        headers.insert("apikey", k);
    }
    if let Ok(k) = reqwest::header::HeaderValue::from_str(&format!("Bearer {}", SUPABASE_ANON_KEY)) {
        headers.insert(reqwest::header::AUTHORIZATION, k);
    }
    reqwest::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(15))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .expect("failed to build supabase client")
}

/// 登录：查询 users 表 → 验证密码 → 设置 session
#[tauri::command]
pub async fn cloud_login(
    state: State<'_, AppState>,
    app: AppHandle,
    username: String,
    password: String,
) -> Result<LoginResult, String> {
    let client = supabase_client();
    let url = format!(
        "{}/rest/v1/users?select=id,username,password_hash,salt,admin&username=eq.{}",
        SUPABASE_URL,
        urlencoding(&username)
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Ok(LoginResult {
            success: false,
            user: None,
            error: Some(format!("登录失败 ({}): {}", status, body)),
        });
    }

    let users: Vec<UserRow> = resp.json().await.map_err(|e| e.to_string())?;
    let user = match users.into_iter().next() {
        Some(u) => u,
        None => {
            return Ok(LoginResult {
                success: false,
                user: None,
                error: Some("用户名不存在".to_string()),
            });
        }
    };

    // 验证密码
    let computed = hash_password(&password, &user.salt);
    if computed != user.password_hash {
        return Ok(LoginResult {
            success: false,
            user: None,
            error: Some("密码错误".to_string()),
        });
    }

    let session = cloud_auth::Session {
        id: user.id,
        username: user.username,
        admin: user.admin.unwrap_or(false),
    };

    // 写入 AppState
    {
        let mut guard = state.cloud_session.lock().map_err(|e| e.to_string())?;
        *guard = Some(session.clone());
    }

    // 若是 admin，从 Supabase 获取 DeepSeek API Key 并注入 ChartsState
    // 修复：登录成功后未获取 API Key，导致音乐下载提示"无 DeepSeek API Key"
    if user.admin.unwrap_or(false) {
        let key_url = format!(
            "{}/rest/v1/api_keys?select=api_key&name=eq.deepseek&limit=1",
            SUPABASE_URL
        );
        if let Ok(key_resp) = client.get(&key_url).send().await {
            if let Ok(key_rows) = key_resp.json::<Vec<serde_json::Value>>().await {
                if let Some(first) = key_rows.into_iter().next() {
                    if let Some(key) = first.get("api_key").and_then(|v| v.as_str()) {
                        let key = key.to_string();
                        let charts_state = app.state::<crate::state::ChartsState>();
                        let mut guard = charts_state.inner.lock().await;
                        guard.api_key = Some(key);
                    }
                }
            }
        }
    }

    Ok(LoginResult {
        success: true,
        user: Some(session),
        error: None,
    })
}

/// 注册：插入新用户
#[tauri::command]
pub async fn cloud_register(
    username: String,
    password: String,
) -> Result<RegisterResult, String> {
    if username.len() < 2 {
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

    let salt = cloud_auth::generate_salt();
    let hash = hash_password(&password, &salt);

    let body = serde_json::json!({
        "username": username,
        "password_hash": hash,
        "salt": salt,
    });

    let client = supabase_client();
    let url = format!("{}/rest/v1/users", SUPABASE_URL);

    let resp = client
        .post(&url)
        .header("Prefer", "return=representation")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let status = resp.status();
    let body_text = resp.text().await.unwrap_or_default();

    if !status.is_success() {
        // 23505 = unique_violation
        if body_text.contains("23505") {
            return Ok(RegisterResult {
                success: false,
                error: Some("用户名已存在".to_string()),
            });
        }
        return Err(format!("注册失败 ({}): {}", status, body_text));
    }

    Ok(RegisterResult {
        success: true,
        error: None,
    })
}

/// 退出登录：清理会话
#[tauri::command]
pub async fn cloud_logout(state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.cloud_session.lock().map_err(|e| e.to_string())?;
    *guard = None;
    Ok(())
}

/// 获取当前会话（不暴露 API Key）
#[tauri::command]
pub async fn cloud_get_session(state: State<'_, AppState>) -> Result<Option<cloud_auth::Session>, String> {
    let guard = state.cloud_session.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

/// 测试 Supabase 连接
///
/// 最多重试 3 次，每次间隔 500ms，以应对 Supabase 冷启动慢导致的误判。
#[tauri::command]
pub async fn cloud_test_connection() -> Result<ConnectionTestResult, String> {
    let client = supabase_client();
    let url = format!("{}/rest/v1/users?select=id&limit=1", SUPABASE_URL);

    let start = std::time::Instant::now();
    let mut last_err: Option<String> = None;

    for attempt in 0..3u32 {
        match client.get(&url).send().await {
            Ok(resp) => {
                let latency = start.elapsed().as_millis() as u64;
                let status = resp.status();
                let ok = status.is_success();
                return Ok(ConnectionTestResult {
                    ok,
                    latency: Some(latency),
                    error: if ok {
                        None
                    } else {
                        Some(format!("HTTP {}", status))
                    },
                });
            }
            Err(e) => {
                last_err = Some(format!("连接失败: {}", e));
                if attempt < 2 {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                }
            }
        }
    }

    Ok(ConnectionTestResult {
        ok: false,
        latency: Some(start.elapsed().as_millis() as u64),
        error: last_err,
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
/// 同时同步到 `ChartsState.inner.api_key`，修复 docs/modules/cloud-and-charts.md 4.6 节 Bug：
/// 原实现只写 `data.json`，导致 `download_song` 始终返回"请先登录或配置 DeepSeek API Key"。
#[tauri::command]
pub async fn save_api_key(app: AppHandle, api_key: String) -> Result<bool, String> {
    let mut data = data_manager::read_data(&app)?;
    data["apiKey"] = Value::String(api_key.clone());
    data_manager::write_data(&app, &data)?;

    // 同步到 ChartsState 内存（方案 B：作为 charts_set_api_key 的额外保障）
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
    data["apiMode"] = Value::String(mode);
    data_manager::write_data(&app, &data)?;
    Ok(true)
}

// ============ 辅助函数 ============

/// 简单的 URL 编码（仅编码用户名中可能出现的特殊字符）
fn urlencoding(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}
