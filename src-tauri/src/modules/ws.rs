//! WebSocket 客户端（自建服务器实时通道）
//!
//! 对接 server-planning/API-implementation.md 的 WebSocket 协议：
//! - 连接: `ws://SERVER/ws?token=<access_token>`
//! - 请求-响应模式：发送带 `id` 的消息，服务端回复同名 `id`
//! - 事件模式：服务端推送 room:xxx / music:xxx / pong 等事件 → emit 到前端
//!
//! 注意：服务器部署在 1panel-network，WS 端口 3001 已映射到公网，
//! 但为了走同源 + 后续 HTTPS，这里默认连 `SERVER_URL`（HTTP 80 端口）下的 /ws，
//! 若 80 端口未代理 WS，则回退到 ws://IP:3001/ws（通过环境变量 WS_FALLBACK_PORT 控制）。

use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpStream;
use tokio::sync::{oneshot, Mutex};
use tokio::time::{interval, Duration};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

use crate::modules::server_api::SERVER_URL;

/// 消息 id 计数器（全局自增）
static MSG_ID: AtomicU64 = AtomicU64::new(1);

/// WebSocket 连接管理
#[derive(Clone)]
pub struct WsState {
    /// 当前连接的写半部（None = 未连接）
    pub write: Arc<Mutex<Option<WsWriteHalf>>>,
    /// 请求-响应等待表（id → oneshot sender）
    pub pending: Arc<Mutex<HashMap<String, oneshot::Sender<serde_json::Value>>>>,
    /// 是否已连接
    pub connected: Arc<AtomicBool>,
    /// 前端事件重放缓冲（防止事件在监听器注册前丢失）
    pub event_buffer: Arc<Mutex<Vec<serde_json::Value>>>,
}

/// 写半部（包一层以便 Send + 简化类型）
pub struct WsWriteHalf {
    pub inner: futures_util::stream::SplitSink<
        WebSocketStream<MaybeTlsStream<TcpStream>>,
        Message,
    >,
}

impl WsState {
    pub fn new() -> Self {
        Self {
            write: Arc::new(Mutex::new(None)),
            pending: Arc::new(Mutex::new(HashMap::new())),
            connected: Arc::new(AtomicBool::new(false)),
            event_buffer: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

/// 生成递增消息 id
pub fn next_id() -> String {
    MSG_ID.fetch_add(1, Ordering::Relaxed).to_string()
}

/// 判断服务器地址是否为 https（决定 ws/wss 前缀）
fn ws_url(token: &str) -> String {
    let base = if SERVER_URL.starts_with("https://") {
        SERVER_URL.replace("https://", "wss://")
    } else {
        SERVER_URL.replace("http://", "ws://")
    };
    format!("{}/ws?token={}", base, token)
}

/// 建立连接（幂等：已连接则直接返回）
///
/// 接收循环在后台线程持续运行，将服务端消息分发给 pending 或前端事件。
pub async fn ensure_connected(
    app: &AppHandle,
    state: &WsState,
    token: &str,
) -> Result<(), String> {
    if state.connected.load(Ordering::Relaxed) {
        return Ok(());
    }

    let url = ws_url(token);
    let (ws, _) = tokio_tungstenite::connect_async(&url)
        .await
        .map_err(|e| format!("WebSocket 连接失败: {}", e))?;

    let (write, mut read) = ws.split();

    {
        let mut guard = state.write.lock().await;
        *guard = Some(WsWriteHalf { inner: write });
    }
    state.connected.store(true, Ordering::Relaxed);

    // 后台接收循环
    let handle = app.clone();
    let pending = state.pending.clone();
    let event_buffer = state.event_buffer.clone();
    let connected_flag = state.connected.clone();
    let write_guard = state.write.clone();
    tokio::spawn(async move {
        while let Some(msg) = read.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    handle_ws_message(&handle, &text, &pending, &event_buffer).await;
                }
                Ok(Message::Close(_)) | Err(_) => break,
                _ => {}
            }
        }
        // 连接断开：清理状态
        connected_flag.store(false, Ordering::Relaxed);
        {
            let mut guard = write_guard.lock().await;
            *guard = None;
        }
        // 所有 pending 请求失败
        let mut pend = pending.lock().await;
        for (_, tx) in pend.drain() {
            let _ = tx.send(serde_json::json!({ "error": "WebSocket 连接已断开" }));
        }
    });

