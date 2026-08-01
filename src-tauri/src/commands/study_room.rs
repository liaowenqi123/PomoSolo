//! 自习室 commands
//!
//! 对接自建服务器（server-planning/API-implementation.md）：
//! - REST: GET/DELETE /api/v1/rooms, GET /rooms/:id/leaderboard
//! - WebSocket: room:create / room:join / room:leave / presence:update / room:pomo_done / ping
//!
//! 替代原来的 Supabase REST 直连。用户身份取自 AppState.cloud_session + tokens。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, State};

use crate::modules::server_api;
use crate::modules::ws;
use crate::state::AppState;

// ============ 类型定义（与前端 studyRoom.ts 对齐）============

/// 自习室信息
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyRoom {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// 创建者用户 id（用于房主判断，删除房间）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub member_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_public: Option<bool>,
    /// 房间是否设置了加入密码
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_password: Option<bool>,
}

/// 自习室成员
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyRoomMember {
    pub user_id: String,
    pub username: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub today_minutes: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub online: Option<bool>,
    /// 专注状态：idle / focusing / short_break / long_break
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

/// 排名条目
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyRoomRankingEntry {
    pub username: String,
    pub today_minutes: u32,
    pub rank: u32,
}

// ============ 辅助函数 ============

/// 从 AppState 取当前登录会话，未登录返回错误
fn require_session(state: &State<'_, AppState>) -> Result<crate::modules::cloud_auth::Session, String> {
    let guard = state.cloud_session.lock().map_err(|e| e.to_string())?;
    guard
        .clone()
        .ok_or_else(|| "请先登录后再使用自习室".to_string())
}

/// 取当前 access token（未登录返回错误）
async fn require_token(state: &State<'_, AppState>) -> Result<String, String> {
    let logged_in = {
        let guard = state.cloud_session.lock().map_err(|e| e.to_string())?;
        guard.is_some()
    };
    if !logged_in {
        return Err("请先登录后再使用自习室".to_string());
    }
    server_api::get_valid_access_token(&state.tokens)
        .await
        .ok_or_else(|| "登录状态已失效，请重新登录".to_string())
}

// ============ 纯函数（可单测，不依赖网络）============

/// 解析服务器 room 行 → StudyRoom
pub fn parse_room_value(row: &Value) -> StudyRoom {
    StudyRoom {
        id: row.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        name: row.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        description: row.get("description").and_then(|v| v.as_str()).map(|s| s.to_string()),
        owner_id: row.get("owner_id").and_then(|v| v.as_str()).map(|s| s.to_string()),
        creator_name: None,
        member_count: None,
        is_public: row.get("is_public").and_then(|v| v.as_bool()),
        has_password: row.get("has_password").and_then(|v| v.as_bool()),
    }
}

/// 从服务器 leaderboard 构造排名列表（focus_seconds → 分钟）
pub fn build_ranking(entries: &[Value]) -> Vec<StudyRoomRankingEntry> {
    entries
        .iter()
        .enumerate()
        .map(|(i, e)| {
            let nickname = e
                .get("nickname")
                .and_then(|v| v.as_str())
                .unwrap_or("未知用户")
                .to_string();
            let seconds = e.get("focus_seconds").and_then(|v| v.as_u64()).unwrap_or(0);
            StudyRoomRankingEntry {
                username: nickname,
                today_minutes: (seconds / 60) as u32,
                rank: (i + 1) as u32,
            }
        })
        .collect()
}

// ============ Tauri commands ============

/// 获取活跃的自习室列表（REST GET /api/v1/rooms）
#[tauri::command]
pub async fn study_room_get_active(
    state: State<'_, AppState>,
    public_only: bool,
) -> Result<Vec<StudyRoom>, String> {
    let token = require_token(&state).await?;
    let _ = public_only; // 服务器 /rooms 默认返回公开房间

    let (status, body) = match server_api::get("/api/v1/rooms", Some(&token)).await {
        Ok(r) => r,
        Err(e) => return Err(e),
    };
    if status != 200 {
        return Err(format!("获取自习室列表失败 (HTTP {})", status));
    }

    let value = server_api::parse_json(&body)?;
    let rooms: Vec<StudyRoom> = value
        .get("rooms")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().map(parse_room_value).collect())
        .unwrap_or_default();
    Ok(rooms)
}

