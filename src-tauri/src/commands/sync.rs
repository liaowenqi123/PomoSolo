//! 云端数据同步 commands
//!
//! 对接自建服务器 API：
//! - GET/PUT /api/v1/settings      （设置同步）
//! - POST /api/v1/pomodoro/records/batch （番茄钟记录上传）
//!
//! 登录后由前端触发；未登录返回明确错误。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::modules::data_manager;
use crate::modules::server_api;
use crate::state::AppState;

/// 取当前 access token（未登录返回错误）
async fn require_token(state: &State<'_, AppState>) -> Result<String, String> {
    let logged_in = {
        let guard = state.cloud_session.lock().map_err(|e| e.to_string())?;
        guard.is_some()
    };
    if !logged_in {
        return Err("请先登录后再同步数据".to_string());
    }
    server_api::get_access_token(&state.tokens)
        .await
        .ok_or_else(|| "登录状态已失效，请重新登录".to_string())
}

/// 云端设置（服务器返回结构）
#[derive(Debug, Deserialize, Serialize)]
pub struct CloudSettings {
    pub settings: Value,
    #[serde(default)]
    pub updated_at: Option<String>,
}

/// 拉取云端设置并合并写入本地 settings.json
///
/// 合并策略：以云端为主（云端覆盖本地同名键），保留本地独有的键。
#[tauri::command]
pub async fn cloud_sync_pull_settings(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CloudSettings, String> {
    let token = require_token(&state).await?;

    let (status, body) = match server_api::get("/api/v1/settings", Some(&token)).await {
        Ok(r) => r,
        Err(e) => return Err(e),
    };
    if status != 200 {
        return Err(format!("拉取云端设置失败 (HTTP {})", status));
    }

    let cloud: CloudSettings = match server_api::parse_json(&body) {
        Ok(v) => serde_json::from_value(v).map_err(|e| format!("响应格式错误: {}", e))?,
        Err(e) => return Err(e),
    };

    // 合并：读取本地 → 云端覆盖 → 写回
    let mut local = data_manager::read_settings(&app)?;
    if !local.is_object() {
        local = serde_json::json!({});
    }
    if let Some(obj) = cloud.settings.as_object() {
        if let Some(local_obj) = local.as_object_mut() {
            for (k, v) in obj {
                local_obj.insert(k.clone(), v.clone());
            }
        }
    }
    data_manager::write_settings(&app, &local)?;

    Ok(cloud)
}

/// 上传本地 settings.json 到云端
#[tauri::command]
pub async fn cloud_sync_push_settings(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let token = require_token(&state).await?;
    let settings = data_manager::read_settings(&app)?;

    let body = serde_json::json!({ "settings": settings });
    let (status, resp_body) = match server_api::put("/api/v1/settings", &body, Some(&token)).await {
        Ok(r) => r,
        Err(e) => return Err(format!("上传设置失败: {}", e)),
    };

    if status == 200 {
        Ok(true)
    } else {
        let err = server_api::parse_json(&resp_body)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(|s| s.to_string()))
            .unwrap_or_else(|| format!("上传设置失败 (HTTP {})", status));
        Err(err)
    }
}

/// 番茄钟记录上传项（与服务器 POST /pomodoro/records/batch 对齐）
#[derive(Debug, Serialize, Deserialize)]
pub struct PomodoroRecord {
    pub mode: String,
    pub duration: i64,
    #[serde(default = "default_true")]
    pub completed: bool,
    #[serde(default)]
    pub started_at: Option<String>,
    #[serde(default)]
    pub ended_at: Option<String>,
}

fn default_true() -> bool {
    true
}

/// 批量上传番茄钟记录
#[tauri::command]
pub async fn cloud_upload_pomodoro_records(
    state: State<'_, AppState>,
    records: Vec<PomodoroRecord>,
) -> Result<i64, String> {
    if records.is_empty() {
        return Ok(0);
    }
    let token = require_token(&state).await?;

    let body = serde_json::json!({ "records": records });
    let (status, resp_body) =
        match server_api::post("/api/v1/pomodoro/records/batch", &body, Some(&token)).await {
            Ok(r) => r,
            Err(e) => return Err(format!("上传番茄钟记录失败: {}", e)),
        };

    if status == 200 {
        let synced = server_api::parse_json(&resp_body)
            .ok()
            .and_then(|v| v.get("synced").and_then(|s| s.as_i64()))
            .unwrap_or(records.len() as i64);
        Ok(synced)
    } else {
        let err = server_api::parse_json(&resp_body)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(|s| s.to_string()))
            .unwrap_or_else(|| format!("上传番茄钟记录失败 (HTTP {})", status));
        Err(err)
    }
}
