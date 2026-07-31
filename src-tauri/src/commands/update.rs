//! 自动更新 commands
//!
//! 基于 tauri-plugin-updater 实现检查更新 / 下载安装。
//! 兼容原 Electron 版（electron-updater）的事件协议：
//!   emit("update-status", { status, version, ... })
//!
//! 状态机：
//!   checking → available | not-available | error
//!   available → (用户点击下载) → downloading → downloaded → (自动安装重启)
//!
//! 用户数据备份：
//!   安装更新会覆盖 resource_dir/music/，所以下载前备份用户下载的歌曲
//!   （跳过三首内置歌曲 " - 番茄钟.mp3"），应用启动时还原。

use serde::Serialize;
use std::fs;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

/// 获取备份数据目录（与 data.json 同级：app_data_dir/PomoSolo/）
fn get_backup_base_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let mut path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取数据目录: {}", e))?;
    path.push("PomoSolo");
    fs::create_dir_all(&path).map_err(|e| format!("创建数据目录失败: {}", e))?;
    Ok(path)
}

/// 更新信息（返回给前端）
#[derive(Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
    pub date: Option<String>,
}

/// 检查更新
///
/// 返回 Ok(Some(info)) 表示有更新，Ok(None) 表示已是最新。
/// 同时 emit "update-status" 事件（status: available / not-available / error）。
#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    // dev 模式跳过（updater 在 dev 下无法工作）
    if cfg!(debug_assertions) {
        return Ok(None);
    }

    let _ = app.emit("update-status", serde_json::json!({ "status": "checking" }));

    let updater = app.updater().map_err(|e| {
        let msg = format!("初始化更新器失败: {}", e);
        let _ = app.emit("update-status", serde_json::json!({
            "status": "error",
            "message": msg,
        }));
        msg
    })?;

    let update = match updater.check().await {
        Ok(Some(u)) => u,
        Ok(None) => {
            let _ = app.emit("update-status", serde_json::json!({
                "status": "not-available",
            }));
            return Ok(None);
        }
        Err(e) => {
            let msg = format!("检查更新失败: {}", e);
            let _ = app.emit("update-status", serde_json::json!({
                "status": "error",
                "message": msg,
            }));
            return Err(msg);
        }
    };

    let info = UpdateInfo {
        version: update.version.clone(),
        notes: update.body.clone().unwrap_or_default(),
        date: update.date.map(|d| d.to_string()),
    };

    let _ = app.emit(
        "update-status",
        serde_json::json!({
            "status": "available",
            "version": &info.version,
            "releaseDate": &info.date,
        }),
    );

    Ok(Some(info))
}

/// 下载并安装更新
///
/// 流程：备份用户数据 → 下载 → 安装 → 应用退出重启。
/// 通过 "update-status" 事件报告下载进度（status: downloading / downloaded / error）。
#[tauri::command]
pub async fn download_and_install(app: AppHandle) -> Result<(), String> {
    if cfg!(debug_assertions) {
        return Err("开发模式不支持安装更新".to_string());
    }

    // 1. 备份用户下载的歌曲（避免被安装包覆盖）
    if let Err(e) = backup_music_dir(&app) {
        eprintln!("[updater] 备份 music/ 目录失败: {}", e);
        // 备份失败不阻塞更新，继续
    }

    let updater = app.updater().map_err(|e| format!("初始化更新器失败: {}", e))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("检查更新失败: {}", e))?
        .ok_or_else(|| "没有可用更新".to_string())?;

    let app_for_progress = app.clone();
    let mut transferred: u64 = 0;

    // 2. 下载并安装（安装后应用会自动退出重启）
    update
        .download_and_install(
            move |chunk_len: usize, total: Option<u64>| {
                transferred = transferred.saturating_add(chunk_len as u64);
                let percent = if let Some(total) = total {
                    if total > 0 {
                        (transferred as f64 / total as f64 * 100.0).round() as u64
                    } else {
                        0
                    }
                } else {
                    0
                };
                let _ = app_for_progress.emit(
                    "update-status",
                    serde_json::json!({
                        "status": "downloading",
                        "percent": percent,
                        "transferred": transferred,
                        "total": total,
                    }),
                );
            },
            || {
                // 下载完成回调（即将安装）
            },
        )
        .await
        .map_err(|e| {
            let msg = format!("下载/安装更新失败: {}", e);
            let _ = app.emit("update-status", serde_json::json!({
                "status": "error",
                "message": msg,
            }));
            msg
        })?;

    // 安装完成后应用会退出，这里通常不会执行到
    let _ = app.emit(
        "update-status",
        serde_json::json!({ "status": "downloaded" }),
    );

    Ok(())
}