/// 创建自习室（WebSocket room:create，password 非空则为私密房间）
#[tauri::command]
pub async fn study_room_create(
    app: AppHandle,
    state: State<'_, AppState>,
    name: String,
    description: String,
    password: String,
) -> Result<StudyRoom, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("自习室名称不能为空".to_string());
    }
    if name.len() > 100 {
        return Err("自习室名称不能超过 100 字符".to_string());
    }

    let session = require_session(&state)?;
    let token = require_token(&state).await?;

    let params = serde_json::json!({
        "name": name,
        "max_members": 50,
        "password": password,
        "description": description,
    });
    let resp = ws::request(&app, &state.ws, &token, "room:create", params).await?;

    // 服务端返回 room:created { room: {...} } 或 error
    if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
        let err = resp.get("error").and_then(|v| v.as_str()).unwrap_or("创建失败");
        return Err(err.to_string());
    }

    let room_val = resp.get("room").cloned().unwrap_or(resp.clone());
    let mut room = parse_room_value(&room_val);
    room.creator_name = Some(session.username);
    room.member_count = Some(1);
    room.has_password = Some(!password.is_empty());
    Ok(room)
}

/// 加入自习室（WebSocket room:join，私密房间需传 password）
#[tauri::command]
pub async fn study_room_join(
    app: AppHandle,
    state: State<'_, AppState>,
    room_id: String,
    password: String,
) -> Result<(), String> {
    let _session = require_session(&state)?;
    let token = require_token(&state).await?;

    let params = serde_json::json!({ "room_id": room_id, "password": password });
    let resp = ws::request(&app, &state.ws, &token, "room:join", params).await?;

    if resp.get("type").and_then(|v| v.as_str()) == Some("error") {
        let err = resp.get("error").and_then(|v| v.as_str()).unwrap_or("加入失败");
        return Err(err.to_string());
    }
    Ok(())
}

/// 退出自习室（WebSocket room:leave）
#[tauri::command]
pub async fn study_room_leave(
    app: AppHandle,
    state: State<'_, AppState>,
    room_id: String,
) -> Result<(), String> {
    let _session = require_session(&state)?;
    let token = require_token(&state).await?;

    let params = serde_json::json!({ "room_id": room_id });
    ws::send(&app, &state.ws, &token, "room:leave", params).await
}

/// 获取自习室详情（REST GET /api/v1/rooms/:id，含 owner_id 供房主判断）
#[tauri::command]
pub async fn study_room_get_detail(
    state: State<'_, AppState>,
    room_id: String,
) -> Result<StudyRoom, String> {
    let token = require_token(&state).await?;

    let path = format!("/api/v1/rooms/{}", room_id);
    let (status, body) = match server_api::get(&path, Some(&token)).await {
        Ok(r) => r,
        Err(e) => return Err(e),
    };
    if status != 200 {
        return Err(format!("获取自习室详情失败 (HTTP {})", status));
    }

    let value = server_api::parse_json(&body)?;
    Ok(parse_room_value(&value))
}

/// 删除自习室（REST DELETE /api/v1/rooms/:id，仅房主）
#[tauri::command]
pub async fn study_room_delete(
    state: State<'_, AppState>,
    room_id: String,
) -> Result<bool, String> {
    let token = require_token(&state).await?;

    let path = format!("/api/v1/rooms/{}", room_id);
    let (status, resp_body) = match server_api::delete(&path, Some(&token)).await {
        Ok(r) => r,
        Err(e) => return Err(format!("删除自习室失败: {}", e)),
    };

    if status == 204 || status == 200 {
        Ok(true)
    } else {
        let err = server_api::parse_json(&resp_body)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(|s| s.to_string()))
            .unwrap_or_else(|| format!("删除自习室失败 (HTTP {})", status));
        Err(err)
    }
}

