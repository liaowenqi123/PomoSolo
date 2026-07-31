//! 系统集成 commands：开机自启 + 全局快捷键
//!
//! - `tauri-plugin-autostart` 封装系统级登录项（Windows 注册表 / macOS LaunchAgent / Linux .desktop）
//! - `tauri-plugin-global-shortcut` 注册媒体键，控制音乐播放
//!
//! 对应旧版 Electron：
//!   - `ipc-cloud.js` 中的 `set-auto-start` / `get-auto-start`（`app.setLoginItemSettings`）
//!   - 旧版未实现全局快捷键，本次为 Tauri 版新增（媒体键 → 音乐播放控制）

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

/// 开启/关闭登录项。对应前端 `api/system.ts` 的 `autostartEnable(enabled)`。
#[tauri::command]
pub async fn autostart_enable(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let autolaunch = app.autolaunch();
    if enabled {
        autolaunch
            .enable()
            .map_err(|e| format!("开启开机自启失败: {}", e))?;
    } else {
        autolaunch
            .disable()
            .map_err(|e| format!("关闭开机自启失败: {}", e))?;
    }
    Ok(autolaunch.is_enabled().unwrap_or(false))
}

/// 查询当前开机自启状态。对应前端 `api/system.ts` 的 `autostartIsEnabled()`。
#[tauri::command]
pub async fn autostart_is_enabled(app: AppHandle) -> Result<bool, String> {
    Ok(app.autolaunch().is_enabled().unwrap_or(false))
}

/// 与应用启动时同步登录项状态到设置：
/// 若 `settings.autoStart` 为 true 但系统未注册，则注册；
/// 若为 false 但系统已注册，则取消。返回最终状态。
///
/// 在 `setup` 阶段调用一次，保证"设置 → 系统"的一致性。
pub fn sync_autostart_with_settings(app: &AppHandle, enabled: bool) -> bool {
    let autolaunch = app.autolaunch();
    let current = autolaunch.is_enabled().unwrap_or(false);
    if enabled && !current {
        let _ = autolaunch.enable();
    } else if !enabled && current {
        let _ = autolaunch.disable();
    }
    autolaunch.is_enabled().unwrap_or(false)
}

/// 媒体键 → 音乐命令 映射表（纯逻辑，便于测试）。
///
/// 返回 Some(命令名) 或 None（未识别的键）。
///
/// 键名对应 `keyboard-types::Code` 的 Debug 表示：
///   - "MediaPlayPause" → Code::MediaPlayPause
///   - "MediaTrackNext" → Code::MediaTrackNext
///   - "MediaTrackPrevious" → Code::MediaTrackPrevious
pub fn media_key_to_command(key: &str) -> Option<&'static str> {
    match key {
        "MediaPlayPause" => Some("music_toggle_play"),
        "MediaTrackNext" => Some("music_next"),
        "MediaTrackPrevious" => Some("music_prev"),
        _ => None,
    }
}

/// 异步分发媒体键到对应的音乐命令。
pub async fn dispatch_media_key(app: &AppHandle, key: &str) -> Result<(), String> {
    match media_key_to_command(key) {
        Some("music_toggle_play") => crate::commands::music::music_toggle_play(app.clone()).await,
        Some("music_next") => crate::commands::music::music_next(app.clone()).await,
        Some("music_prev") => crate::commands::music::music_prev(app.clone()).await,
        _ => Ok(()),
    }
}

/// 注册媒体键全局快捷键。在 `setup` 阶段调用一次。
///
/// 快捷键冲突时由系统裁决（不强制抢占）。
pub fn register_media_shortcuts(app: &AppHandle) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

    // global_shortcut() 返回 &GlobalShortcut，失败时返回空引用（插件未注册）
    let manager = app.global_shortcut();

    for key in ["MediaPlayPause", "MediaTrackNext", "MediaTrackPrevious"] {
        if let Ok(shortcut) = key.parse::<Shortcut>() {
            if let Err(e) = manager.register(shortcut) {
                eprintln!("[system] 注册快捷键 {} 失败: {}", key, e);
            }
        }
    }
}

// ============ 测试 ============

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_key_to_command_known_keys() {
        assert_eq!(media_key_to_command("MediaPlayPause"), Some("music_toggle_play"));
        assert_eq!(media_key_to_command("MediaTrackNext"), Some("music_next"));
        assert_eq!(media_key_to_command("MediaTrackPrevious"), Some("music_prev"));
    }

    #[test]
    fn media_key_to_command_unknown_key() {
        assert_eq!(media_key_to_command("Ctrl+Shift+P"), None);
        assert_eq!(media_key_to_command(""), None);
        assert_eq!(media_key_to_command("MediaStop"), None);
    }

    #[test]
    fn sync_autostart_helper_signature() {
        let _f: fn(&AppHandle, bool) -> bool = sync_autostart_with_settings;
    }

    #[test]
    fn register_media_shortcuts_helper_signature() {
        let _f: fn(&AppHandle) = register_media_shortcuts;
    }
}
