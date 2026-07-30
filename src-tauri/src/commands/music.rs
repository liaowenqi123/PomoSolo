//! 音乐播放器 commands（Rust 原生实现，不再依赖 music.py 子进程）
//!
//! 直接使用 rodio + symphonia 播放音频，通过 Tauri 事件与前端通信。
//!
//! 事件名（与前端 src/api/music.ts 对齐）：
//!   music-ready / music-status / music-track-change
//!   music-play-state / music-progress / music-devices
//!   music-no-music / music-play-error / music-volume-change
//!   music-play-mode / music-playlist / music-song-missing

use std::path::PathBuf;
use std::sync::atomic::Ordering;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::{interval, Duration};

use crate::modules::audio_player::{AudioPlayer, PlayMode};
use crate::state::MusicState;

/// 获取音乐目录路径
fn get_music_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) {
        // 开发模式：<project_root>/music-player/music/
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let path = PathBuf::from(manifest_dir)
            .parent()
            .ok_or("无法定位项目根目录")?
            .join("music-player")
            .join("music");
        Ok(path)
    } else {
        // 生产模式：resource_dir/music/
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|e| format!("无法获取资源目录: {}", e))?;
        Ok(resource_dir.join("music"))
    }
}

/// 确保播放器已初始化
async fn ensure_init(app: &AppHandle) -> Result<(), String> {
    let music_state = app.state::<MusicState>();

    if music_state.initialized.load(Ordering::Relaxed) {
        return Ok(());
    }

    let mut player = music_state.player.lock().await;

    // 设置音乐目录
    let music_dir = get_music_dir(app)?;
    player.set_music_dir(music_dir);

    // 初始化
    let has_music = player.init()?;

    music_state
        .initialized
        .store(true, Ordering::Relaxed);

    // 发送初始事件
    if has_music {
        let _ = app.emit(
            "music-ready",
            json!({
                "name": player.current_track(),
                "duration": player.current_duration(),
                "has_prev": true
            }),
        );
    } else {
        let _ = app.emit(
            "music-no-music",
            json!({ "message": "music文件夹中没有音乐文件" }),
        );
    }

    // 启动进度上报任务
    spawn_progress_task(app.clone());

    Ok(())
}

/// 启动进度上报任务
fn spawn_progress_task(app: AppHandle) {
    tokio::spawn(async move {
        let music_state = app.state::<MusicState>();
        // 200ms 上报间隔，保证 seek 后前端能在 ~200ms 内收到新进度
        // （之前 500ms 太慢，seek 后 seekTarget 要等 500ms 才清除，体感卡顿）
        let mut tick = interval(Duration::from_millis(200));

        loop {
            tick.tick().await;
            let player = music_state.player.lock().await;

            if !player.is_initialized() {
                continue;
            }

            // 检查歌曲是否结束
            if player.is_song_ended() && player.is_playing() {
                // 歌曲自然结束，播放下一首
                drop(player);
                {
                    let mut player = music_state.player.lock().await;
                    if let Some(next_song) = player.get_next_song(true) {
                        match player.play_song(&next_song, 0.0) {
                            Ok(()) => {
                                let _ = app.emit(
                                    "music-track-change",
                                    json!({
                                        "name": next_song,
                                        "duration": player.current_duration(),
                                        "has_prev": true
                                    }),
                                );
                                let _ = app.emit("music-play-state", json!({ "playing": true }));
                            }
                            Err(e) if e == "song_missing" => {
                                let _ = app.emit(
                                    "music-song-missing",
                                    json!({ "name": next_song, "message": "原歌曲已消失" }),
                                );
                            }
                            Err(e) => {
                                let _ = app.emit(
                                    "music-play-error",
                                    json!({ "message": format!("播放失败: {}", e) }),
                                );
                            }
                        }
                    } else {
                        let _ = app.emit(
                            "music-no-music",
                            json!({ "message": "没有可播放的音乐" }),
                        );
                    }
                }
                continue;
            }

            // 发送进度（带歌曲名，前端按名过滤过期事件，避免切歌时旧 progress 把进度条弹回）
            let position = player.get_position();
            let duration = player.current_duration();
            if duration > 0 {
                let _ = app.emit(
                    "music-progress",
                    json!({
                        "name": player.current_track(),
                        "current": position,
                        "duration": duration
                    }),
                );
            }
        }
    });
}

// ===== 播放控制命令 =====

