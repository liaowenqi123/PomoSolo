mod commands;
mod modules;
mod state;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::new())
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
            // 前台检测
            commands::foreground::foreground_start,
            commands::foreground::foreground_stop,
            commands::foreground::foreground_get_status,
            commands::foreground::foreground_set_api_key,
            commands::foreground::foreground_is_ready,
        ])
        .setup(|_app| {
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
