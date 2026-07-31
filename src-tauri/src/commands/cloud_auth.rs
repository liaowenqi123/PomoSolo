//! 云端认证 commands
//!
//! 对接 modules/cloud_auth.rs（本地凭据存储）+ Supabase REST API（云端登录/注册）

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

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
    /// 单点登录：是否在线
    is_online: Option<bool>,
    /// 单点登录：上次心跳时间（ISO 8601）
    last_main_login_heartbeat: Option<String>,
    /// 单点登录：客户端 ID
    client_id: Option<String>,
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
    perform_login(&app, &state, &username, &password).await
}

/// 登录核心逻辑（供 cloud_login 和自动登录复用）
///
/// 单点登录检查（对应旧版 Electron cloudAuth.checkLoginAllowed）：
///   在密码验证前查询云端 is_online / last_main_login_heartbeat / client_id，
///   调用 evaluate_login_allowed 判断是否允许登录。
///   登录成功后启动心跳循环（60s 间隔 + 2min 超时踢出检测）。
async fn perform_login(
    app: &AppHandle,
    state: &State<'_, AppState>,
    username: &str,
    password: &str,
) -> Result<LoginResult, String> {
    let client = supabase_client();
    let url = format!(
        "{}/rest/v1/users?select=id,username,password_hash,salt,admin,is_online,last_main_login_heartbeat,client_id&username=eq.{}",
        SUPABASE_URL,
        urlencoding(username)
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

    // ===== 单点登录检查 =====
    let local_client_id = cloud_auth::generate_client_id();
    let is_online = user.is_online.unwrap_or(false);
    let cloud_client_id = user.client_id.as_deref();
    let last_heartbeat = user.last_main_login_heartbeat.as_deref();

    // 计算心跳经过时间（秒）
    let elapsed_secs = last_heartbeat.and_then(parse_iso8601_to_elapsed_secs);

    let check = cloud_auth::evaluate_login_allowed(
        cloud_client_id,
        &local_client_id,
        is_online,
        last_heartbeat,
        elapsed_secs,
    );

    if !check.allowed {
        return Ok(LoginResult {
            success: false,
            user: None,
            error: Some(format!(
                "账号已在其他设备登录，请等待 2 分钟后重试（原因: {}）",
                check.reason
            )),
        });
    }

    // 验证密码
    let computed = hash_password(password, &user.salt);
    if computed != user.password_hash {
        return Ok(LoginResult {
            success: false,
            user: None,
            error: Some("密码错误".to_string()),
        });
    }

    let session = cloud_auth::Session {
        id: user.id,
        username: user.username.clone(),
        admin: user.admin.unwrap_or(false),
    };

    // 写入 AppState
    {
        let mut guard = state.cloud_session.lock().map_err(|e| e.to_string())?;
        *guard = Some(session.clone());
    }

    // 更新云端在线状态 + client_id（标记登录成功）
    let now = now_iso_utc();
    let update_url = format!("{}/rest/v1/users?id=eq.{}", SUPABASE_URL, user.id);
    let update_body = serde_json::json!({
        "is_online": true,
        "last_main_login_heartbeat": now,
        "client_id": local_client_id,
    });
    let _ = client.patch(&update_url).json(&update_body).send().await;

    // 若是 admin，从 Supabase 获取 DeepSeek API Key 并注入 ChartsState
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

    // 启动单点登录心跳
    start_heartbeat(app.clone(), user.id, local_client_id).await;

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

/// 退出登录：停止心跳 + 标记云端离线 + 清理会话
#[tauri::command]
pub async fn cloud_logout(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    // 停止心跳
    stop_heartbeat(&state).await;

    // 标记云端离线
    let user_id = {
        let guard = state.cloud_session.lock().map_err(|e| e.to_string())?;
        guard.as_ref().map(|s| s.id)
    };

    if let Some(uid) = user_id {
        let client = supabase_client();
        let url = format!("{}/rest/v1/users?id=eq.{}", SUPABASE_URL, uid);
        let body = serde_json::json!({ "is_online": false });
        let _ = client.patch(&url).json(&body).send().await;
    }

    // 清理会话
    {
        let mut guard = state.cloud_session.lock().map_err(|e| e.to_string())?;
        *guard = None;
    }
    Ok(())
}

/// 获取当前会话（不暴露 API Key）
///
/// 若内存会话为空，尝试加载本地凭据并自动登录：
/// - 凭据存在且 autoLogin=true → 用保存的明文密码执行登录流程，恢复会话
/// - 凭据不存在或 autoLogin=false → 返回 None
/// 这样进程重启后无需用户重新输入账号密码。
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

    // autoLogin 未启用，不自动登录
    if !creds.auto_login.unwrap_or(false) {
        return Ok(None);
    }

    let (username, password) = match (creds.username, creds.password) {
        (u, Some(p)) if !u.is_empty() && !p.is_empty() => (u, p),
        _ => return Ok(None),
    };

    eprintln!("[cloud_auth] 内存会话为空，尝试用本地凭据自动登录: {}", username);

    // 复用登录核心逻辑
    match perform_login(&app, &state, &username, &password).await {
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

/// 生成当前 UTC 时间的 RFC3339 字符串（YYYY-MM-DDTHH:MM:SSZ）
///
/// 不引入 chrono 依赖，复用 garden.rs 中 epoch_secs_to_ymd 的算法。
/// 旧版 cloudAuth.js 用 `new Date().toISOString()` 生成同样格式。
fn now_iso_utc() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let day_secs = secs.rem_euclid(86400);
    let hour = day_secs / 3600;
    let min = (day_secs % 3600) / 60;
    let sec = day_secs % 60;

    let mut days = secs.div_euclid(86400);
    let mut year = 1970i64;
    loop {
        let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
        let diy = if is_leap { 366 } else { 365 };
        if days < diy {
            break;
        }
        days -= diy;
        year += 1;
    }
    let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
    let dim: [i64; 12] = if is_leap {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut month = 1i64;
    for (i, &m) in dim.iter().enumerate() {
        if days < m {
            month = (i + 1) as i64;
            break;
        }
        days -= m;
    }
    let day = days + 1;

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hour, min, sec
    )
}

// ============ 用户反馈 commands ============
//
// 对接 Supabase `feedback` 表（与旧 Electron 版 cloudAuth.js 的 submitFeedback /
// getUserFeedbacks / deleteFeedback 对齐）。表结构：
//   id (int8 pk) / user_id (int8) / feedback_content (text)
//   feedback_status (int2: 0=已收到 / 1=已采纳待更新 / 2=已采纳已更新 / 3=已拒绝)
//   create_time (timestamptz) / remark (text, 可空)
//
// 用户身份取自 AppState.cloud_session（与 cloud_get_session 同源），未登录直接返回错误。

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

/// 提交反馈
///
/// 后端从 AppState 取当前登录用户 id 作为 user_id；未登录返回错误。
/// 与旧版 cloudAuth.submitFeedback 一致：feedback_status 默认 0，create_time 由后端写。
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

    // 取当前登录用户 id
    let user_id = {
        let guard = state.cloud_session.lock().map_err(|e| e.to_string())?;
        guard
            .as_ref()
            .ok_or_else(|| "请先登录后再提交反馈".to_string())?
            .id
    };

    // create_time 由后端写入（与旧版 cloudAuth.js 一致），避免依赖数据库 DEFAULT
    let body = serde_json::json!({
        "user_id": user_id,
        "feedback_content": content,
        "feedback_status": 0,
        "create_time": now_iso_utc()
    });

    let client = supabase_client();
    let url = format!("{}/rest/v1/feedback", SUPABASE_URL);

    let resp = client
        .post(&url)
        .header("Prefer", "return=minimal")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("提交反馈失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("提交反馈失败 ({}): {}", status, body));
    }

    Ok(true)
}

/// 获取当前用户的反馈列表（按创建时间降序，最多 50 条）
#[tauri::command]
pub async fn get_user_feedbacks(state: State<'_, AppState>) -> Result<Vec<FeedbackItem>, String> {
    let user_id = {
        let guard = state.cloud_session.lock().map_err(|e| e.to_string())?;
        match guard.as_ref() {
            Some(s) => s.id,
            None => return Ok(Vec::new()), // 未登录返回空列表，前端据此显示"去登录"提示
        }
    };

    let client = supabase_client();
    let url = format!(
        "{}/rest/v1/feedback?select=id,feedback_content,feedback_status,create_time,remark&user_id=eq.{}&order=create_time.desc&limit=50",
        SUPABASE_URL, user_id
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("查询反馈失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("查询反馈失败 ({}): {}", status, body));
    }

    // Supabase 返回 snake_case，这里手动映射到 camelCase
    #[derive(Debug, Deserialize)]
    struct RawFeedback {
        id: i64,
        feedback_content: String,
        feedback_status: i64,
        create_time: Option<String>,
        remark: Option<String>,
    }

    let rows: Vec<RawFeedback> = resp.json().await.map_err(|e| e.to_string())?;
    let items = rows
        .into_iter()
        .map(|r| FeedbackItem {
            id: r.id,
            feedback_content: r.feedback_content,
            feedback_status: r.feedback_status,
            create_time: r.create_time,
            remark: r.remark,
        })
        .collect();

    Ok(items)
}

/// 删除指定反馈（校验归属，仅可删除自己的反馈）
#[tauri::command]
pub async fn delete_feedback(state: State<'_, AppState>, feedback_id: i64) -> Result<bool, String> {
    let user_id = {
        let guard = state.cloud_session.lock().map_err(|e| e.to_string())?;
        match guard.as_ref() {
            Some(s) => s.id,
            None => return Err("请先登录后再操作".to_string()),
        }
    };

    let client = supabase_client();
    // 用 user_id 过滤确保只能删除自己的反馈
    let url = format!(
        "{}/rest/v1/feedback?id=eq.{}&user_id=eq.{}",
        SUPABASE_URL, feedback_id, user_id
    );

    let resp = client
        .delete(&url)
        .send()
        .await
        .map_err(|e| format!("删除反馈失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("删除反馈失败 ({}): {}", status, body));
    }

    Ok(true)
}

// ============ 单点登录心跳管理 ============
//
// 对应旧版 Electron cloudAuth.js 的 startHeartbeat / sendHeartbeat / stopHeartbeat。
// 心跳循环：每 60s 向 Supabase 更新 is_online=true + last_main_login_heartbeat + client_id，
//          同时检查云端 client_id 是否仍为自己（若被其他设备抢占则踢出当前会话）。

/// 启动心跳循环
///
/// 使用 oneshot channel 作为取消信号，stop_heartbeat 发送信号即可终止循环。
pub async fn start_heartbeat(app: AppHandle, user_id: i64, client_id: String) {
    let state = app.state::<AppState>();

    // 先停止已有心跳
    stop_heartbeat(&state).await;

    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    {
        let mut guard = state.heartbeat.cancel.lock().await;
        *guard = Some(tx);
    }

    let app_handle = app.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(
            cloud_auth::HEARTBEAT_INTERVAL_SECS,
        ));
        // 第一次 tick 立即触发（发送首次心跳）
        interval.tick().await;

        let mut rx = rx;
        loop {
            // 发送心跳
            if let Err(e) = send_heartbeat(&app_handle, user_id, &client_id).await {
                eprintln!("[heartbeat] 发送失败: {}", e);
            }

            // 检查是否被踢出（云端 client_id 被其他设备覆盖）
            if check_kicked_out(&app_handle, user_id, &client_id).await {
                eprintln!("[heartbeat] 检测到其他设备登录，当前会话被踢出");
                // 清除本地会话
                let state = app_handle.state::<AppState>();
                {
                    let mut guard = state.cloud_session.lock().unwrap_or_else(|e| e.into_inner());
                    *guard = None;
                }
                // 通知前端
                let _ = app_handle.emit("cloud-kicked-out", serde_json::json!({
                    "reason": "其他设备已登录此账号"
                }));
                break;
            }

            // 等待下一次 tick 或取消信号
            tokio::select! {
                _ = interval.tick() => continue,
                _ = &mut rx => {
                    eprintln!("[heartbeat] 收到停止信号，退出心跳循环");
                    break;
                }
            }
        }
    });
}

