mod commands;
mod modules;
mod state;

use state::{AppState, ChartsState, MusicState};
use tauri::{Manager, Emitter};

/// Windows 11：禁用 DWM 系统级窗口圆角，避免与 CSS 圆角形成双层圆角。
/// 系统边框（细线阴影）由 tauri.conf.json 的 `shadow: false` 配置移除，
/// 不要在此处修改窗口样式（WS_THICKFRAME 等），否则 DWM 会回退到老式边框渲染。
#[cfg(windows)]
fn disable_windows_rounding(app: &tauri::App) {
    if let Some(main_window) = app.get_webview_window("main") {
        commands::window::disable_window_rounding(&main_window);
    }
    if let Some(garden_window) = app.get_webview_window("garden") {
        commands::window::disable_window_rounding(&garden_window);
    }
}

/// 合并内置歌曲/历史备份到用户音乐目录（app_data_dir/music，不覆盖已有）
fn merge_builtin_music(app: &tauri::App) {
    if let Err(e) = commands::update::merge_music_dir(app.handle()) {
        eprintln!("[setup] 合并音乐目录失败: {}", e);
    }
}

/// 同步开机自启状态：从 settings.json 读取 autoStart，同步到系统登录项
fn sync_autostart(app: &tauri::App) {
    let autostart_enabled = modules::data_manager::read_settings(app.handle())
        .ok()
        .and_then(|s| s.get("autoStart").and_then(|v| v.as_bool()))
        .unwrap_or(false);
    commands::system::sync_autostart_with_settings(app.handle(), autostart_enabled);
}