#[tauri::command]
pub async fn music_toggle_play(app: AppHandle) -> Result<(), String> {
    ensure_init(&app).await?;
    let music_state = app.state::<MusicState>();
    let mut player = music_state.player.lock().await;

    // toggle_play 返回 true 表示首次播放（刚加载歌曲），false 表示暂停/恢复
    let first_play = match player.toggle_play() {
        Ok(first) => first,
        Err(e) => {
            if e == "song_missing" {
                let track = player.current_track().to_string();
                let _ = app.emit(
                    "music-song-missing",
                    json!({ "name": track, "message": "原歌曲已消失" }),
                );
                return Ok(());
            }
            let _ = app.emit(
                "music-play-error",
                json!({ "message": format!("播放失败: {}", e) }),
            );
            return Ok(());
        }
    };

    let playing = player.is_playing();

    // 仅首次播放发送 track-change（恢复播放不发，避免前端把 currentTime 重置为 0）
    if first_play && playing && !player.current_track().is_empty() {
        let _ = app.emit(
            "music-track-change",
            json!({
                "name": player.current_track(),
                "duration": player.current_duration(),
                "has_prev": true
            }),
        );
    }

    let _ = app.emit("music-play-state", json!({ "playing": playing }));

    // 恢复播放时立即推送当前进度，避免 200ms tick 真空期导致进度条闪烁
    if playing {
        let _ = app.emit(
            "music-progress",
            json!({
                "name": player.current_track(),
                "current": player.get_position(),
                "duration": player.current_duration()
            }),
        );
    }

    Ok(())
}

#[tauri::command]
pub async fn music_next(app: AppHandle) -> Result<(), String> {
    ensure_init(&app).await?;
    let music_state = app.state::<MusicState>();
    let mut player = music_state.player.lock().await;

    if let Some(next_song) = player.get_next_song(false) {
        match player.play_song(&next_song, 0.0) {
            Ok(()) => {
                let _ = app.emit(
                    "music-track-change",
                    json!({
                        "name": next_song,
                        "duration": player.current_duration(),
                        "has_prev": true
                    }),
                );
                let _ = app.emit("music-play-state", json!({ "playing": true }));
            }
            Err(e) if e == "song_missing" => {
                let _ = app.emit(
                    "music-song-missing",
                    json!({ "name": next_song, "message": "原歌曲已消失" }),
                );
            }
            Err(e) => {
                let _ = app.emit(
                    "music-play-error",
                    json!({ "message": format!("播放失败: {}", e) }),
                );
            }
        }
    } else {
        let _ = app.emit("music-no-music", json!({ "message": "没有可播放的音乐" }));
    }

    Ok(())
}

#[tauri::command]
pub async fn music_prev(app: AppHandle) -> Result<(), String> {
    ensure_init(&app).await?;
    let music_state = app.state::<MusicState>();
    let mut player = music_state.player.lock().await;

    if let Some(prev_song) = player.get_prev_song() {
        match player.play_song(&prev_song, 0.0) {
            Ok(()) => {
                let _ = app.emit(
                    "music-track-change",
                    json!({
                        "name": prev_song,
                        "duration": player.current_duration(),
                        "has_prev": true
                    }),
                );
                let _ = app.emit("music-play-state", json!({ "playing": true }));
            }
            Err(e) if e == "song_missing" => {
                let _ = app.emit(
                    "music-song-missing",
                    json!({ "name": prev_song, "message": "原歌曲已消失" }),
                );
            }
            Err(e) => {
                let _ = app.emit(
                    "music-play-error",
                    json!({ "message": format!("播放失败: {}", e) }),
                );
            }
        }
    } else {
        let _ = app.emit("music-no-music", json!({ "message": "没有可播放的音乐" }));
    }

    Ok(())
}

#[tauri::command]
pub async fn music_seek(app: AppHandle, seconds: f64) -> Result<(), String> {
    ensure_init(&app).await?;
    let music_state = app.state::<MusicState>();
    let mut player = music_state.player.lock().await;

    player.seek(seconds)?;

    // seek 完成后立即推送进度，前端无需等 200ms 进度任务
    let _ = app.emit(
        "music-progress",
        json!({
            "name": player.current_track(),
            "current": seconds as u64,
            "duration": player.current_duration()
        }),
    );

    Ok(())
}

#[tauri::command]
pub async fn music_set_volume(app: AppHandle, volume: f32) -> Result<(), String> {
    ensure_init(&app).await?;
    let music_state = app.state::<MusicState>();
    let mut player = music_state.player.lock().await;

    player.set_volume(volume);

    let _ = app.emit("music-volume-change", json!({ "volume": volume }));

    Ok(())
}

#[tauri::command]
pub async fn music_set_play_mode(app: AppHandle, mode: String) -> Result<(), String> {
    ensure_init(&app).await?;
    let music_state = app.state::<MusicState>();
    let mut player = music_state.player.lock().await;

    let play_mode = PlayMode::from_str(&mode);
    player.set_play_mode(play_mode);

    let _ = app.emit("music-play-mode", json!({ "mode": play_mode.as_str() }));

    Ok(())
}

// ===== 状态查询命令（通过事件返回数据） =====

