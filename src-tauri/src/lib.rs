mod commands;
mod modules;
mod state;

use state::{AppState, ChartsState, MusicState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            // 菜园子
            commands::garden::garden_read,
            commands::garden::garden_write,
            commands::garden::garden_plant,
            commands::garden::garden_harvest,
            commands::garden::garden_buy,
            commands::garden::garden_sell,
            commands::garden::garden_unlock,
            commands::garden::garden_signin,
            commands::garden::garden_update_focus,
            commands::garden::garden_punishment,
            // AI 规划助手
            commands::ai::ai_generate_plan,
            // 自习室
            commands::study_room::study_room_get_active,
            commands::study_room::study_room_create,
            commands::study_room::study_room_join,
            commands::study_room::study_room_leave,
            commands::study_room::study_room_get_ranking,
            commands::study_room::study_room_get_members,
            // 前台检测
            commands::foreground::foreground_start,
            commands::foreground::foreground_stop,
            commands::foreground::foreground_get_status,
            commands::foreground::foreground_set_api_key,
            commands::foreground::foreground_is_ready,
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
            // 音乐榜单 / 下载
            commands::charts::charts_fetch,
            commands::charts::download_song,
            commands::charts::get_download_status,
            commands::charts::charts_set_api_key,
        ])
        .setup(|_app| {
            // Windows 11：禁用 DWM 系统级窗口圆角，避免与 CSS 圆角形成双层圆角。
            // 系统边框（细线阴影）由 tauri.conf.json 的 `shadow: false` 配置移除，
            // 不要在此处修改窗口样式（WS_THICKFRAME 等），否则 DWM 会回退到老式边框渲染。
            #[cfg(windows)]
            {
                if let Some(main_window) = _app.get_webview_window("main") {
                    commands::window::disable_window_rounding(&main_window);
                }
                if let Some(garden_window) = _app.get_webview_window("garden") {
                    commands::window::disable_window_rounding(&garden_window);
                }
            }
            #[cfg(debug_assertions)]
            {
                // 开发模式下打开 DevTools
                let main_window = _app.get_webview_window("main").unwrap();
                main_window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