    // 协议层心跳保活：每 10s 发一次 WS Ping 帧（协议层 Pong 由 tungstenite 自动处理）。
    // 解决自习室"莫名掉线"：业务心跳（presence:update）频率低且依赖上层调用，
    // 若经过代理/NAT，长时间无流量会被中间设备掐断连接。
    let keepalive_write = state.write.clone();
    let keepalive_connected = state.connected.clone();
    tokio::spawn(async move {
        let mut tick = interval(Duration::from_secs(10));
        tick.tick().await; // 立即等首个周期
        loop {
            tick.tick().await;
            if !keepalive_connected.load(Ordering::Relaxed) {
                break;
            }
            let mut guard = keepalive_write.lock().await;
            if let Some(write) = guard.as_mut() {
                if write
                    .inner
                    .send(Message::Ping(Vec::new().into()))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        }
    });

    Ok(())
}

/// 处理单条 WS 消息：有 pending → 回填响应；否则 → 作为事件 emit 前端 + 缓冲
async fn handle_ws_message(
    app: &AppHandle,
    text: &str,
    pending: &Mutex<HashMap<String, oneshot::Sender<serde_json::Value>>>,
    event_buffer: &Mutex<Vec<serde_json::Value>>,
) {
    let value: serde_json::Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return,
    };

    // 1. 请求-响应：带 id 且 pending 中已登记
    let id = value.get("id").and_then(|v| v.as_str()).map(|s| s.to_string());
    if let Some(id) = id {
        let mut pend = pending.lock().await;
        if let Some(tx) = pend.remove(&id) {
            let _ = tx.send(value.clone());
            return;
        }
    }

    // 2. 事件：emit 到前端 + 写入缓冲（供连接前注册的监听器回放）
    let _ = app.emit("ws-event", &value);
    let mut buf = event_buffer.lock().await;
    buf.push(value);
    // 缓冲最多保留 200 条
    if buf.len() > 200 {
        let excess = buf.len() - 200;
        buf.drain(0..excess);
    }
}

/// 发送请求并等待响应（请求-响应模式）
///
/// `msg_type` 为消息 type 字段，`params` 为附加字段。
pub async fn request(
    app: &AppHandle,
    state: &WsState,
    token: &str,
    msg_type: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    ensure_connected(app, state, token).await?;

    let id = next_id();
    let mut msg = serde_json::Map::new();
    msg.insert("type".to_string(), serde_json::Value::String(msg_type.to_string()));
    msg.insert("id".to_string(), serde_json::Value::String(id.clone()));
    if let Some(obj) = params.as_object() {
        for (k, v) in obj {
            msg.insert(k.clone(), v.clone());
        }
    }

    let (tx, rx) = oneshot::channel();
    {
        let mut pend = state.pending.lock().await;
        pend.insert(id.clone(), tx);
    }

    // 发送
    {
        let mut guard = state.write.lock().await;
        let write = guard
            .as_mut()
            .ok_or_else(|| "WebSocket 未连接".to_string())?;
        let text = serde_json::Value::Object(msg).to_string();
        write
            .inner
            .send(Message::Text(text.into()))
            .await
            .map_err(|e| format!("WebSocket 发送失败: {}", e))?;
    }

    // 等待响应（15s 超时）
    tokio::time::timeout(std::time::Duration::from_secs(15), rx)
        .await
        .map_err(|_| "WebSocket 请求超时".to_string())?
        .map_err(|_| "WebSocket 响应通道关闭".to_string())
}

/// 发送事件（fire-and-forget，不等待响应）
pub async fn send(
    app: &AppHandle,
    state: &WsState,
    token: &str,
    msg_type: &str,
    params: serde_json::Value,
) -> Result<(), String> {
    ensure_connected(app, state, token).await?;

    let mut msg = serde_json::Map::new();
    msg.insert("type".to_string(), serde_json::Value::String(msg_type.to_string()));
    if let Some(obj) = params.as_object() {
        for (k, v) in obj {
            msg.insert(k.clone(), v.clone());
        }
    }

    let mut guard = state.write.lock().await;
    let write = guard
        .as_mut()
        .ok_or_else(|| "WebSocket 未连接".to_string())?;
    let text = serde_json::Value::Object(msg).to_string();
    write
        .inner
        .send(Message::Text(text.into()))
        .await
        .map_err(|e| format!("WebSocket 发送失败: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_next_id_increments() {
        let a = next_id();
        let b = next_id();
        assert_ne!(a, b);
        assert!(a.parse::<u64>().is_ok());
    }

    #[test]
    fn test_ws_url_http() {
        let url = ws_url("test-token");
        assert!(url.starts_with("ws://"));
        assert!(url.contains("/ws?token=test-token"));
    }
}