/// 停止心跳循环
pub async fn stop_heartbeat(state: &State<'_, AppState>) {
    let mut guard = state.heartbeat.cancel.lock().await;
    if let Some(tx) = guard.take() {
        let _ = tx.send(());
    }
}

/// 发送一次心跳到 Supabase
async fn send_heartbeat(app: &AppHandle, user_id: i64, client_id: &str) -> Result<(), String> {
    let client = supabase_client();
    let url = format!("{}/rest/v1/users?id=eq.{}", SUPABASE_URL, user_id);
    let now = now_iso_utc();
    let body = serde_json::json!({
        "is_online": true,
        "last_main_login_heartbeat": now,
        "client_id": client_id,
    });

    let resp = client
        .patch(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("心跳请求失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("心跳失败 ({}): {}", status, body));
    }

    Ok(())
}

/// 检查是否被其他设备踢出
///
/// 查询云端 client_id，若与本地不一致则表示其他设备已抢占登录。
async fn check_kicked_out(app: &AppHandle, user_id: i64, local_client_id: &str) -> bool {
    let client = supabase_client();
    let url = format!(
        "{}/rest/v1/users?select=client_id&id=eq.{}",
        SUPABASE_URL, user_id
    );

    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(_) => return false, // 网络错误时不踢出，避免误判
    };

    if !resp.status().is_success() {
        return false;
    }

    let rows: Vec<Value> = match resp.json().await {
        Ok(r) => r,
        Err(_) => return false,
    };

    let cloud_client_id = rows
        .first()
        .and_then(|r| r.get("client_id"))
        .and_then(|v| v.as_str());

    match cloud_client_id {
        Some(cid) => cid != local_client_id,
        None => false,
    }
}

