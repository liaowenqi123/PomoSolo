mod commands;
mod modules;
mod state;

use state::AppState;

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