/// 更新自习室（REST PUT /api/v1/rooms/:id，仅房主）：公开/私密切换、名称、描述、密码
#[tauri::command]
pub async fn study_room_update(
    state: State<'_, AppState>,
    room_id: String,
    is_public: Option<bool>,
    name: Option<String>,
    description: Option<String>,
    password: Option<String>,
) -> Result<bool, String> {
    let token = require_token(&state).await?;

    let mut body = serde_json::Map::new();
    if let Some(v) = is_public {
        body.insert("is_public".to_string(), serde_json::json!(v));
    }
    if let Some(v) = name {
        body.insert("name".to_string(), serde_json::json!(v));
    }
    if let Some(v) = description {
        body.insert("description".to_string(), serde_json::json!(v));
    }
    if let Some(v) = password {
        body.insert("password".to_string(), serde_json::json!(v));
    }
    if body.is_empty() {
        return Err("没有需要更新的字段".to_string());
    }

    let path = format!("/api/v1/rooms/{}", room_id);
    let (status, resp_body) =
        match server_api::put(&path, &serde_json::Value::Object(body), Some(&token)).await {
            Ok(r) => r,
            Err(e) => return Err(format!("更新自习室失败: {}", e)),
        };

    if status == 200 {
        Ok(true)
    } else {
        let err = server_api::parse_json(&resp_body)
            .ok()
            .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(|s| s.to_string()))
            .unwrap_or_else(|| format!("更新自习室失败 (HTTP {})", status));
        Err(err)
    }
}

/// 获取自习室今日排名（REST GET /rooms/:id/leaderboard）
#[tauri::command]
pub async fn study_room_get_ranking(
    state: State<'_, AppState>,
    room_id: String,
) -> Result<Vec<StudyRoomRankingEntry>, String> {
    let token = require_token(&state).await?;

    let path = format!("/api/v1/rooms/{}/leaderboard?period=today", room_id);
    let (status, body) = match server_api::get(&path, Some(&token)).await {
        Ok(r) => r,
        Err(e) => return Err(e),
    };
    if status != 200 {
        return Err(format!("获取排名失败 (HTTP {})", status));
    }

    let value = server_api::parse_json(&body)?;
    let entries: Vec<Value> = value
        .get("leaderboard")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(build_ranking(&entries))
}

/// 获取自习室在线成员列表
///
/// 服务器无独立 REST 接口，成员列表由 room:join / room:members 事件推送。
/// 这里发送一次 `presence:update` 触达服务器后返回空数组（成员实时更新走前端 WS 事件）。
#[tauri::command]
pub async fn study_room_get_members(
    app: AppHandle,
    state: State<'_, AppState>,
    room_id: String,
) -> Result<Vec<StudyRoomMember>, String> {
    let _session = require_session(&state)?;
    let token = require_token(&state).await?;

    // 触发一次状态同步，服务器会推送 room:members 事件
    let _ = ws::send(
        &app,
        &state.ws,
        &token,
        "presence:update",
        serde_json::json!({ "status": "idle", "room_id": room_id }),
    )
    .await;

    Ok(Vec::new())
}

/// 上传今日专注统计（番茄钟完成时调用）
///
/// 服务器协议：room:pomo_done { mode }，服务端负责统计排行。
#[tauri::command]
pub async fn study_room_upload_stats(
    app: AppHandle,
    state: State<'_, AppState>,
    room_id: String,
    today_minutes: u32,
    today_count: u32,
) -> Result<bool, String> {
    let _session = require_session(&state)?;
    let token = require_token(&state).await?;

    let mode = if today_count > 0 { "focus" } else { "short_break" };
    let params = serde_json::json!({
        "room_id": room_id,
        "mode": mode,
        "duration": today_minutes * 60,
    });
    ws::send(&app, &state.ws, &token, "room:pomo_done", params)
        .await
        .map_err(|e| format!("上传统计失败: {}", e))?;
    Ok(true)
}

/// 心跳：更新在线状态（WebSocket ping）
#[tauri::command]
pub async fn study_room_update_status(
    app: AppHandle,
    state: State<'_, AppState>,
    room_id: String,
) -> Result<bool, String> {
    let _session = require_session(&state)?;
    let token = require_token(&state).await?;

    let params = serde_json::json!({ "room_id": room_id });
    ws::send(&app, &state.ws, &token, "ping", params)
        .await
        .map_err(|e| format!("心跳失败: {}", e))?;
    Ok(true)
}

