use serde_json::Value;
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, tray::TrayIconBuilder, menu::{Menu, MenuItem}};

/// 常量：正常模式与迷你模式窗口尺寸（CSS 像素，与旧版一致）
const NORMAL_WIDTH: f64 = 520.0;
const NORMAL_HEIGHT: f64 = 560.0;
const MINI_WIDTH: f64 = 180.0;
const MINI_HEIGHT: f64 = 220.0;

#[tauri::command]
pub async fn close_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    app.exit(0);
}

#[tauri::command]
pub async fn minimize_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.minimize();
    }
}

#[tauri::command]
pub async fn set_always_on_top(app: AppHandle, on_top: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(on_top);
    }
}

#[tauri::command]
pub async fn bring_to_front(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(true);
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub async fn cancel_always_on_top(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(false);
    }
}

#[tauri::command]
pub async fn show_garden_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("garden") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
pub async fn hide_garden_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("garden") {
        let _ = window.hide();
    }
}

/// 退出迷你模式的内部辅助函数（用于托盘事件中恢复窗口）
fn do_exit_mini_mode(app: &AppHandle) {
    // 清除迷你模式标志
    *app.state::<crate::state::AppState>().mini_mode_active.lock().unwrap() = false;
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_size(LogicalSize::new(NORMAL_WIDTH, NORMAL_HEIGHT));
        let _ = w.set_always_on_top(false);
        let _ = w.set_minimizable(true);
        let _ = w.set_skip_taskbar(false);
        app.remove_tray_by_id("mini-tray");
        if let Ok(data) = crate::modules::data_manager::read_data(app) {
            if let Some(pos) = data.get("normalModePosition").and_then(|v| v.as_array()) {
                if pos.len() == 2 {
                    let x = pos[0].as_i64().unwrap_or(0) as i32;
                    let y = pos[1].as_i64().unwrap_or(0) as i32;
                    let _ = w.set_position(PhysicalPosition::new(x, y));
                }
            }
        }
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// 进入迷你模式：
/// 1. 保存当前普通模式位置到 data.json → normalModePosition（退出时恢复）
/// 2. 缩小窗口到 180x220，置顶，禁止最小化，从任务栏隐藏
/// 3. 创建系统托盘（对照 Electron 版 ipc-window.js L104-131）
/// 4. 恢复上次保存的迷你模式位置（miniModePosition）
///
/// 对应前端 `src/api/window.ts` 中的 `enterMiniMode()`。
#[tauri::command]
pub async fn enter_mini_mode(app: AppHandle) {
    // 设置迷你模式标志（用于拦截窗口关闭事件）
    *app.state::<crate::state::AppState>().mini_mode_active.lock().unwrap() = true;
    if let Some(window) = app.get_webview_window("main") {
        // 1. 保存普通模式位置
        if let Ok(pos) = window.outer_position() {
            let mut data = match crate::modules::data_manager::read_data(&app) {
                Ok(d) => d,
                Err(_) => Value::Object(serde_json::Map::new()),
            };
            data["normalModePosition"] = Value::Array(vec![
                Value::from(pos.x),
                Value::from(pos.y),
            ]);
            let _ = crate::modules::data_manager::write_data(&app, &data);
        }

        // 2. 缩小窗口 + 置顶 + 隐藏任务栏
        let _ = window.set_size(LogicalSize::new(MINI_WIDTH, MINI_HEIGHT));
        let _ = window.set_always_on_top(true);
        let _ = window.set_minimizable(false);
        let _ = window.set_skip_taskbar(true);

        // 3. 创建迷你模式托盘（对照 Electron 版 ipc-window.js L104-131）
        //    仅迷你模式下才创建，退出时销毁，避免始终显示托盘图标
        let show_item = MenuItem::with_id(&app, "mini_show", "显示主窗口", true, None::<&str>).ok();
        let quit_item = MenuItem::with_id(&app, "mini_quit", "退出应用", true, None::<&str>).ok();
        if let (Some(show), Some(quit)) = (show_item, quit_item) {
            if let Ok(menu) = Menu::with_items(&app, &[&show, &quit]) {
                let app_clone = app.clone();
                let r = TrayIconBuilder::with_id("mini-tray")
                    .icon(app.default_window_icon().cloned().unwrap())
                    .tooltip("PomoSolo - 迷你模式")
                    .menu(&menu)
                    .on_menu_event(move |app, event| match event.id.as_ref() {
                        "mini_show" => {
                            do_exit_mini_mode(app);
                        }
                        "mini_quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        use tauri::tray::TrayIconEvent;
                        if let TrayIconEvent::Click { .. } = event {
                            let app = tray.app_handle();
                            do_exit_mini_mode(app);
                        }
                    })
                    .build(&app_clone);
                if let Err(e) = r {
                    eprintln!("[enter_mini_mode] 创建托盘失败: {}", e);
                }
            }
        }

        // 4. 恢复上次迷你模式位置
        if let Ok(data) = crate::modules::data_manager::read_data(&app) {
            if let Some(pos) = data.get("miniModePosition").and_then(|v| v.as_array()) {
                if pos.len() == 2 {
                    let x = pos[0].as_i64().unwrap_or(0) as i32;
                    let y = pos[1].as_i64().unwrap_or(0) as i32;
                    let _ = window.set_position(PhysicalPosition::new(x, y));
                }
            }
        }
    }
}

/// 退出迷你模式：
/// 1. 保存当前迷你模式位置到 data.json
/// 2. 销毁系统托盘
/// 3. 恢复主窗口尺寸 520x560，取消置顶，恢复任务栏
/// 4. 恢复到普通模式位置（normalModePosition）
///
/// 对应前端 `src/api/window.ts` 中的 `exitMiniMode()`。
#[tauri::command]
pub async fn exit_mini_mode(app: AppHandle) {
    // 清除迷你模式标志
    *app.state::<crate::state::AppState>().mini_mode_active.lock().unwrap() = false;
    if let Some(window) = app.get_webview_window("main") {
        // 1. 保存当前迷你模式位置
        if let Ok(pos) = window.outer_position() {
            let mut data = match crate::modules::data_manager::read_data(&app) {
                Ok(d) => d,
                Err(_) => Value::Object(serde_json::Map::new()),
            };
            data["miniModePosition"] = Value::Array(vec![
                Value::from(pos.x),
                Value::from(pos.y),
            ]);
            let _ = crate::modules::data_manager::write_data(&app, &data);
        }

        // 2. 销毁托盘（对照 Electron 版 ipc-window.js L150-152）
        app.remove_tray_by_id("mini-tray");

        // 3. 恢复窗口属性
        let _ = window.set_size(LogicalSize::new(NORMAL_WIDTH, NORMAL_HEIGHT));
        let _ = window.set_always_on_top(false);
        let _ = window.set_minimizable(true);
        let _ = window.set_skip_taskbar(false);

        // 4. 恢复到普通模式位置
        if let Ok(data) = crate::modules::data_manager::read_data(&app) {
            if let Some(pos) = data.get("normalModePosition").and_then(|v| v.as_array()) {
                if pos.len() == 2 {
                    let x = pos[0].as_i64().unwrap_or(0) as i32;
                    let y = pos[1].as_i64().unwrap_or(0) as i32;
                    let _ = window.set_position(PhysicalPosition::new(x, y));
                }
            }
        }
    }
}

/// 保存迷你模式当前位置到 data.json（拖动结束后由前端调用）
#[tauri::command]
pub async fn update_mini_position(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Ok(pos) = window.outer_position() {
            let mut data = match crate::modules::data_manager::read_data(&app) {
                Ok(d) => d,
                Err(_) => Value::Object(serde_json::Map::new()),
            };
            data["miniModePosition"] = Value::Array(vec![
                Value::from(pos.x),
                Value::from(pos.y),
            ]);
            let _ = crate::modules::data_manager::write_data(&app, &data);
        }
    }
}

