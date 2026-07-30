//! 自习室 commands
//!
//! 对接前端 src/api/studyRoom.ts。
//! 当前为 stub 实现：所有命令返回空集合或默认对象，保证前端调用不报错。
//! 后续可在此处接入真实的多人自习室后端（如 Supabase 实时表 / 自建 WebSocket 服务）。

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// 自习室信息（与前端 StudyRoom 接口对齐）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyRoom {
    /// 自习室唯一 ID
    pub id: String,
    /// 自习室名称
    pub name: String,
    /// 描述
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// 创建者用户名
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator_name: Option<String>,
    /// 当前成员数
    #[serde(skip_serializing_if = "Option::is_none")]
    pub member_count: Option<u32>,
    /// 是否公开
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_public: Option<bool>,
}

/// 自习室成员（与前端 StudyRoomMember 接口对齐）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyRoomMember {
    /// 用户 ID
    pub user_id: i64,
    /// 用户名
    pub username: String,
    /// 今日专注时长（分钟）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub today_minutes: Option<u32>,
    /// 是否在线
    #[serde(skip_serializing_if = "Option::is_none")]
    pub online: Option<bool>,
}

/// 排名条目（与前端 StudyRoomRankingEntry 接口对齐）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudyRoomRankingEntry {
    /// 用户名
    pub username: String,
    /// 今日专注时长（分钟）
    pub today_minutes: u32,
    /// 排名序号（1 开始）
    pub rank: u32,
}

/// 获取活跃的自习室列表
///
/// stub：返回空列表
#[tauri::command]
pub async fn study_room_get_active(public_only: bool) -> Result<Vec<StudyRoom>, String> {
    let _ = public_only;
    Ok(Vec::new())
}

/// 创建自习室
///
/// stub：返回一个本地构造的自习室对象（不持久化），并带 ID
#[tauri::command]
pub async fn study_room_create(
    name: String,
    description: String,
) -> Result<StudyRoom, String> {
    Ok(StudyRoom {
        id: format!(
            "local-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
        ),
        name,
        description: if description.is_empty() { None } else { Some(description) },
        creator_name: None,
        member_count: Some(1),
        is_public: Some(true),
    })
}

/// 加入自习室
///
/// stub：直接返回 Ok(())
#[tauri::command]
pub async fn study_room_join(room_id: String) -> Result<(), String> {
    let _ = room_id;
    Ok(())
}

/// 退出自习室
///
/// stub：直接返回 Ok(())
#[tauri::command]
pub async fn study_room_leave(room_id: String) -> Result<(), String> {
    let _ = room_id;
    Ok(())
}

/// 获取自习室今日排名
///
/// stub：返回空列表
#[tauri::command]
pub async fn study_room_get_ranking(room_id: String) -> Result<Vec<StudyRoomRankingEntry>, String> {
    let _ = room_id;
    Ok(Vec::new())
}

/// 获取自习室在线成员列表
///
/// stub：返回空列表
#[tauri::command]
pub async fn study_room_get_members(room_id: String) -> Result<Vec<StudyRoomMember>, String> {
    let _ = room_id;
    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_study_room_get_active_returns_empty() {
        let result = study_room_get_active(true).await.expect("调用应成功");
        assert!(result.is_empty(), "stub 应返回空列表");
    }

    #[tokio::test]
    async fn test_study_room_create_returns_room_with_id() {
        let room = study_room_create("test room".to_string(), "".to_string())
            .await
            .expect("调用应成功");
        assert!(!room.id.is_empty(), "应生成 ID");
        assert_eq!(room.name, "test room");
    }

    #[tokio::test]
    async fn test_study_room_join_returns_ok() {
        study_room_join("room-1".to_string()).await.expect("应返回 Ok");
    }

    #[tokio::test]
    async fn test_study_room_leave_returns_ok() {
        study_room_leave("room-1".to_string()).await.expect("应返回 Ok");
    }

    #[tokio::test]
    async fn test_study_room_get_ranking_returns_empty() {
        let result = study_room_get_ranking("room-1".to_string())
            .await
            .expect("调用应成功");
        assert!(result.is_empty());
    }

    #[tokio::test]
    async fn test_study_room_get_members_returns_empty() {
        let result = study_room_get_members("room-1".to_string())
            .await
            .expect("调用应成功");
        assert!(result.is_empty());
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
        // camelCase 字段名
        assert!(json.contains("\"creatorName\""));
        assert!(json.contains("\"memberCount\""));
        assert!(json.contains("\"isPublic\""));
        // 不应出现 snake_case
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