// ============ 单元测试 ============

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_room_value_full() {
        let row = serde_json::json!({
            "id": "abc-123",
            "name": "专注自习室",
            "description": "一起学习",
            "owner_id": "u-42",
            "is_public": true,
            "has_password": false
        });
        let room = parse_room_value(&row);
        assert_eq!(room.id, "abc-123");
        assert_eq!(room.name, "专注自习室");
        assert_eq!(room.description.as_deref(), Some("一起学习"));
        assert_eq!(room.owner_id.as_deref(), Some("u-42"));
        assert_eq!(room.is_public, Some(true));
        assert_eq!(room.has_password, Some(false));
        assert!(room.creator_name.is_none());
        assert!(room.member_count.is_none());
    }

    #[test]
    fn test_parse_room_value_missing_fields() {
        let row = serde_json::json!({ "id": "r2", "name": "minimal" });
        let room = parse_room_value(&row);
        assert_eq!(room.id, "r2");
        assert_eq!(room.name, "minimal");
        assert!(room.description.is_none());
        assert!(room.is_public.is_none());
        assert!(room.has_password.is_none());
    }

    #[test]
    fn test_build_ranking_assigns_rank_by_order() {
        let entries = vec![
            serde_json::json!({ "nickname": "alice", "focus_seconds": 7200 }),
            serde_json::json!({ "nickname": "bob", "focus_seconds": 5400 }),
            serde_json::json!({ "nickname": "carol", "focus_seconds": 1800 }),
        ];
        let ranking = build_ranking(&entries);
        assert_eq!(ranking.len(), 3);
        assert_eq!(ranking[0].username, "alice");
        assert_eq!(ranking[0].today_minutes, 120);
        assert_eq!(ranking[0].rank, 1);
        assert_eq!(ranking[1].rank, 2);
        assert_eq!(ranking[2].rank, 3);
    }

    #[test]
    fn test_build_ranking_empty() {
        let ranking = build_ranking(&[]);
        assert!(ranking.is_empty());
    }

    #[test]
    fn test_build_ranking_missing_fields() {
        let entries = vec![serde_json::json!({})];
        let ranking = build_ranking(&entries);
        assert_eq!(ranking[0].username, "未知用户");
        assert_eq!(ranking[0].today_minutes, 0);
        assert_eq!(ranking[0].rank, 1);
    }

    #[test]
    fn test_study_room_camel_case_serialization() {
        let room = StudyRoom {
            id: "r1".to_string(),
            name: "test".to_string(),
            description: Some("desc".to_string()),
            owner_id: Some("u-42".to_string()),
            creator_name: Some("alice".to_string()),
            member_count: Some(3),
            is_public: Some(true),
            has_password: Some(false),
        };
        let json = serde_json::to_string(&room).expect("序列化应成功");
        assert!(json.contains("\"creatorName\""));
        assert!(json.contains("\"memberCount\""));
        assert!(json.contains("\"isPublic\""));
        assert!(json.contains("\"hasPassword\""));
        assert!(json.contains("\"ownerId\""));
        assert!(!json.contains("creator_name"));
        assert!(!json.contains("member_count"));
    }

    #[test]
    fn test_study_room_member_camel_case_serialization() {
        let member = StudyRoomMember {
            user_id: "u-1".to_string(),
            username: "alice".to_string(),
            today_minutes: Some(30),
            online: Some(true),
            status: Some("focusing".to_string()),
        };
        let json = serde_json::to_string(&member).expect("序列化应成功");
        assert!(json.contains("\"userId\""));
        assert!(json.contains("\"todayMinutes\""));
        assert!(json.contains("\"status\""));
        assert!(!json.contains("user_id"));
    }

    #[test]
    fn test_ranking_entry_camel_case_serialization() {
        let entry = StudyRoomRankingEntry {
            username: "alice".to_string(),
            today_minutes: 30,
            rank: 1,
        };
        let json = serde_json::to_string(&entry).expect("序列化应成功");
        assert!(json.contains("\"todayMinutes\""));
        assert!(!json.contains("today_minutes"));
    }
}