/// 解析 ISO 8601 时间字符串并计算与当前的差值（秒）
///
/// 支持格式：`YYYY-MM-DDTHH:MM:SSZ` 或 `YYYY-MM-DDTHH:MM:SS.SSSSSS+00:00`
/// 解析失败时返回 None（调用方按"无心跳记录"处理）。
fn parse_iso8601_to_elapsed_secs(ts: &str) -> Option<u64> {
    let ts = ts.trim();
    if ts.len() < 19 {
        return None;
    }
    let date_part = &ts[..10]; // YYYY-MM-DD
    let time_part = &ts[11..19]; // HH:MM:SS

    let year: i64 = date_part.get(0..4)?.parse().ok()?;
    let month: i64 = date_part.get(5..7)?.parse().ok()?;
    let day: i64 = date_part.get(8..10)?.parse().ok()?;
    let hour: i64 = time_part.get(0..2)?.parse().ok()?;
    let min: i64 = time_part.get(3..5)?.parse().ok()?;
    let sec: i64 = time_part.get(6..8)?.parse().ok()?;

    let ts_secs = ymd_hms_to_epoch(year, month, day, hour, min, sec)?;
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    if ts_secs > now_secs {
        return Some(0);
    }
    Some((now_secs - ts_secs) as u64)
}

