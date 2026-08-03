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
        // 生产模式：app_data_dir/music（用户数据区）
        // 安装包内置歌曲在 resource_dir/music，启动时由 update::merge_music_dir
        // 合并到此处（不覆盖已有），安装/更新不会覆盖用户下载的歌曲
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
        Ok(app_data_dir.join("music"))
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
                // 同步听歌听众端：auto_next=false（播完保持等待，等 DJ 信号切歌）
                if !music_state.auto_next.load(Ordering::Relaxed) {
                    // 保持"播完"状态：进度照常上报（停在结尾），不自动切歌。
                    // 恢复 auto_next（退出同步）或 DJ 切歌信号到来后自然前进。
                    drop(player);
                    continue;
                }
                // 歌曲自然结束，播放下一首
                drop(player);
                {
                    let mut player = music_state.player.lock().await;
                    if let Some(next_song) = player.get_next_song(true) {
                        play_song_and_emit(&app, &mut player, &next_song).await;
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

/// 播放歌曲并推送前端事件（track-change / play-state / song-missing / play-error）
///
/// 多个命令共用（next/prev/play_song/自然结束切歌），统一错误处理与事件格式。
async fn play_song_and_emit(app: &AppHandle, player: &mut AudioPlayer, song_name: &str) {
    match player.play_song(song_name, 0.0) {
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
}

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

    match player.get_next_song(false) {
        Some(next_song) => play_song_and_emit(&app, &mut player, &next_song).await,
        None => {
            let _ = app.emit("music-no-music", json!({ "message": "没有可播放的音乐" }));
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn music_prev(app: AppHandle) -> Result<(), String> {
    ensure_init(&app).await?;
    let music_state = app.state::<MusicState>();
    let mut player = music_state.player.lock().await;

    match player.get_prev_song() {
        Some(prev_song) => play_song_and_emit(&app, &mut player, &prev_song).await,
        None => {
            let _ = app.emit("music-no-music", json!({ "message": "没有可播放的音乐" }));
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn music_seek(app: AppHandle, seconds: f64) -> Result<(), String> {
    ensure_init(&app).await?;
    let music_state = app.state::<MusicState>();
    let mut player = music_state.player.lock().await;

    player.seek(seconds)?;

    // seek 完成后立即推送进度，前端无需等 200ms 进度任务。
    // current 用播放器真实位置：seek 目标会被钳制到时长内，若直接回传传入
    // 的 seconds 会得到越界值（进度条超出最大值）
    let _ = app.emit(
        "music-progress",
        json!({
            "name": player.current_track(),
            "current": player.get_position(),
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

/// 设置歌曲自然结束后是否自动切下一首（同步听歌听众端置 false，播完等待 DJ 信号）
#[tauri::command]
pub async fn music_set_auto_next(app: AppHandle, enabled: bool) -> Result<(), String> {
    let music_state = app.state::<MusicState>();
    music_state.auto_next.store(enabled, Ordering::Relaxed);
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

    play_song_and_emit(&app, &mut player, &song_name).await;

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

// ===== P2P 传歌（服务器中转分片） =====
//
// 协议见 server-planning/API-implementation.md 5.1 节 P2P 段：
//   听众缺歌 → music:request_song → 服务器指定持有者（优先 DJ）
//   → 持有者 music:offer_song 分片上传服务器 → 服务器 music:song_chunk 转发
//   → 听众 music_receive_song_chunk 逐个落盘 → music_finalize_song 合并。
// 分片 128KB（base64 后约 170KB），单条 WS 消息可承载。

/// P2P 分片大小（字节）
const TRANSFER_CHUNK_SIZE: usize = 128 * 1024;

/// 清理歌曲名中的路径分隔符/非法字符，防止路径穿越
fn sanitize_song_name(name: &str) -> String {
    let base = name.split(['/', '\\']).next_back().unwrap_or(name);
    base.chars()
        .filter(|c| !matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*' | '\0' | '\n' | '\r'))
        .collect()
}

/// 临时分片目录（app_data_dir/.transfer/）
fn transfer_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {}", e))?;
    Ok(app_data_dir.join(".transfer"))
}

/// P2P 传歌：读取歌曲文件分片（DJ/持有者侧）
///
/// 返回：`{ success, song_name, chunk_index, total_chunks, chunk_size, data_base64 }`
#[tauri::command]
pub async fn music_read_song_chunk(
    app: AppHandle,
    song_name: String,
    chunk_index: u32,
) -> Result<Value, String> {
    let name = sanitize_song_name(&song_name);
    if name.is_empty() {
        return Ok(json!({ "success": false, "error": "invalid_song_name" }));
    }
    let music_dir = get_music_dir(&app)?;
    let path = music_dir.join(&name);
    if !path.is_file() {
        return Ok(json!({ "success": false, "error": "song_missing" }));
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("读取歌曲失败: {}", e))?;
    let total = bytes.len();
    if total == 0 {
        return Ok(json!({ "success": false, "error": "empty_song" }));
    }
    let total_chunks = ((total + TRANSFER_CHUNK_SIZE - 1) / TRANSFER_CHUNK_SIZE) as u32;
    if chunk_index >= total_chunks {
        return Ok(json!({
            "success": false,
            "error": "chunk_index_out_of_range",
            "total_chunks": total_chunks
        }));
    }
    let start = (chunk_index as usize) * TRANSFER_CHUNK_SIZE;
    let end = std::cmp::min(start + TRANSFER_CHUNK_SIZE, total);
    let chunk = &bytes[start..end];
    use base64::{engine::general_purpose, Engine};
    let data_b64 = general_purpose::STANDARD.encode(chunk);
    Ok(json!({
        "success": true,
        "song_name": name,
        "chunk_index": chunk_index,
        "total_chunks": total_chunks,
        "chunk_size": chunk.len(),
        "data_base64": data_b64,
    }))
}

/// P2P 传歌：保存收到的分片到临时文件（听众侧）
///
/// 每个分片单独写 `<app_data_dir>/.transfer/<song_name>.<idx>`，最后合并。
#[tauri::command]
pub async fn music_receive_song_chunk(
    app: AppHandle,
    song_name: String,
    chunk_index: u32,
    total_chunks: u32,
    data_base64: String,
) -> Result<Value, String> {
    let name = sanitize_song_name(&song_name);
    if name.is_empty() || total_chunks == 0 || chunk_index >= total_chunks {
        return Ok(json!({ "success": false, "error": "invalid_params" }));
    }
    let tdir = transfer_dir(&app)?;
    std::fs::create_dir_all(&tdir).map_err(|e| format!("创建临时目录失败: {}", e))?;
    use base64::{engine::general_purpose, Engine};
    let bytes = general_purpose::STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("分片解码失败: {}", e))?;
    let part_path = tdir.join(format!("{}.{:06}", name, chunk_index));
    std::fs::write(&part_path, &bytes).map_err(|e| format!("写入分片失败: {}", e))?;
    Ok(json!({ "success": true, "chunk_index": chunk_index }))
}

/// P2P 传歌：合并分片写入音乐目录并刷新播放列表（听众侧，传输完成后调用）
#[tauri::command]
pub async fn music_finalize_song(
    app: AppHandle,
    song_name: String,
    total_chunks: u32,
) -> Result<Value, String> {
    let name = sanitize_song_name(&song_name);
    if name.is_empty() || total_chunks == 0 {
        return Ok(json!({ "success": false, "error": "invalid_params" }));
    }
    let tdir = transfer_dir(&app)?;
    let music_dir = get_music_dir(&app)?;
    std::fs::create_dir_all(&music_dir).map_err(|e| format!("创建音乐目录失败: {}", e))?;
    let dest = music_dir.join(&name);

    use std::io::Write;
    let mut out = std::fs::File::create(&dest).map_err(|e| format!("创建歌曲文件失败: {}", e))?;
    for idx in 0..total_chunks {
        let part_path = tdir.join(format!("{}.{:06}", name, idx));
        let bytes = match std::fs::read(&part_path) {
            Ok(b) => b,
            Err(_) => {
                let _ = out.flush();
                let _ = std::fs::remove_file(&dest);
                return Ok(json!({
                    "success": false,
                    "error": format!("分片 {} 缺失，传输不完整", idx)
                }));
            }
        };
        out.write_all(&bytes).map_err(|e| format!("写入歌曲失败: {}", e))?;
    }
    out.flush().map_err(|e| format!("写入歌曲失败: {}", e))?;

    // 清理临时分片
    for idx in 0..total_chunks {
        let _ = std::fs::remove_file(tdir.join(format!("{}.{:06}", name, idx)));
    }

    // 刷新播放列表并推送前端（复用 music_get_playlist 的事件格式）
    ensure_init(&app).await?;
    let music_state = app.state::<MusicState>();
    let mut player = music_state.player.lock().await;
    player.refresh_playlist();
    let (songs, current_song, current_index) = player.get_playlist_with_tags();
    let _ = app.emit(
        "music-playlist",
        json!({
            "songs": songs,
            "current_song": current_song,
            "current_index": current_index
        }),
    );

    Ok(json!({ "success": true, "song_name": name }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_song_name_strips_paths() {
        // 防路径穿越：去掉目录部分
        assert_eq!(sanitize_song_name("a/../secret.mp3"), "secret.mp3");
        assert_eq!(sanitize_song_name("..\\..\\evil.mp3"), "evil.mp3");
        assert_eq!(sanitize_song_name("folder/song.mp3"), "song.mp3");
    }

    #[test]
    fn test_sanitize_song_name_strips_illegal_chars() {
        // Windows 非法字符被过滤
        assert_eq!(sanitize_song_name("a<b>c:d.mp3"), "abcd.mp3");
        assert_eq!(sanitize_song_name("a|b?c.mp3"), "abc.mp3");
    }

    #[test]
    fn test_sanitize_song_name_keeps_normal() {
        assert_eq!(sanitize_song_name("刚刚好.m4a"), "刚刚好.m4a");
        assert_eq!(sanitize_song_name("song - 副本 (1).mp3"), "song - 副本 (1).mp3");
    }

    #[test]
    fn test_transfer_chunk_size_positive() {
        assert!(TRANSFER_CHUNK_SIZE > 0);
        // 一首 6MB 的歌应分成约 48 片（符合 WS 消息大小限制）
        assert_eq!((6 * 1024 * 1024 + TRANSFER_CHUNK_SIZE - 1) / TRANSFER_CHUNK_SIZE, 48);
    }
}
