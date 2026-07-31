//! 前台检测 commands
//!
//! 对接 modules/foreground_inspection.rs，启动检测循环并把检测结果通过 Tauri 事件推送到前端

use std::path::PathBuf;
use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;

use crate::modules::foreground_inspection::{self, DetectionEvent, DetectionState};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundStatus {
    pub running: bool,
    pub has_api_key: bool,
}

/// list_config.json 路径（与 data.json 同目录：app_data/PomoSolo/data/）
fn get_list_config_path(app: &AppHandle) -> PathBuf {
    let mut path = app.path().app_data_dir().unwrap_or_else(|_| {
        dirs::data_dir().unwrap_or_else(|| PathBuf::from("."))
    });
    path.push("PomoSolo");
    path.push("data");
    let _ = std::fs::create_dir_all(&path);
    path.join("list_config.json")
}

/// 确保名单配置已从磁盘加载到内存（首次调用时执行）。
///
/// 检测启动和名单管理命令都会先走这里：
/// 1. 把解析好的路径写入 DetectionState.config_path（供检测循环持久化历史记录）
/// 2. 若内存配置为空，加载磁盘上的已有配置（重启后恢复用户名单与历史）
async fn ensure_list_config_loaded(app: &AppHandle, state: &DetectionState) {
    let need_load = {
        let mut guard = state.config_path.lock().unwrap_or_else(|e| e.into_inner());
        if guard.is_none() {
            *guard = Some(get_list_config_path(app));
            true
        } else {
            false
        }
    };

    if need_load {
        let path = get_list_config_path(app);
        match foreground_inspection::load_list_config(&path) {
            Ok(cfg) => {
                let mut mem = state.list_config.lock().await;
                // 仅当内存为空时加载，避免覆盖运行期间新增的名单
                if mem.whitelist.is_empty() && mem.blacklist.is_empty() && mem.history.is_empty() {
                    *mem = cfg;
                }
            }
            Err(e) => {
                eprintln!("[ForegroundDetection] 加载名单配置失败: {}，使用默认空配置", e);
            }
        }
    }
}

/// 启动前台检测循环
#[tauri::command]
pub async fn foreground_start(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // 先确保名单配置已加载（检测循环要用白/黑名单与历史记录）
    ensure_list_config_loaded(&app, &state.detection_state).await;

    if state.detection_state.running.load(Ordering::Relaxed) {
        return Ok(());
    }

    let det_state = state.detection_state.clone();
    let (tx, mut rx) = mpsc::unbounded_channel::<DetectionEvent>();

    // 模块内部会 spawn 一个 tokio 任务定期检测前台窗口
    foreground_inspection::start_detection(det_state.clone(), tx);

    // 发射 foreground-ready 事件（检测启动成功）
    // 事件名与前端 src/api/foreground.ts 中 FOREGROUND_EVENTS.ready 对齐
    let _ = app.emit("foreground-ready", serde_json::json!({}));

    // 发射 foreground-status 事件（running: true）
    let has_api_key = {
        let guard = state.detection_state.api_key.read().await;
        guard.as_ref().map(|k| !k.is_empty()).unwrap_or(false)
    };
    let _ = app.emit(
        "foreground-status",
        ForegroundStatus {
            running: true,
            has_api_key,
        },
    );

    // 转发检测结果到 webview
    // 事件名与前端 src/api/foreground.ts 中 FOREGROUND_EVENTS.entertainmentDetected 对齐：
    // 前端监听 'foreground-entertainment-detected'，payload 为 DetectionResult
    let app_clone = app.clone();
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                DetectionEvent::Entertainment(result) => {
                    let _ = app_clone.emit("foreground-entertainment-detected", result);
                }
                DetectionEvent::ApiKeyInvalid => {
                    // API Key 已配置但无效（401/403），通知前端
                    let _ = app_clone.emit("foreground-api-key-invalid", serde_json::json!({}));
                }
                DetectionEvent::Error(msg) => {
                    let _ = app_clone.emit("foreground-error", msg);
                }
            }
        }
        // channel 关闭 → 检测循环退出；若确实已停止（而非被新一轮 start 抢占），
        // 发射 foreground-status 事件（running: false）
        if !det_state.running.load(Ordering::Relaxed) {
            let has_api_key = {
                let guard = det_state.api_key.read().await;
                guard.as_ref().map(|k| !k.is_empty()).unwrap_or(false)
            };
            let _ = app_clone.emit(
                "foreground-status",
                ForegroundStatus {
                    running: false,
                    has_api_key,
                },
            );
        }
    });

    Ok(())
}

/// 停止前台检测
#[tauri::command]
pub async fn foreground_stop(state: State<'_, AppState>) -> Result<(), String> {
    foreground_inspection::stop_detection(&state.detection_state);
    // running=false 后，检测循环会在下一次 tick 退出，channel 关闭，
    // 由 foreground_start 中 spawn 的转发任务负责发射 foreground-status(running: false)
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

// ===== 名单管理 commands（对应旧版 ipc-foreground.js 的 4 个名单频道） =====

/// 添加关键词到白名单
#[tauri::command]
pub async fn foreground_add_whitelist(
    app: AppHandle,
    state: State<'_, AppState>,
    keyword: String,
) -> Result<bool, String> {
    ensure_list_config_loaded(&app, &state.detection_state).await;
    Ok(foreground_inspection::add_to_whitelist(&state.detection_state, &keyword).await)
}

/// 添加关键词到黑名单
#[tauri::command]
pub async fn foreground_add_blacklist(
    app: AppHandle,
    state: State<'_, AppState>,
    keyword: String,
) -> Result<bool, String> {
    ensure_list_config_loaded(&app, &state.detection_state).await;
    Ok(foreground_inspection::add_to_blacklist(&state.detection_state, &keyword).await)
}

/// 将历史记录中的窗口标题标记为"不是娱乐"
///（前端 ForegroundWarning"不是娱乐"按钮：source 为 history/ai 时调用）
#[tauri::command]
pub async fn foreground_mark_history_not(
    app: AppHandle,
    state: State<'_, AppState>,
    window_title: String,
) -> Result<bool, String> {
    ensure_list_config_loaded(&app, &state.detection_state).await;
    Ok(foreground_inspection::mark_history_not(&state.detection_state, &window_title).await)
}

/// 把黑名单关键词移到白名单（误判纠正）
///（前端 ForegroundWarning"不是娱乐"按钮：source 为 blacklist 时调用）
#[tauri::command]
pub async fn foreground_move_blacklist_to_whitelist(
    app: AppHandle,
    state: State<'_, AppState>,
    keyword: String,
) -> Result<bool, String> {
    ensure_list_config_loaded(&app, &state.detection_state).await;
    Ok(foreground_inspection::move_blacklist_to_whitelist(&state.detection_state, &keyword).await)
}

/// 获取当前名单配置（用户白/黑名单 + 历史记录），供设置页展示
#[tauri::command]
pub async fn foreground_get_config(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<foreground_inspection::ListConfig, String> {
    ensure_list_config_loaded(&app, &state.detection_state).await;
    let cfg = state.detection_state.list_config.lock().await;
    Ok(cfg.clone())
}
