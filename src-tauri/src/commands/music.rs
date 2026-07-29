//! 音乐播放器 commands
//!
//! 对接 Python 子进程 music.exe（stdin/stdout JSON 行协议）。
//! 前端调用 music_* 命令 → Rust 转发给 music.exe → music.exe 返回事件 → Rust emit 给前端。
//!
//! 事件名映射（Python event → Tauri event）：
//!   ready → music-ready, status → music-status, track_change → music-track-change,
//!   play_state → music-play-state, progress → music-progress, devices → music-devices,
//!   no_music → music-no-music, play_error → music-play-error,
//!   volume_change → music-volume-change, play_mode → music-play-mode,
//!   playlist → music-playlist, song_missing → music-song-missing

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{oneshot, Mutex};
use tokio::time::{timeout, Duration};

use crate::state::{MusicProcess, MusicState};

/// 获取 music.exe 路径
fn get_music_exe_path(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        // 开发模式：<project_root>/music-player/music.exe
        // CARGO_MANIFEST_DIR = src-tauri/
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let path = PathBuf::from(manifest_dir)
            .parent()
            .ok_or("无法定位项目根目录")?
            .join("music-player")
            .join("music.exe");
        if path.exists() {
            Ok(path)
        } else {
            Err(format!("开发模式下未找到 music.exe: {:?}", path))
        }
    } else {
        // 生产模式：资源目录
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|e| format!("无法获取资源目录: {}", e))?;
        Ok(resource_dir.join("music.exe"))
    }
}

/// 获取 music.exe 所在目录（作为子进程的 CWD，Python 脚本依赖此目录下的 music/ 文件夹）
fn get_music_cwd(exe_path: &PathBuf) -> PathBuf {
    exe_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
}

/// 确保音乐子进程已启动，返回可写的 stdin 引用
async fn ensure_process(app: &AppHandle) -> Result<(), String> {
    let music_state = app.state::<MusicState>();
    let mut guard = music_state.process.lock().await;

    if guard.is_some() {
        return Ok(());
    }

    // 启动子进程
    let exe_path = get_music_exe_path(app)?;
    let cwd = get_music_cwd(&exe_path);

    let mut child = Command::new(&exe_path)
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PYTHONIOENCODING", "utf-8")
        .spawn()
        .map_err(|e| format!("启动 music.exe 失败: {}", e))?;

    let stdin = child.stdin.take().ok_or("无法获取 music stdin")?;
    let stdout = child.stdout.take().ok_or("无法获取 music stdout")?;

    // 启动事件读取任务
    let pending = music_state.pending.clone();
    let app_clone = app.clone();
    tokio::spawn(async move {
        read_events(app_clone, stdout, pending).await;
    });

    *guard = Some(MusicProcess {
        child: Some(child),
        stdin,
    });

    Ok(())
}

/// 事件读取任务：持续读取 music.exe stdout，解析 JSON，emit 给前端
async fn read_events(app: AppHandle, stdout: tokio::process::ChildStdout, pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>) {
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break, // EOF
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let json: Value = match serde_json::from_str(trimmed) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                let event = json
                    .get("event")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let data = json.get("data").cloned().unwrap_or(Value::Null);

                // 检查是否有 pending 请求等待此事件
                let response_key = match event {
                    "custom_tags" => Some("custom_tags"),
                    "custom_tag_added" => Some("custom_tag_added"),
                    "custom_tag_deleted" => Some("custom_tag_deleted"),
                    "tag_updated" => Some("tag_updated"),
                    "status" if data.get("delete_result").is_some() => Some("delete_song"),
                    _ => None,
                };

                if let Some(key) = response_key {
                    if let Some(sender) = pending.lock().await.remove(key) {
                        let _ = sender.send(data.clone());
                    }
                }

                // 映射事件名并 emit 给前端
                let frontend_event = match event {
                    "ready" => Some("music-ready"),
                    "status" => Some("music-status"),
                    "track_change" => Some("music-track-change"),
                    "play_state" => Some("music-play-state"),
                    "progress" => Some("music-progress"),
                    "devices" => Some("music-devices"),
                    "no_music" => Some("music-no-music"),
                    "play_error" => Some("music-play-error"),
                    "volume_change" => Some("music-volume-change"),
                    "play_mode" => Some("music-play-mode"),
                    "playlist" => Some("music-playlist"),
                    "song_missing" => Some("music-song-missing"),
                    _ => None,
                };

                if let Some(evt_name) = frontend_event {
                    let _ = app.emit(evt_name, data);
                }
            }
            Err(_) => break,
        }
    }
}

/// 发送命令到 music.exe
async fn send_command(app: &AppHandle, cmd: Value) -> Result<(), String> {
    ensure_process(app).await?;

    let music_state = app.state::<MusicState>();
    let mut guard = music_state.process.lock().await;

    if let Some(process) = guard.as_mut() {
        let mut msg = serde_json::to_string(&cmd).map_err(|e| e.to_string())?;
        msg.push('\n');
        process
            .stdin
            .write_all(msg.as_bytes())
            .await
            .map_err(|e| format!("发送命令失败: {}", e))?;
        process
            .stdin
            .flush()
            .await
            .map_err(|e| format!("flush 失败: {}", e))?;
        Ok(())
    } else {
        Err("音乐进程未运行".to_string())
    }
}

