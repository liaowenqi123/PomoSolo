//! P2P 信令 commands（Phase 0：WebRTC 牵线）
//!
//! 复用现有 WS 连接发送 peer:* 信令（peer:offer / peer:answer / peer:ice / peer:bye）。
//! 服务器只做定向转发（见 server-planning/ws_server.py `handle_peer_signal`），**不碰媒体数据**；
//! 两端经 NAT 打洞后由 WebRTC DataChannel 直连传输（音乐传歌 / 安装包种子）。
//!
//! 信令内容（SDP/ICE）仅 KB 级，走服务器 WS 代价可忽略；数据走 P2P 直连。

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
        return Err("请先登录后再使用 P2P 传输".to_string());
    }
    crate::modules::server_api::get_valid_access_token(&state.tokens)
        .await
        .ok_or_else(|| "登录状态已失效，请重新登录".to_string())
}

/// 发送 P2P 信令（peer:offer / peer:answer / peer:ice / peer:bye）
///
/// - `msg_type`: 信令类型（白名单校验，防注入任意 WS 消息）
/// - `to_user_id`: 目标用户（服务器定向转发）
/// - `payload`: SDP / ICE 候选等附加字段（sdp / candidate / ...）
#[tauri::command]
pub async fn p2p_signal(
    app: AppHandle,
    state: State<'_, AppState>,
    msg_type: String,
    to_user_id: String,
    payload: Value,
) -> Result<(), String> {
    if !["peer:offer", "peer:answer", "peer:ice", "peer:bye"].contains(&msg_type.as_str()) {
        return Err(format!("非法信令类型: {}", msg_type));
    }
    let token = require_token(&state).await?;
    let mut params = serde_json::json!({ "to_user_id": to_user_id });
    if let Some(obj) = payload.as_object() {
        for (k, v) in obj {
            params[k.clone()] = v.clone();
        }
    }
    ws::send(&app, &state.ws, &token, &msg_type, params).await
}

/// 注册安装包种子（Phase 2）：开启"分享安装包"后上报本机持有的安装包。
///
/// 服务器只维护"谁在线、谁有哪个版本"的目录服务（见 ws_server.py `handle_p2p_seed_register`），
/// 实际文件由其他客户端经 peer:* 信令 → WebRTC 直连拉取，不经服务器。
#[tauri::command]
pub async fn p2p_seed_register(
    app: AppHandle,
    state: State<'_, AppState>,
    version: String,
    file: String,
    size: u64,
) -> Result<(), String> {
    if version.is_empty() || file.is_empty() {
        return Err("种子信息不完整".to_string());
    }
    let token = require_token(&state).await?;
    ws::send(
        &app,
        &state.ws,
        &token,
        "p2p:seed_register",
        serde_json::json!({ "version": version, "file": file, "size": size }),
    )
    .await
}

/// 种子心跳保活（客户端每 30s 发一次，服务器 60s 无心跳自动清理）
#[tauri::command]
pub async fn p2p_seed_heartbeat(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let token = require_token(&state).await?;
    ws::send(&app, &state.ws, &token, "p2p:seed_heartbeat", serde_json::json!({}))
        .await
}

/// 注销种子（用户关闭分享 / 退出登录 / 应用卸载时调用）
#[tauri::command]
pub async fn p2p_seed_unregister(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let token = require_token(&state).await?;
    ws::send(&app, &state.ws, &token, "p2p:seed_unregister", serde_json::json!({}))
        .await
}

/// 查询持有指定版本的在线种子（user_id 列表，服务器已排除自己）
///
/// 走 ws::request 请求-响应（服务器回显 id），15s 超时。
#[tauri::command]
pub async fn p2p_seed_list(
    app: AppHandle,
    state: State<'_, AppState>,
    version: Option<String>,
) -> Result<Vec<String>, String> {
    let token = require_token(&state).await?;
    let resp = ws::request(
        &app,
        &state.ws,
        &token,
        "p2p:seed_list",
        serde_json::json!({ "version": version.unwrap_or_default() }),
    )
    .await?;
    parse_seed_peers(&resp)
}

// ── P2P 连通性测试工具（Phase 1.2+）──

/// 在线用户（P2P 测试目标候选）
#[derive(serde::Serialize)]
pub struct P2POnlineUser {
    pub user_id: String,
    pub username: String,
}