/// 将 YYYY-MM-DD HH:MM:SS 转为 Unix epoch 秒（UTC）
fn ymd_hms_to_epoch(year: i64, month: i64, day: i64, hour: i64, min: i64, sec: i64) -> Option<i64> {
    if month < 1 || month > 12 || day < 1 || day > 31 {
        return None;
    }

    let mut total_days: i64 = 0;
    for y in 1970..year {
        let is_leap = (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0);
        total_days += if is_leap { 366 } else { 365 };
    }
    let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
    let dim: [i64; 12] = if is_leap {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    for m in 0..(month as usize - 1) {
        total_days += dim[m];
    }
    total_days += day - 1;

    Some(total_days * 86400 + hour * 3600 + min * 60 + sec)
}

// ============ 单点登录心跳 测试 ============

#[cfg(test)]
mod heartbeat_tests {
    use super::*;

    #[test]
    fn test_ymd_hms_to_epoch_known_date() {
        // 2026-01-01 00:00:00 UTC = 1767225600
        let epoch = ymd_hms_to_epoch(2026, 1, 1, 0, 0, 0);
        assert_eq!(epoch, Some(1767225600));
    }

    #[test]
    fn test_ymd_hms_to_epoch_epoch_start() {
        let epoch = ymd_hms_to_epoch(1970, 1, 1, 0, 0, 0);
        assert_eq!(epoch, Some(0));
    }

    #[test]
    fn test_ymd_hms_to_epoch_leap_year() {
        let epoch = ymd_hms_to_epoch(2024, 2, 29, 0, 0, 0);
        assert!(epoch.is_some());
        let next = ymd_hms_to_epoch(2024, 3, 1, 0, 0, 0).unwrap();
        assert_eq!(next - epoch.unwrap(), 86400);
    }

    #[test]
    fn test_ymd_hms_to_epoch_invalid_month() {
        assert_eq!(ymd_hms_to_epoch(2026, 13, 1, 0, 0, 0), None);
        assert_eq!(ymd_hms_to_epoch(2026, 0, 1, 0, 0, 0), None);
    }

    #[test]
    fn test_ymd_hms_to_epoch_invalid_day() {
        assert_eq!(ymd_hms_to_epoch(2026, 1, 0, 0, 0, 0), None);
        assert_eq!(ymd_hms_to_epoch(2026, 1, 32, 0, 0, 0), None);
    }

    #[test]
    fn test_parse_iso8601_valid() {
        let elapsed = parse_iso8601_to_elapsed_secs("2026-01-01T00:00:00Z");
        assert!(elapsed.is_some());
        let e = elapsed.unwrap();
        assert!(e > 120, "2026-01-01 距今应超过 120 秒，实际: {}", e);
    }

    #[test]
    fn test_parse_iso8601_with_timezone() {
        let elapsed = parse_iso8601_to_elapsed_secs("2026-01-01T00:00:00.000000+00:00");
        assert!(elapsed.is_some());
    }

    #[test]
    fn test_parse_iso8601_too_short() {
        assert_eq!(parse_iso8601_to_elapsed_secs("short"), None);
        assert_eq!(parse_iso8601_to_elapsed_secs(""), None);
    }

    #[test]
    fn test_parse_iso8601_invalid_format() {
        assert_eq!(parse_iso8601_to_elapsed_secs("abcd-ef-ghTij:kl:mnZ"), None);
    }

    #[test]
    fn test_parse_iso8601_future_timestamp() {
        let future = format!("{:04}-12-31T23:59:59Z", 9999);
        let elapsed = parse_iso8601_to_elapsed_secs(&future);
        assert_eq!(elapsed, Some(0));
    }

    #[test]
    fn test_now_iso_utc_format() {
        let ts = now_iso_utc();
        assert_eq!(ts.len(), 20); // YYYY-MM-DDTHH:MM:SSZ
        assert!(ts.ends_with('Z'));
        assert_eq!(ts.as_bytes()[4], b'-');
        assert_eq!(ts.as_bytes()[10], b'T');
        assert_eq!(ts.as_bytes()[13], b':');
    }
}