/// 发送命令并等待响应（用于需要同步返回的命令）
async fn send_command_with_response(
    app: &AppHandle,
    cmd: Value,
    response_key: &str,
) -> Result<Value, String> {
    ensure_process(app).await?;

    let music_state = app.state::<MusicState>();
    let (tx, rx) = oneshot::channel::<Value>();
    {
        let mut pending = music_state.pending.lock().await;
        pending.insert(response_key.to_string(), tx);
    }

    send_command(app, cmd).await?;

    match timeout(Duration::from_secs(5), rx).await {
        Ok(Ok(val)) => Ok(val),
        Ok(Err(_)) => Err("响应通道关闭".to_string()),
        Err(_) => {
            music_state.pending.lock().await.remove(response_key);
            Err("等待响应超时".to_string())
        }
    }
}

// ===== 播放控制命令 =====

#[tauri::command]
pub async fn music_toggle_play(app: AppHandle) -> Result<(), String> {
    send_command(&app, json!({ "command": "toggle" })).await
}

#[tauri::command]
pub async fn music_next(app: AppHandle) -> Result<(), String> {
    send_command(&app, json!({ "command": "next" })).await
}

#[tauri::command]
pub async fn music_prev(app: AppHandle) -> Result<(), String> {
    send_command(&app, json!({ "command": "prev" })).await
}

#[tauri::command]
pub async fn music_seek(app: AppHandle, seconds: f64) -> Result<(), String> {
    send_command(&app, json!({ "command": "seek", "position": seconds })).await
}

#[tauri::command]
pub async fn music_set_volume(app: AppHandle, volume: f64) -> Result<(), String> {
    send_command(&app, json!({ "command": "set_volume", "volume": volume })).await
}

#[tauri::command]
pub async fn music_set_play_mode(app: AppHandle, mode: String) -> Result<(), String> {
    send_command(&app, json!({ "command": "set_play_mode", "mode": mode })).await
}

// ===== 状态查询命令（fire-and-forget，数据通过事件返回） =====

#[tauri::command]
pub async fn music_get_status(app: AppHandle) -> Result<(), String> {
    send_command(&app, json!({ "command": "get_status" })).await
}

#[tauri::command]
pub async fn music_get_playlist(app: AppHandle) -> Result<(), String> {
    send_command(&app, json!({ "command": "get_playlist" })).await
}

#[tauri::command]
pub async fn music_get_devices(app: AppHandle) -> Result<(), String> {
    send_command(&app, json!({ "command": "get_devices" })).await
}

#[tauri::command]
pub async fn music_set_device(app: AppHandle, device_id: i64) -> Result<(), String> {
    send_command(&app, json!({ "command": "set_device", "device_id": device_id })).await
}

#[tauri::command]
pub async fn music_play_song(app: AppHandle, song_name: String) -> Result<(), String> {
    send_command(&app, json!({ "command": "play_song", "name": song_name })).await
}

// ===== 需要同步返回的命令 =====

#[tauri::command]
pub async fn music_delete_song(
    app: AppHandle,
    song_name: String,
) -> Result<Value, String> {
    let data = send_command_with_response(
        &app,
        json!({ "command": "delete_song", "name": song_name }),
        "delete_song",
    )
    .await?;

    let success = data
        .get("delete_result")
        .and_then(|v| v.as_str())
        .map(|s| s == "success")
        .unwrap_or(false);
    let error = data
        .get("delete_error")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(json!({ "success": success, "error": error }))
}

#[tauri::command]
pub async fn music_get_custom_tags(app: AppHandle) -> Result<Value, String> {
    let data = send_command_with_response(
        &app,
        json!({ "command": "get_custom_tags" }),
        "custom_tags",
    )
    .await?;

    let custom_tags = data
        .get("customTags")
        .cloned()
        .unwrap_or(json!({}));

    Ok(json!({ "success": true, "customTags": custom_tags }))
}

#[tauri::command]
pub async fn music_add_custom_tag(
    app: AppHandle,
    tag_name: String,
    color: String,
) -> Result<Value, String> {
    let data = send_command_with_response(
        &app,
        json!({ "command": "add_custom_tag", "name": tag_name, "color": color }),
        "custom_tag_added",
    )
    .await?;

    let success = data
        .get("success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let error = data
        .get("error")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(json!({ "success": success, "error": error }))
}

#[tauri::command]
pub async fn music_delete_custom_tag(
    app: AppHandle,
    tag_name: String,
) -> Result<Value, String> {
    let data = send_command_with_response(
        &app,
        json!({ "command": "delete_custom_tag", "name": tag_name }),
        "custom_tag_deleted",
    )
    .await?;

    let success = data
        .get("success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let error = data
        .get("error")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(json!({ "success": success, "error": error }))
}

#[tauri::command]
pub async fn music_update_tag(
    app: AppHandle,
    song_name: String,
    tag: String,
    color: Option<String>,
) -> Result<Value, String> {
    let data = send_command_with_response(
        &app,
        json!({ "command": "update_tag", "name": song_name, "tag": tag, "color": color }),
        "tag_updated",
    )
    .await?;

    let success = data
        .get("success")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let error = data
        .get("error")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(json!({ "success": success, "error": error }))
}