/// 备份 resource_dir/music/ 到 app_config_dir/backup/music/
///
/// 跳过三首内置歌曲（文件名以 " - 番茄钟.mp3" 结尾）。
/// 在下载安装更新前调用，防止安装包覆盖用户下载的歌曲。
fn backup_music_dir(app: &AppHandle) -> Result<(), String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("无法获取资源目录: {}", e))?;
    let music_dir = resource_dir.join("music");

    if !music_dir.exists() {
        return Ok(());
    }

    let config_dir = get_backup_base_dir(app)?;
    let backup_dir = config_dir.join("backup").join("music");
    // 清理旧备份
    if backup_dir.exists() {
        fs::remove_dir_all(&backup_dir).map_err(|e| format!("清理旧备份失败: {}", e))?;
    }
    fs::create_dir_all(&backup_dir).map_err(|e| format!("创建备份目录失败: {}", e))?;

    let mut backed_up = 0;
    for entry in fs::read_dir(&music_dir).map_err(|e| format!("读取 music/ 失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let filename = entry.file_name();
        let name = filename.to_string_lossy();

        // 跳过内置歌曲（避免备份 14MB 的固定文件）
        if is_builtin_song(&name) {
            continue;
        }

        let dest = backup_dir.join(&filename);
        fs::copy(entry.path(), &dest).map_err(|e| format!("备份文件 {} 失败: {}", name, e))?;
        backed_up += 1;
    }

    eprintln!("[updater] 已备份 {} 个用户文件到 {:?}", backed_up, backup_dir);
    Ok(())
}

/// 判断文件名是否为内置番茄钟歌曲（应跳过备份）
///
/// 内置歌曲命名格式："艺术家 - 番茄钟.mp3"（共 3 首），跳过避免重复备份 14MB。
fn is_builtin_song(filename: &str) -> bool {
    filename.ends_with(" - 番茄钟.mp3")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_builtin_song_matches_pattern() {
        assert!(is_builtin_song("钢琴曲 - 番茄钟.mp3"));
        assert!(is_builtin_song("吉他曲 - 番茄钟.mp3"));
        assert!(is_builtin_song("环境音 - 番茄钟.mp3"));
    }

    #[test]
    fn test_is_builtin_song_rejects_user_mp3() {
        assert!(!is_builtin_song("周杰伦 - 稻香.mp3"));
        assert!(!is_builtin_song("纯音乐.mp3"));
    }

    #[test]
    fn test_is_builtin_song_rejects_m4a() {
        // 内置歌曲均为 mp3，m4a 应不视为内置
        assert!(!is_builtin_song("钢琴曲 - 番茄钟.m4a"));
    }

    #[test]
    fn test_is_builtin_song_rejects_empty() {
        assert!(!is_builtin_song(""));
    }

    #[test]
    fn test_is_builtin_song_minimal_match() {
        // 仅 " - 番茄钟.mp3" 也满足 ends_with 判断（视为内置，保守跳过）
        assert!(is_builtin_song(" - 番茄钟.mp3"));
    }

    #[test]
    fn test_is_builtin_song_case_sensitive() {
        // 文件名检查大小写敏感（与旧版行为一致）
        assert!(!is_builtin_song("钢琴曲 - 番茄钟.MP3"));
        assert!(!is_builtin_song("钢琴曲 - 番茄钟.Mp3"));
    }
}

/// 还原 app_config_dir/backup/music/ 到 resource_dir/music/
///
/// 在应用启动时调用（setup 钩子），恢复用户下载的歌曲。
/// 还原后删除备份目录。
pub fn restore_music_dir(app: &AppHandle) -> Result<(), String> {
    let config_dir = get_backup_base_dir(app)?;
    let backup_dir = config_dir.join("backup").join("music");

    if !backup_dir.exists() {
        return Ok(());
    }

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("无法获取资源目录: {}", e))?;
    let music_dir = resource_dir.join("music");
    fs::create_dir_all(&music_dir).map_err(|e| format!("创建 music/ 目录失败: {}", e))?;

    let mut restored = 0;
    for entry in fs::read_dir(&backup_dir).map_err(|e| format!("读取备份失败: {}", e))? {
        let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
        let filename = entry.file_name();
        let dest = music_dir.join(&filename);
        fs::copy(entry.path(), &dest).map_err(|e| format!("还原文件失败: {}", e))?;
        restored += 1;
    }

    // 还原后删除备份
    fs::remove_dir_all(&backup_dir)
        .map_err(|e| format!("删除备份目录失败: {}", e))?;

    eprintln!("[updater] 已从备份还原 {} 个用户文件", restored);
    Ok(())
}
