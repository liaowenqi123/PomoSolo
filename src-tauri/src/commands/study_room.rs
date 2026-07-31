//! 自习室 commands
//!
//! 对接前端 src/api/studyRoom.ts + Supabase REST API。
//!
//! 表结构（Supabase）：
//! - study_rooms(id UUID, name, creator_id INT, created_at, is_active BOOL,
//!   max_members INT, description, is_public BOOL)
//! - study_room_members(id SERIAL, room_id UUID, user_id INT, joined_at,
//!   last_active, is_online BOOL, UNIQUE(room_id, user_id))
//! - daily_focus_records(id SERIAL, user_id INT, room_id UUID, date DATE,
//!   total_minutes INT, session_count INT, notes JSONB, last_updated)
//!
//! 认证：与 cloud_auth 同源，使用 anon key + RLS(Allow all)。
//! 用户身份取自 AppState.cloud_session（登录后注入）。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

use crate::modules::cloud_auth::{Session, SUPABASE_ANON_KEY, SUPABASE_URL};
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub member_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_public: Option<bool>,
}

/// 自习室成员
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyRoomMember {
    pub user_id: i64,
    pub username: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub today_minutes: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub online: Option<bool>,
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

/// 构造 Supabase REST 客户端（与 cloud_auth::supabase_client 同构）
fn supabase_client() -> reqwest::Client {
    let mut headers = reqwest::header::HeaderMap::new();
    if let Ok(k) = reqwest::header::HeaderValue::from_str(SUPABASE_ANON_KEY) {
        headers.insert("apikey", k);
    }
    if let Ok(k) =
        reqwest::header::HeaderValue::from_str(&format!("Bearer {}", SUPABASE_ANON_KEY))
    {
        headers.insert(reqwest::header::AUTHORIZATION, k);
    }
    reqwest::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(15))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .expect("failed to build supabase client")
}

/// 当前 UTC 日期 YYYY-MM-DD（与旧版 new Date().toISOString().split('T')[0] 一致）
fn today_utc() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86400);
    let (y, m, d) = days_to_ymd(days);
    format!("{:04}-{:02}-{:02}", y, m, d)
}

/// epoch 天数 → 年月日（与 garden.rs/cloud_auth.rs 算法一致）
fn days_to_ymd(mut days: i64) -> (i64, i64, i64) {
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
    (year, month, day)
}

/// RFC3339 UTC 时间字符串
fn now_iso_utc() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let day_secs = secs.rem_euclid(86400);
    let hour = day_secs / 3600;
    let min = (day_secs % 3600) / 60;
    let sec = day_secs % 60;
    let (y, mo, d) = days_to_ymd(secs.div_euclid(86400));
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, mo, d, hour, min, sec
    )
}

/// 从 AppState 取当前登录会话，未登录返回错误
fn require_session(state: &State<'_, AppState>) -> Result<Session, String> {
    let guard = state.cloud_session.lock().map_err(|e| e.to_string())?;
    guard
        .clone()
        .ok_or_else(|| "请先登录后再使用自习室".to_string())
}

/// 根据 user_id 查 username（单次 GET users 表）
async fn get_username_by_id(client: &reqwest::Client, user_id: i64) -> Option<String> {
    let url = format!(
        "{}/rest/v1/users?select=username&id=eq.{}",
        SUPABASE_URL, user_id
    );
    let resp = client.get(&url).send().await.ok()?;
    let rows: Vec<Value> = resp.json().await.ok()?;
    rows.into_iter()
        .next()
        .and_then(|r| r.get("username").and_then(|v| v.as_str()).map(|s| s.to_string()))
}

// ============ 纯函数（可单测，不依赖网络）============

/// 解析 study_rooms 表行 → StudyRoom（不含 creator_name / member_count 富化）
pub fn parse_room_row(row: &Value) -> StudyRoom {
    StudyRoom {
        id: row
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        name: row
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        description: row
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        creator_name: None,
        member_count: None,
        is_public: row.get("is_public").and_then(|v| v.as_bool()),
    }
}