/// 查询在线用户列表（排除自己），供设置面板"P2P 测试工具"选测试目标。
///
/// 走 ws::request 请求-响应（服务器回显 id），15s 超时。
#[tauri::command]
pub async fn p2p_online(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<P2POnlineUser>, String> {
    let token = require_token(&state).await?;
    let resp = ws::request(&app, &state.ws, &token, "p2p:online", serde_json::json!({}))
        .await?;
    parse_online_users(&resp)
}

/// 解析 p2p:online 响应的 users 字段（纯函数，便于单测）
fn parse_online_users(resp: &Value) -> Result<Vec<P2POnlineUser>, String> {
    let users = resp
        .get("users")
        .and_then(|u| u.as_array())
        .ok_or_else(|| "在线列表响应格式错误".to_string())?;
    users
        .iter()
        .map(|u| {
            let user_id = u
                .get("userId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "在线用户缺 userId".to_string())?;
            let username = u
                .get("username")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Ok(P2POnlineUser {
                user_id: user_id.to_string(),
                username,
            })
        })
        .collect()
}

/// 发起 P2P 测试请求（fire-and-forget）：服务器定向转发给目标，目标自动挂起 WebRTC 接收。
#[tauri::command]
pub async fn p2p_test_request(
    app: AppHandle,
    state: State<'_, AppState>,
    to_user_id: String,
) -> Result<(), String> {
    if to_user_id.is_empty() {
        return Err("缺少测试目标".to_string());
    }
    let token = require_token(&state).await?;
    ws::send(
        &app,
        &state.ws,
        &token,
        "p2p:test_request",
        serde_json::json!({ "to_user_id": to_user_id }),
    )
    .await
}

/// 目标端回传 P2P 测试结果给发起方（fire-and-forget），发起方 UI 显示双方视角。
#[tauri::command]
pub async fn p2p_test_result(
    app: AppHandle,
    state: State<'_, AppState>,
    to_user_id: String,
    ok: bool,
    ms: u64,
    speed_bps: u64,
    bytes: u64,
    error: Option<String>,
) -> Result<(), String> {
    let token = require_token(&state).await?;
    let mut params = serde_json::json!({
        "to_user_id": to_user_id,
        "ok": ok,
        "ms": ms,
        "speed_bps": speed_bps,
        "bytes": bytes,
    });
    if let Some(e) = error {
        if !e.is_empty() {
            params["error"] = serde_json::json!(e);
        }
    }
    ws::send(&app, &state.ws, &token, "p2p:test_result", params).await
}

/// 解析 seed_list 响应的 peers 字段（纯函数，便于单测）
fn parse_seed_peers(resp: &Value) -> Result<Vec<String>, String> {
    let peers = resp
        .get("peers")
        .and_then(|p| p.as_array())
        .ok_or_else(|| "种子列表响应格式错误".to_string())?;
    Ok(peers
        .iter()
        .filter_map(|v| v.as_str().map(String::from))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_seed_peers_extracts_user_ids() {
        let resp = serde_json::json!({
            "type": "p2p:seed_list",
            "id": "42",
            "peers": ["uuid-a", "uuid-b"],
            "version": "4.6.0-beta.0"
        });
        assert_eq!(
            parse_seed_peers(&resp).unwrap(),
            vec!["uuid-a".to_string(), "uuid-b".to_string()]
        );
    }

    #[test]
    fn test_parse_seed_peers_empty() {
        let resp = serde_json::json!({ "peers": [], "version": "" });
        assert_eq!(parse_seed_peers(&resp).unwrap(), Vec::<String>::new());
    }

    #[test]
    fn test_parse_seed_peers_skips_non_strings() {
        let resp = serde_json::json!({ "peers": ["ok", 123, null, "also-ok"] });
        assert_eq!(
            parse_seed_peers(&resp).unwrap(),
            vec!["ok".to_string(), "also-ok".to_string()]
        );
    }

    #[test]
    fn test_parse_seed_peers_missing_field_errors() {
        assert!(parse_seed_peers(&serde_json::json!({ "version": "" })).is_err());
        assert!(parse_seed_peers(&serde_json::json!({ "peers": "not-array" })).is_err());
    }

    #[test]
    fn test_parse_online_users_extracts_users() {
        let resp = serde_json::json!({
            "type": "p2p:online",
            "users": [
                {"userId": "uuid-a", "username": "小明"},
                {"userId": "uuid-b", "username": ""}
            ]
        });
        let users = parse_online_users(&resp).unwrap();
        assert_eq!(users.len(), 2);
        assert_eq!(users[0].user_id, "uuid-a");
        assert_eq!(users[0].username, "小明");
        assert_eq!(users[1].user_id, "uuid-b");
    }

    #[test]
    fn test_parse_online_users_empty() {
        assert_eq!(parse_online_users(&serde_json::json!({ "users": [] })).unwrap().len(), 0);
    }

    #[test]
    fn test_parse_online_users_missing_field_errors() {
        assert!(parse_online_users(&serde_json::json!({})).is_err());
        assert!(parse_online_users(&serde_json::json!({ "users": [{"username": "x"}] })).is_err());
        assert!(parse_online_users(&serde_json::json!({ "users": "not-array" })).is_err());
    }
}
