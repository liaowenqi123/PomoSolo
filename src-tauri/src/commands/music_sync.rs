//! 同步听歌 commands
//!
//! 对接自建服务器 WebSocket 协议（server-planning/API-implementation.md 5.1 节）：
//! - 客户端 → 服务端: music:play / music:pause / music:seek / music:next /
//!   music:volume / music:add_song / music:request_dj
//! - 服务端 → 全体: music:state / music:dj_changed / music:playlist_updated / music:volume
//!
//! 同步原理：音频文件不经服务器中转，客户端各自本地播放，
//! 服务器仅广播控制指令 + 时间戳（timestamp_server），
//! 各客户端据此计算本地播放位置（偏差 > 200ms 时静默 seek 校准）。
//!
//! 前端通过 "ws-event" 事件接收服务端推送（见 modules/ws.rs）。

use serde_json::Value;
use tauri::{AppHandle, State};

use crate::modules::ws;
use crate::state::AppState;

/// 取当前 access token（未登录返回错误）
async fn require_token(state: &State<'_, AppState>) -> Result<String, String> {
    let logged_in = {
        let guard = state.cloud_session.lock().map_err(|e| e.to_string())?;
        guard.is_some()
    };
    if !logged_in {
        return Err("请先登录后再使用同步听歌".to_string());
    }
    crate::modules::server_api::get_valid_access_token(&state.tokens)
        .await
        .ok_or_else(|| "登录状态已失效，请重新登录".to_string())
}

/// 同步播放（DJ 操作）：music:play
#[tauri::command]
pub async fn music_sync_play(
    app: AppHandle,
    state: State<'_, AppState>,
    song_id: String,
    position_ms: i64,
) -> Result<(), String> {
    let token = require_token(&state).await?;
    let params = serde_json::json!({ "song_id": song_id, "position_ms": position_ms });
    ws::send(&app, &state.ws, &token, "music:play", params).await
}

/// 同步暂停：music:pause
#[tauri::command]
pub async fn music_sync_pause(
    app: AppHandle,
    state: State<'_, AppState>,
    position_ms: i64,
) -> Result<(), String> {
    let token = require_token(&state).await?;
    let params = serde_json::json!({ "position_ms": position_ms });
    ws::send(&app, &state.ws, &token, "music:pause", params).await
}

/// 同步跳转：music:seek
#[tauri::command]
pub async fn music_sync_seek(
    app: AppHandle,
    state: State<'_, AppState>,
    position_ms: i64,
) -> Result<(), String> {
    let token = require_token(&state).await?;
    let params = serde_json::json!({ "position_ms": position_ms });
    ws::send(&app, &state.ws, &token, "music:seek", params).await
}

/// 同步切歌：music:next
#[tauri::command]
pub async fn music_sync_next(
    app: AppHandle,
    state: State<'_, AppState>,
    song_id: String,
) -> Result<(), String> {
    let token = require_token(&state).await?;
    let params = serde_json::json!({ "song_id": song_id });
    ws::send(&app, &state.ws, &token, "music:next", params).await
}

/// 同步音量：music:volume
#[tauri::command]
pub async fn music_sync_volume(
    app: AppHandle,
    state: State<'_, AppState>,
    volume: f64,
) -> Result<(), String> {
    let token = require_token(&state).await?;
    let params = serde_json::json!({ "volume": volume });
    ws::send(&app, &state.ws, &token, "music:volume", params).await
}

/// 添加歌曲到同步歌单：music:add_song
#[tauri::command]
pub async fn music_sync_add_song(
    app: AppHandle,
    state: State<'_, AppState>,
    song_name: String,
    song_url: String,
) -> Result<(), String> {
    let token = require_token(&state).await?;
    let params = serde_json::json!({ "song_name": song_name, "song_url": song_url });
    ws::send(&app, &state.ws, &token, "music:add_song", params).await
}

/// 申请成为 DJ：music:request_dj
#[tauri::command]
pub async fn music_sync_request_dj(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let token = require_token(&state).await?;
    ws::send(&app, &state.ws, &token, "music:request_dj", serde_json::json!({})).await
}