/// 根据已排序的 daily_focus_records 数组构造排名列表
///
/// - records 按 total_minutes 降序排列
/// - username_map 提供 user_id → username 映射
/// - rank 从 1 开始递增（同分不同名，简化处理）
pub fn build_ranking(
    records: &[Value],
    username_map: &HashMap<i64, String>,
) -> Vec<StudyRoomRankingEntry> {
    records
        .iter()
        .enumerate()
        .map(|(i, rec)| {
            let user_id = rec.get("user_id").and_then(|v| v.as_i64()).unwrap_or(0);
            let minutes = rec
                .get("total_minutes")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
            StudyRoomRankingEntry {
                username: username_map
                    .get(&user_id)
                    .cloned()
                    .unwrap_or_else(|| "未知用户".to_string()),
                today_minutes: minutes,
                rank: (i + 1) as u32,
            }
        })
        .collect()
}

// ============ Tauri commands ============

/// 获取活跃的自习室列表
#[tauri::command]
pub async fn study_room_get_active(
    state: State<'_, AppState>,
    public_only: bool,
) -> Result<Vec<StudyRoom>, String> {
    let _session = require_session(&state)?;
    let client = supabase_client();

    let mut url = format!(
        "{}/rest/v1/study_rooms?select=*&is_active=eq.true&order=created_at.desc",
        SUPABASE_URL
    );
    if public_only {
        url.push_str("&is_public=eq.true");
    }

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("获取自习室列表失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("获取自习室列表失败 ({}): {}", status, body));
    }

    let rows: Vec<Value> = resp.json().await.map_err(|e| e.to_string())?;
    let mut rooms: Vec<StudyRoom> = rows.iter().map(parse_room_row).collect();

    // 富化：creator_name + member_count
    for room in &mut rooms {
        let creator_id = parse_creator_id_from_rows(&rows, &room.id);
        if let Some(cid) = creator_id {
            room.creator_name = get_username_by_id(&client, cid).await;
        }
        room.member_count = count_room_members(&client, &room.id).await;
    }

    Ok(rooms)
}

/// 从原始 rows 中找到对应 room 的 creator_id
fn parse_creator_id_from_rows(rows: &[Value], room_id: &str) -> Option<i64> {
    rows.iter()
        .find(|r| r.get("id").and_then(|v| v.as_str()) == Some(room_id))
        .and_then(|r| r.get("creator_id").and_then(|v| v.as_i64()))
}

/// 统计 room 在线成员数（HEAD + Prefer: count=exact）
async fn count_room_members(client: &reqwest::Client, room_id: &str) -> Option<u32> {
    let url = format!(
        "{}/rest/v1/study_room_members?select=*&room_id=eq.{}",
        SUPABASE_URL, room_id
    );
    let resp = client
        .get(&url)
        .header("Prefer", "count=exact")
        .header("Range", "0-0")
        .send()
        .await
        .ok()?;
    // content-range: 0-0/42
    let cr = resp.headers().get("content-range")?.to_str().ok()?;
    let total = cr.rsplit('/').next()?;
    total.parse::<u32>().ok()
}

/// 创建自习室（创建者自动加入）
#[tauri::command]
pub async fn study_room_create(
    state: State<'_, AppState>,
    name: String,
    description: String,
    is_public: Option<bool>,
) -> Result<StudyRoom, String> {
    let session = require_session(&state)?;
    let name = name.trim();
    if name.is_empty() {
        return Err("自习室名称不能为空".to_string());
    }
    if name.len() > 100 {
        return Err("自习室名称不能超过 100 字符".to_string());
    }

    let client = supabase_client();
    let body = serde_json::json!([{
        "name": name,
        "description": if description.is_empty() { Value::Null } else { Value::String(description) },
        "creator_id": session.id,
        "is_public": is_public.unwrap_or(true),
    }]);

    let url = format!("{}/rest/v1/study_rooms", SUPABASE_URL);
    let resp = client
        .post(&url)
        .header("Prefer", "return=representation")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("创建自习室失败: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("创建自习室失败 ({}): {}", status, body));
    }

    let rows: Vec<Value> = resp.json().await.map_err(|e| e.to_string())?;
    let row = rows
        .into_iter()
        .next()
        .ok_or_else(|| "创建自习室失败：未返回数据".to_string())?;

    let room = parse_room_row(&row);

    // 创建者自动加入
    let _ = study_room_join_inner(&state, &room.id).await;

    Ok(StudyRoom {
        creator_name: Some(session.username),
        member_count: Some(1),
        ..room
    })
}

/// 加入自习室
#[tauri::command]
pub async fn study_room_join(
    state: State<'_, AppState>,
    room_id: String,
) -> Result<(), String> {
    study_room_join_inner(&state, &room_id).await
}

