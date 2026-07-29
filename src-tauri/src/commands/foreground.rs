//! 前台检测 commands
//!
//! 对接 modules/foreground_inspection.rs，启动检测循环并把检测结果通过 Tauri 事件推送到前端

use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;

use crate::modules::foreground_inspection::{self, DetectionResult};
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct ForegroundStatus {
    pub running: bool,
    pub has_api_key: bool,
}

/// 启动前台检测循环
#[tauri::command]
pub async fn foreground_start(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if state.detection_state.running.load(Ordering::Relaxed) {
        return Ok(());
    }

    let det_state = state.detection_state.clone();
    let (tx, mut rx) = mpsc::unbounded_channel::<DetectionResult>();

    // 模块内部会 spawn 一个 tokio 任务定期检测前台窗口
    foreground_inspection::start_detection(det_state, tx);

    // 转发检测结果到 webview
    let app_clone = app.clone();
    tokio::spawn(async move {
        while let Some(result) = rx.recv().await {
            let _ = app_clone.emit("foreground-detection", result);
        }
    });

    Ok(())
}

/// 停止前台检测
#[tauri::command]
pub async fn foreground_stop(state: State<'_, AppState>) -> Result<(), String> {
    foreground_inspection::stop_detection(&state.detection_state);
    Ok(())
}

/// 获取检测状态
#[tauri::command]
pub async fn foreground_get_status(
    state: State<'_, AppState>,
) -> Result<ForegroundStatus, String> {
    let running = state
        .detection_state
        .running
        .load(Ordering::Relaxed);
    let has_api_key = state
        .detection_state
        .api_key
        .read()
        .await
        .as_ref()
        .map(|k| !k.is_empty())
        .unwrap_or(false);
    Ok(ForegroundStatus {
        running,
        has_api_key,
    })
}

/// 设置 DeepSeek API Key（传 None / 空字符串清空）
#[tauri::command]
pub async fn foreground_set_api_key(
    state: State<'_, AppState>,
    key: Option<String>,
) -> Result<(), String> {
    let normalized = match key {
        Some(k) if !k.is_empty() => Some(k),
        _ => None,
    };
    // 直接写入 RwLock，避免使用模块内只接受 String 的 set_api_key
    *state.detection_state.api_key.write().await = normalized;
    Ok(())
}

/// 检查检测是否就绪（API Key 已配置）
#[tauri::command]
pub async fn foreground_is_ready(state: State<'_, AppState>) -> Result<bool, String> {
    let guard = state.detection_state.api_key.read().await;
    Ok(guard.as_ref().map(|k| !k.is_empty()).unwrap_or(false))
}