#[tauri::command]
pub async fn music_get_status(app: AppHandle) -> Result<(), String> {
    ensure_init(&app).await?;
    let music_state = app.state::<MusicState>();
    let player = music_state.player.lock().await;

    let snapshot = player.snapshot();
    let _ = app.emit("music-status", json!(snapshot));

    Ok(())
}

#[tauri::command]
pub async fn music_get_playlist(app: AppHandle) -> Result<(), String> {
    ensure_init(&app).await?;
    let music_state = app.state::<MusicState>();
    let mut player = music_state.player.lock().await;

    let (songs, current_song, current_index) = player.get_playlist_with_tags();

    let _ = app.emit(
        "music-playlist",
        json!({
            "songs": songs,
            "current_song": current_song,
            "current_index": current_index
        }),
    );

    Ok(())
}

#[tauri::command]
pub async fn music_get_devices(app: AppHandle) -> Result<(), String> {
    let devices = AudioPlayer::list_devices();
    let current = {
        let music_state = app.state::<MusicState>();
        let player = music_state.player.lock().await;
        player.current_device()
    };

    let _ = app.emit("music-devices", json!({ "devices": devices, "current": current }));

    Ok(())
}

#[tauri::command]
pub async fn music_set_device(app: AppHandle, device_id: i64) -> Result<(), String> {
    ensure_init(&app).await?;
    let music_state = app.state::<MusicState>();
    let mut player = music_state.player.lock().await;

    player.set_device(device_id as usize)?;

    // 发送更新后的设备列表
    let devices = AudioPlayer::list_devices();
    let current = player.current_device();
    let _ = app.emit("music-devices", json!({ "devices": devices, "current": current }));

    Ok(())
}

#[tauri::command]
pub async fn music_play_song(app: AppHandle, song_name: String) -> Result<(), String> {
    ensure_init(&app).await?;
    let music_state = app.state::<MusicState>();
    let mut player = music_state.player.lock().await;

    // 刷新播放列表确保歌曲存在
    player.refresh_playlist();

    match player.play_song(&song_name, 0.0) {
        Ok(()) => {
            let _ = app.emit(
                "music-track-change",
                json!({
                    "name": song_name,
                    "duration": player.current_duration(),
                    "has_prev": true
                }),
            );
            let _ = app.emit("music-play-state", json!({ "playing": true }));
        }
        Err(e) if e == "song_missing" => {
            let _ = app.emit(
                "music-song-missing",
                json!({ "name": song_name, "message": "原歌曲已消失" }),
            );
        }
        Err(e) => {
            let _ = app.emit(
                "music-play-error",
                json!({ "message": format!("播放失败: {}", e) }),
            );
        }
    }

    Ok(())
}

// ===== 需要同步返回的命令 =====

#[tauri::command]
pub async fn music_delete_song(
    app: AppHandle,
    song_name: String,
) -> Result<Value, String> {
    ensure_init(&app).await?;
    let music_state = app.state::<MusicState>();
    let mut player = music_state.player.lock().await;

    match player.delete_song(&song_name) {
        Ok(()) => Ok(json!({ "success": true })),
        Err(e) => Ok(json!({ "success": false, "error": e })),
    }
}

#[tauri::command]
pub async fn music_get_custom_tags(app: AppHandle) -> Result<Value, String> {
    ensure_init(&app).await?;
    let music_state = app.state::<MusicState>();
    let player = music_state.player.lock().await;

    let custom_tags = player.get_custom_tags();
    Ok(json!({ "success": true, "customTags": custom_tags }))
}

#[tauri::command]
pub async fn music_add_custom_tag(
    app: AppHandle,
    tag_name: String,
    color: String,
) -> Result<Value, String> {
    ensure_init(&app).await?;
    let music_state = app.state::<MusicState>();
    let player = music_state.player.lock().await;

    match player.add_custom_tag(&tag_name, &color) {
        Ok(()) => Ok(json!({ "success": true })),
        Err(e) => Ok(json!({ "success": false, "error": e })),
    }
}

#[tauri::command]
pub async fn music_delete_custom_tag(
    app: AppHandle,
    tag_name: String,
) -> Result<Value, String> {
    ensure_init(&app).await?;
    let music_state = app.state::<MusicState>();
    let player = music_state.player.lock().await;

    match player.delete_custom_tag(&tag_name) {
        Ok(()) => Ok(json!({ "success": true })),
        Err(e) => Ok(json!({ "success": false, "error": e })),
    }
}

#[tauri::command]
pub async fn music_update_tag(
    app: AppHandle,
    song_name: String,
    tag: String,
    color: Option<String>,
) -> Result<Value, String> {
    ensure_init(&app).await?;
    let music_state = app.state::<MusicState>();
    let player = music_state.player.lock().await;

    match player.update_song_tag(&song_name, &tag, color.as_deref()) {
        Ok(()) => Ok(json!({ "success": true })),
        Err(e) => Ok(json!({ "success": false, "error": e })),
    }
}