/// 加入自习室核心逻辑（供 create 复用）
async fn study_room_join_inner(
    state: &State<'_, AppState>,
    room_id: &str,
) -> Result<(), String> {
    let session = require_session(state)?;
    let client = supabase_client();

    // 1. 查房间
    let room_url = format!(
        "{}/rest/v1/study_rooms?select=*&id=eq.{}",
        SUPABASE_URL, room_id
    );
    let resp = client
        .get(&room_url)
        .send()
        .await
        .map_err(|e| format!("查询自习室失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("查询自习室失败: {}", resp.status()));
    }
    let rooms: Vec<Value> = resp.json().await.map_err(|e| e.to_string())?;
    let room = rooms
        .into_iter()
        .next()
        .ok_or_else(|| "自习室不存在".to_string())?;

    let is_active = room.get("is_active").and_then(|v| v.as_bool()).unwrap_or(false);
    let creator_id = room.get("creator_id").and_then(|v| v.as_i64());

    // 不活跃时只有创建者可进入激活
    if !is_active && creator_id != Some(session.id) {
        return Err("自习室当前无人在线，只有创建者可以进入激活".to_string());
    }

    // 2. 查是否已加入
    let member_url = format!(
        "{}/rest/v1/study_room_members?select=*&room_id=eq.{}&user_id=eq.{}",
        SUPABASE_URL, room_id, session.id
    );
    let resp = client
        .get(&member_url)
        .send()
        .await
        .map_err(|e| format!("查询成员失败: {}", e))?;
    let members: Vec<Value> = resp.json().await.map_err(|e| e.to_string())?;

    let now = now_iso_utc();
    if let Some(existing) = members.into_iter().next() {
        // 已加入：更新为在线
        let member_id = existing
            .get("id")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        let upd_url = format!(
            "{}/rest/v1/study_room_members?id=eq.{}",
            SUPABASE_URL, member_id
        );
        let _ = client
            .patch(&upd_url)
            .header("Prefer", "return=minimal")
            .json(&serde_json::json!({
                "is_online": true,
                "last_active": now
            }))
            .send()
            .await;
    } else {
        // 首次加入：插入
        let ins_url = format!("{}/rest/v1/study_room_members", SUPABASE_URL);
        let _ = client
            .post(&ins_url)
            .header("Prefer", "return=minimal")
            .json(&serde_json::json!([{
                "room_id": room_id,
                "user_id": session.id,
                "is_online": true,
                "last_active": now,
                "joined_at": now
            }]))
            .send()
            .await;
    }

    // 3. 如果房间之前不活跃，重新激活
    if !is_active {
        let act_url = format!(
            "{}/rest/v1/study_rooms?id=eq.{}",
            SUPABASE_URL, room_id
        );
        let _ = client
            .patch(&act_url)
            .header("Prefer", "return=minimal")
            .json(&serde_json::json!({ "is_active": true }))
            .send()
            .await;
    }

    Ok(())
}

/// 退出自习室（标记离线，不删除记录）
#[tauri::command]
pub async fn study_room_leave(
    state: State<'_, AppState>,
    room_id: String,
) -> Result<(), String> {
    let session = require_session(&state)?;
    let client = supabase_client();

    let url = format!(
        "{}/rest/v1/study_room_members?room_id=eq.{}&user_id=eq.{}",
        SUPABASE_URL, room_id, session.id
    );
    let resp = client
        .patch(&url)
        .header("Prefer", "return=minimal")
        .json(&serde_json::json!({
            "is_online": false,
            "last_active": now_iso_utc()
        }))
        .send()
        .await
        .map_err(|e| format!("退出自习室失败: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("退出自习室失败: {}", resp.status()));
    }
    Ok(())
}

/// 获取自习室今日排名
#[tauri::command]
pub async fn study_room_get_ranking(
    state: State<'_, AppState>,
    room_id: String,
) -> Result<Vec<StudyRoomRankingEntry>, String> {
    let _session = require_session(&state)?;
    let client = supabase_client();
    let today = today_utc();

    // 1. 取该房间所有成员 user_id
    let members_url = format!(
        "{}/rest/v1/study_room_members?select=user_id&room_id=eq.{}",
        SUPABASE_URL, room_id
    );
    let resp = client
        .get(&members_url)
        .send()
        .await
        .map_err(|e| format!("查询成员失败: {}", e))?;
    let members: Vec<Value> = resp.json().await.map_err(|e| e.to_string())?;

    if members.is_empty() {
        return Ok(Vec::new());
    }

    let user_ids: Vec<i64> = members
        .iter()
        .filter_map(|m| m.get("user_id").and_then(|v| v.as_i64()))
        .collect();
    if user_ids.is_empty() {
        return Ok(Vec::new());
    }

    // 2. 查今日记录（不按 room_id 过滤，每用户每天一条总记录）
    let ids_filter = user_ids
        .iter()
        .map(|i| i.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let records_url = format!(
        "{}/rest/v1/daily_focus_records?select=*&user_id=in.({})&date=eq.{}&order=total_minutes.desc&limit=50",
        SUPABASE_URL, ids_filter, today
    );
    let resp = client
        .get(&records_url)
        .send()
        .await
        .map_err(|e| format!("查询排名失败: {}", e))?;
    let records: Vec<Value> = resp.json().await.map_err(|e| e.to_string())?;

    // 3. 批量取 username
    let mut username_map: HashMap<i64, String> = HashMap::new();
    for uid in &user_ids {
        if let Some(name) = get_username_by_id(&client, *uid).await {
            username_map.insert(*uid, name);
        }
    }

    Ok(build_ranking(&records, &username_map))
}

/// 获取自习室在线成员列表
#[tauri::command]
pub async fn study_room_get_members(
    state: State<'_, AppState>,
    room_id: String,
) -> Result<Vec<StudyRoomMember>, String> {
    let _session = require_session(&state)?;
    let client = supabase_client();

    let url = format!(
        "{}/rest/v1/study_room_members?select=*&room_id=eq.{}&is_online=eq.true&order=last_active.desc",
        SUPABASE_URL, room_id
    );
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("查询成员失败: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("查询成员失败: {}", resp.status()));
    }
    let members: Vec<Value> = resp.json().await.map_err(|e| e.to_string())?;

    let mut result: Vec<StudyRoomMember> = Vec::new();
    for m in &members {
        let user_id = m.get("user_id").and_then(|v| v.as_i64()).unwrap_or(0);
        let username = get_username_by_id(&client, user_id)
            .await
            .unwrap_or_else(|| "未知用户".to_string());
        result.push(StudyRoomMember {
            user_id,
            username,
            today_minutes: None,
            online: Some(true),
        });
    }
    Ok(result)
}

/// 上传今日专注统计（番茄钟完成时调用）
///
/// - 每用户每天一条记录（不按 room_id 分区），room_id 仅记录最后活跃的自习室
/// - 已有记录则覆盖 total_minutes/session_count（非累加，与旧版一致）
#[tauri::command]
pub async fn study_room_upload_stats(
    state: State<'_, AppState>,
    room_id: String,
    today_minutes: u32,
    today_count: u32,
) -> Result<bool, String> {
    let session = require_session(&state)?;
    let client = supabase_client();
    let today = today_utc();
    let now = now_iso_utc();

    // 1. 查是否已有今日记录
    let exist_url = format!(
        "{}/rest/v1/daily_focus_records?select=id&user_id=eq.{}&date=eq.{}",
        SUPABASE_URL, session.id, today
    );
    let resp = client
        .get(&exist_url)
        .send()
        .await
        .map_err(|e| format!("查询今日统计失败: {}", e))?;
    let existing: Vec<Value> = resp.json().await.map_err(|e| e.to_string())?;

    if let Some(row) = existing.into_iter().next() {
        // 2a. 已有：覆盖更新
        let rec_id = row.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        let upd_url = format!(
            "{}/rest/v1/daily_focus_records?id=eq.{}",
            SUPABASE_URL, rec_id
        );
        let resp = client
            .patch(&upd_url)
            .header("Prefer", "return=minimal")
            .json(&serde_json::json!({
                "total_minutes": today_minutes,
                "session_count": today_count,
                "room_id": room_id,
                "last_updated": now
            }))
            .send()
            .await
            .map_err(|e| format!("更新统计失败: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("更新统计失败: {}", resp.status()));
        }
    } else {
        // 2b. 无：插入
        let ins_url = format!("{}/rest/v1/daily_focus_records", SUPABASE_URL);
        let resp = client
            .post(&ins_url)
            .header("Prefer", "return=minimal")
            .json(&serde_json::json!([{
                "user_id": session.id,
                "room_id": room_id,
                "date": today,
                "total_minutes": today_minutes,
                "session_count": today_count,
                "last_updated": now
            }]))
            .send()
            .await
            .map_err(|e| format!("上传统计失败: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("上传统计失败: {}", resp.status()));
        }
    }
    Ok(true)
}

/// 心跳：更新自己在线状态 + 清理超时成员 + 下线空房间
///
/// 超时阈值：11 分钟（与旧版 11 * 60 * 1000 一致）
#[tauri::command]
pub async fn study_room_update_status(
    state: State<'_, AppState>,
    room_id: String,
) -> Result<bool, String> {
    let session = require_session(&state)?;
    let client = supabase_client();
    let now = now_iso_utc();

    // 1. 更新自己在线
    let self_url = format!(
        "{}/rest/v1/study_room_members?room_id=eq.{}&user_id=eq.{}",
        SUPABASE_URL, room_id, session.id
    );
    let _ = client
        .patch(&self_url)
        .header("Prefer", "return=minimal")
        .json(&serde_json::json!({ "is_online": true, "last_active": now }))
        .send()
        .await;

    // 2. 清理超时成员（>11 分钟未活跃的 is_online=true 成员）
    //    用 last_active.lt.{cutoff} 过滤
    let cutoff = iso_utc_minus_minutes(11);
    let timeout_url = format!(
        "{}/rest/v1/study_room_members?is_online=eq.true&last_active=lt.{}",
        SUPABASE_URL, cutoff
    );
    let _ = client
        .patch(&timeout_url)
        .header("Prefer", "return=minimal")
        .json(&serde_json::json!({ "is_online": false }))
        .send()
        .await;

    // 3. 下线没有在线成员的活跃房间
    let active_url = format!(
        "{}/rest/v1/study_rooms?select=id&is_active=eq.true",
        SUPABASE_URL
    );
    let resp = match client.get(&active_url).send().await {
        Ok(r) => r,
        Err(_) => return Ok(true),
    };
    let active_rooms: Vec<Value> = match resp.json().await {
        Ok(v) => v,
        Err(_) => return Ok(true),
    };

    for room in &active_rooms {
        if let Some(rid) = room.get("id").and_then(|v| v.as_str()) {
            let count = count_online_members(&client, rid).await.unwrap_or(0);
            if count == 0 {
                let deactivate_url = format!(
                    "{}/rest/v1/study_rooms?id=eq.{}",
                    SUPABASE_URL, rid
                );
                let _ = client
                    .patch(&deactivate_url)
                    .header("Prefer", "return=minimal")
                    .json(&serde_json::json!({ "is_active": false }))
                    .send()
                    .await;
            }
        }
    }

    Ok(true)
}

/// 统计 room 在线成员数
async fn count_online_members(client: &reqwest::Client, room_id: &str) -> Option<u32> {
    let url = format!(
        "{}/rest/v1/study_room_members?select=*&room_id=eq.{}&is_online=eq.true",
        SUPABASE_URL, room_id
    );
    let resp = client
        .get(&url)
        .header("Prefer", "count=exact")
        .header("Range", "0-0")
        .send()
        .await
        .ok()?;
    let cr = resp.headers().get("content-range")?.to_str().ok()?;
    let total = cr.rsplit('/').next()?;
    total.parse::<u32>().ok()
}

/// 当前 UTC 时间减 N 分钟后的 RFC3339 字符串
fn iso_utc_minus_minutes(minutes: i64) -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let adjusted = secs - minutes * 60;
    let day_secs = adjusted.rem_euclid(86400);
    let hour = day_secs / 3600;
    let min = (day_secs % 3600) / 60;
    let sec = day_secs % 60;
    let (y, mo, d) = days_to_ymd(adjusted.div_euclid(86400));
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        y, mo, d, hour, min, sec
    )
}

// ============ 单元测试 ============

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_room_row_full() {
        let row = serde_json::json!({
            "id": "abc-123",
            "name": "专注自习室",
            "description": "一起学习",
            "creator_id": 42,
            "is_public": true,
            "is_active": true
        });
        let room = parse_room_row(&row);
        assert_eq!(room.id, "abc-123");
        assert_eq!(room.name, "专注自习室");
        assert_eq!(room.description.as_deref(), Some("一起学习"));
        assert_eq!(room.is_public, Some(true));
        assert!(room.creator_name.is_none());
        assert!(room.member_count.is_none());
    }

    #[test]
    fn test_parse_room_row_null_description() {
        let row = serde_json::json!({
            "id": "r1",
            "name": "test",
            "description": null,
            "is_public": false
        });
        let room = parse_room_row(&row);
        assert_eq!(room.id, "r1");
        assert!(room.description.is_none());
        assert_eq!(room.is_public, Some(false));
    }

    #[test]
    fn test_parse_room_row_missing_fields() {
        let row = serde_json::json!({ "id": "r2", "name": "minimal" });
        let room = parse_room_row(&row);
        assert_eq!(room.id, "r2");
        assert_eq!(room.name, "minimal");
        assert!(room.description.is_none());
        assert!(room.is_public.is_none());
    }

    #[test]
    fn test_build_ranking_assigns_rank_by_order() {
        let records = vec![
            serde_json::json!({ "user_id": 1, "total_minutes": 120 }),
            serde_json::json!({ "user_id": 2, "total_minutes": 90 }),
            serde_json::json!({ "user_id": 3, "total_minutes": 30 }),
        ];
        let mut map = HashMap::new();
        map.insert(1, "alice".to_string());
        map.insert(2, "bob".to_string());
        map.insert(3, "carol".to_string());

        let ranking = build_ranking(&records, &map);
        assert_eq!(ranking.len(), 3);
        assert_eq!(ranking[0].username, "alice");
        assert_eq!(ranking[0].today_minutes, 120);
        assert_eq!(ranking[0].rank, 1);
        assert_eq!(ranking[1].rank, 2);
        assert_eq!(ranking[2].rank, 3);
    }

    #[test]
    fn test_build_ranking_empty() {
        let map = HashMap::new();
        let ranking = build_ranking(&[], &map);
        assert!(ranking.is_empty());
    }

    #[test]
    fn test_build_ranking_unknown_user_fallback() {
        let records = vec![serde_json::json!({ "user_id": 999, "total_minutes": 50 })];
        let map = HashMap::new();
        let ranking = build_ranking(&records, &map);
        assert_eq!(ranking[0].username, "未知用户");
        assert_eq!(ranking[0].today_minutes, 50);
        assert_eq!(ranking[0].rank, 1);
    }

    #[test]
    fn test_days_to_ymd_epoch() {
        // 1970-01-01
        assert_eq!(days_to_ymd(0), (1970, 1, 1));
    }

    #[test]
    fn test_days_to_ymd_2024_jan_7() {
        // 2024-01-07 = 19729 天 since epoch
        assert_eq!(days_to_ymd(19729), (2024, 1, 7));
    }

    #[test]
    fn test_days_to_ymd_leap_day() {
        // 2024-02-29 = 19723 + 31 + 28 = 19782... 实际 19723(1/1) + 31(1月) + 28(2月前28天) = 19782, 2/29 = 19782
        // 19723 + 31 + 28 = 19782
        assert_eq!(days_to_ymd(19782), (2024, 2, 29));
    }

    #[test]
    fn test_today_utc_format() {
        let today = today_utc();
        assert_eq!(today.len(), 10);
        assert!(today.starts_with("20"));
        assert_eq!(today.matches('-').count(), 2);
    }

    #[test]
    fn test_iso_utc_minus_minutes_format() {
        let s = iso_utc_minus_minutes(11);
        // 应是合法 RFC3339 长度
        assert!(s.ends_with('Z'));
        assert_eq!(s.len(), 20);
    }

    #[test]
    fn test_now_iso_utc_format() {
        let s = now_iso_utc();
        assert!(s.ends_with('Z'));
        assert_eq!(s.len(), 20);
        assert!(s.contains('T'));
    }

    #[test]
    fn test_study_room_camel_case_serialization() {
        let room = StudyRoom {
            id: "r1".to_string(),
            name: "test".to_string(),
            description: Some("desc".to_string()),
            creator_name: Some("alice".to_string()),
            member_count: Some(3),
            is_public: Some(true),
        };
        let json = serde_json::to_string(&room).expect("序列化应成功");
        assert!(json.contains("\"creatorName\""));
        assert!(json.contains("\"memberCount\""));
        assert!(json.contains("\"isPublic\""));
        assert!(!json.contains("creator_name"));
        assert!(!json.contains("member_count"));
    }

    #[test]
    fn test_study_room_member_camel_case_serialization() {
        let member = StudyRoomMember {
            user_id: 1,
            username: "alice".to_string(),
            today_minutes: Some(30),
            online: Some(true),
        };
        let json = serde_json::to_string(&member).expect("序列化应成功");
        assert!(json.contains("\"userId\""));
        assert!(json.contains("\"todayMinutes\""));
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