/// 校验外部链接 URL：非空且仅允许 http/https 协议
fn validate_external_url(raw: &str) -> Result<String, String> {
    let url = raw.trim();
    if url.is_empty() {
        return Err("URL 不能为空".to_string());
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("仅支持 http/https 链接".to_string());
    }
    Ok(url.to_string())
}

/// 在系统默认浏览器中打开外部链接
#[tauri::command]
pub async fn open_external(url: String) -> Result<(), String> {
    let url = validate_external_url(&url)?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| format!("打开链接失败: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("打开链接失败: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("打开链接失败: {}", e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_external_url_https() {
        assert_eq!(
            validate_external_url("https://example.com").unwrap(),
            "https://example.com"
        );
    }

    #[test]
    fn test_validate_external_url_http() {
        assert_eq!(
            validate_external_url("http://example.com/path?q=1").unwrap(),
            "http://example.com/path?q=1"
        );
    }

    #[test]
    fn test_validate_external_url_trims_whitespace() {
        assert_eq!(
            validate_external_url("  https://example.com  ").unwrap(),
            "https://example.com"
        );
    }

    #[test]
    fn test_validate_external_url_rejects_empty() {
        assert!(validate_external_url("").is_err());
        assert!(validate_external_url("   ").is_err());
    }

    #[test]
    fn test_validate_external_url_rejects_file_protocol() {
        let r = validate_external_url("file:///etc/passwd");
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("http/https"));
    }

    #[test]
    fn test_validate_external_url_rejects_javascript_protocol() {
        let r = validate_external_url("javascript:alert(1)");
        assert!(r.is_err());
    }

    #[test]
    fn test_validate_external_url_rejects_ftp_protocol() {
        let r = validate_external_url("ftp://example.com/file");
        assert!(r.is_err());
    }

    #[test]
    fn test_validate_external_url_rejects_data_protocol() {
        let r = validate_external_url("data:text/html,<script>alert(1)</script>");
        assert!(r.is_err());
    }

    #[test]
    fn test_validate_external_url_rejects_no_protocol() {
        let r = validate_external_url("example.com");
        assert!(r.is_err());
    }
}

/// Windows 11：禁用 DWM 系统级窗口圆角。
#[cfg(windows)]
pub fn disable_window_rounding(window: &tauri::WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
    };

    if let Ok(hwnd) = window.hwnd() {
        let hwnd = HWND(hwnd.0 as *mut std::ffi::c_void);
        let preference = DWMWCP_DONOTROUND;
        unsafe {
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &preference as *const _ as *const std::ffi::c_void,
                std::mem::size_of_val(&preference) as u32,
            );
        }
    }
}

#[cfg(not(windows))]
pub fn disable_window_rounding(_window: &tauri::WebviewWindow) {}