/// 迷你模式激活时拦截窗口关闭事件 → 退出迷你模式而非退出应用
fn intercept_close_to_exit_mini_mode(app: &tauri::App) {
    let handle = app.handle().clone();
    let main_window = match app.get_webview_window("main") {
        Some(w) => w,
        None => return,
    };
    main_window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { .. } = event {
            let state = handle.state::<crate::state::AppState>();
            if *state.mini_mode_active.lock().unwrap() {
                // 在迷你模式下：退出迷你模式 + 前端同步关闭页面
                let h = handle.clone();
                tauri::async_runtime::spawn(async move {
                    commands::window::exit_mini_mode(h).await;
                });
                // 通过事件通知前端退出迷你模式
                handle.emit("exit-mini-mode-from-close", ()).ok();
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        // Code 的 Debug 表示即变体名（如 "MediaPlayPause"）
                        let key = format!("{:?}", shortcut.key);
                        let handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = commands::system::dispatch_media_key(&handle, &key).await;
                        });
                    }
                })
                .build(),
        )
        .manage(AppState::new())
        .manage(MusicState::new())
        .manage(ChartsState::new())
        .invoke_handler(tauri::generate_handler![
            // 计时器
            commands::timer::get_timer_state,
            // 数据
            commands::data::read_data,
            commands::data::write_data,
            commands::data::read_settings,
            commands::data::write_settings,
            // 窗口
            commands::window::close_window,
            commands::window::minimize_window,
            commands::window::set_always_on_top,
            commands::window::bring_to_front,
            commands::window::cancel_always_on_top,
            commands::window::show_garden_window,
            commands::window::hide_garden_window,
            commands::window::enter_mini_mode,
            commands::window::exit_mini_mode,
            commands::window::update_mini_position,
            commands::window::open_external,
            // 云端认证
            commands::cloud_auth::save_credentials,
            commands::cloud_auth::load_credentials,
            commands::cloud_auth::clear_credentials,
            commands::cloud_auth::cloud_login,
            commands::cloud_auth::cloud_register,
            commands::cloud_auth::cloud_logout,
            commands::cloud_auth::cloud_get_session,
            commands::cloud_auth::cloud_test_connection,
            commands::cloud_auth::get_api_key,
            commands::cloud_auth::save_api_key,
            commands::cloud_auth::get_api_mode,
            commands::cloud_auth::set_api_mode,
            // 用户反馈
            commands::cloud_auth::submit_feedback,
            commands::cloud_auth::get_user_feedbacks,
            commands::cloud_auth::delete_feedback,
            // 云端同步（设置 / 番茄钟记录）
            commands::sync::cloud_sync_pull_settings,
            commands::sync::cloud_sync_push_settings,
            commands::sync::cloud_upload_pomodoro_records,
            // 菜园子
            commands::garden::garden_read,
            commands::garden::garden_write,
            commands::garden::garden_plant,
            commands::garden::garden_harvest,
            commands::garden::garden_buy,
            commands::garden::garden_sell,
            commands::garden::garden_sell_all,
            commands::garden::garden_unlock,
            commands::garden::garden_signin,
            commands::garden::garden_update_focus,
            commands::garden::garden_punishment,
            commands::garden::garden_grow,
            commands::garden::garden_unlock_easteregg,
            // AI 规划助手
            commands::ai::ai_generate_plan,
            // 自习室
            commands::study_room::study_room_get_active,
            commands::study_room::study_room_get_detail,
            commands::study_room::study_room_delete,
            commands::study_room::study_room_update,
            commands::study_room::study_room_create,
            commands::study_room::study_room_join,
            commands::study_room::study_room_leave,
            commands::study_room::study_room_get_ranking,
            commands::study_room::study_room_get_members,
            commands::study_room::study_room_upload_stats,
            commands::study_room::study_room_update_status,
            // 前台检测
            commands::foreground::foreground_start,
            commands::foreground::foreground_stop,
            commands::foreground::foreground_get_status,
            commands::foreground::foreground_set_api_key,
            commands::foreground::foreground_is_ready,
            commands::foreground::foreground_add_whitelist,
            commands::foreground::foreground_add_blacklist,
            commands::foreground::foreground_mark_history_not,
            commands::foreground::foreground_move_blacklist_to_whitelist,
            commands::foreground::foreground_get_config,
            // 音乐播放器
            commands::music::music_toggle_play,
            commands::music::music_next,
            commands::music::music_prev,
            commands::music::music_seek,
            commands::music::music_set_volume,
            commands::music::music_set_play_mode,
            commands::music::music_get_status,
            commands::music::music_get_playlist,
            commands::music::music_get_devices,
            commands::music::music_set_device,
            commands::music::music_play_song,
            commands::music::music_delete_song,
            commands::music::music_get_custom_tags,
            commands::music::music_add_custom_tag,
            commands::music::music_delete_custom_tag,
            commands::music::music_update_tag,
            // P2P 传歌（服务器中转分片）
            commands::music::music_read_song_chunk,
            commands::music::music_receive_song_chunk,
            commands::music::music_finalize_song,
            // 音乐榜单 / 下载
            commands::charts::charts_fetch,
            commands::charts::download_song,
            commands::charts::get_download_status,
            commands::charts::charts_set_api_key,
            // 同步听歌（自建服务器实时）
            commands::music_sync::music_sync_play,
            commands::music_sync::music_sync_pause,
            commands::music_sync::music_sync_seek,
            commands::music_sync::music_sync_next,
            commands::music_sync::music_sync_volume,
            commands::music_sync::music_sync_add_song,
            commands::music_sync::music_sync_request_dj,
            // 同步听歌增强：全量状态快照 + P2P 传歌 + 传歌方案
            commands::music_sync::music_sync_state,
            commands::music_sync::music_sync_request_song,
            commands::music_sync::music_sync_offer_song,
            commands::music_sync::music_sync_transfer_done,
            commands::music_sync::music_sync_transfer_failed,
            commands::music_sync::music_sync_set_config,
            commands::music_sync::music_sync_request_state,
            // 自动更新
            commands::update::check_update,
            commands::update::download_and_install,
            // 系统集成（开机自启）
            commands::system::autostart_enable,
            commands::system::autostart_is_enabled,
        ])
        .setup(|app| {
            // Windows 11：禁用 DWM 系统级窗口圆角，避免与 CSS 圆角形成双层圆角
            #[cfg(windows)]
            disable_windows_rounding(app);

            // 合并内置歌曲/历史备份到用户音乐目录（不覆盖已有）
            merge_builtin_music(app);

            // 系统托盘：对照旧版 Electron 的行为，仅在迷你模式下创建/销毁。
            // 不再在 setup 中创建持久托盘，避免迷你模式下出现两个托盘图标。
            // 迷你模式托盘创建逻辑见 commands::window::enter_mini_mode。

            // 同步开机自启状态：从 settings.json 读取 autoStart，同步到系统登录项
            sync_autostart(app);

            // 注册媒体键全局快捷键（播放/暂停、上一首、下一首）
            commands::system::register_media_shortcuts(app.handle());

            // 迷你模式激活时拦截窗口关闭事件 → 退出迷你模式而非退出应用
            intercept_close_to_exit_mini_mode(app);

            #[cfg(debug_assertions)]
            {
                // 开发模式下打开 DevTools
                let main_window = app.get_webview_window("main").unwrap();
                main_window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
