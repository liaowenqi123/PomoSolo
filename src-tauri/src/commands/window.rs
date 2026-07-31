use serde_json::Value;
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition};

/// 常量：正常模式与迷你模式窗口尺寸（CSS 像素，与旧版一致）
const NORMAL_WIDTH: f64 = 520.0;
const NORMAL_HEIGHT: f64 = 560.0;
const MINI_WIDTH: f64 = 180.0;
const MINI_HEIGHT: f64 = 220.0;

#[tauri::command]
pub async fn close_window(app: AppHandle) {
    // 先隐藏窗口（用户感知"已关闭"），然后退出应用
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

/// 进入迷你模式：
/// 将主窗口尺寸缩小为 180x220（CSS 像素），置顶，禁止最小化，并从任务栏隐藏。
/// 若 data.json 中保存了上次的迷你模式位置（miniModePosition），则恢复该位置。
/// 对应前端 `src/api/window.ts` 中的 `enterMiniMode()`。
#[tauri::command]
pub async fn enter_mini_mode(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_size(LogicalSize::new(MINI_WIDTH, MINI_HEIGHT));
        let _ = window.set_always_on_top(true);
        let _ = window.set_minimizable(false);
        let _ = window.set_skip_taskbar(true);

        // 恢复上次迷你模式位置
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
/// 先保存当前迷你模式位置到 data.json，然后恢复主窗口尺寸为 520x560，
/// 取消置顶，恢复最小化与任务栏显示。
/// 对应前端 `src/api/window.ts` 中的 `exitMiniMode()`。
#[tauri::command]
pub async fn exit_mini_mode(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        // 保存当前迷你模式位置
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

        let _ = window.set_size(LogicalSize::new(NORMAL_WIDTH, NORMAL_HEIGHT));
        let _ = window.set_always_on_top(false);
        let _ = window.set_minimizable(true);
        let _ = window.set_skip_taskbar(false);
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
///
/// 返回 Ok(规范化 URL) 表示通过，Err(原因) 表示拒绝。
fn validate_external_url(raw: &str) -> Result<String, String> {
    let url = raw.trim();
    if url.is_empty() {
        return Err("URL 不能为空".to_string());
    }
    // 仅允许 http/https 协议，防止 file:// 等危险协议
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
///
/// 在 `decorations: false` + `transparent: true` 下，Windows 11 22000+ 仍会
/// 默认应用约 8px 的系统圆角，与定制的 CSS 圆角形成"双层圆角"效果并伴随
/// 系统描边。调用 `DwmSetWindowAttribute` 将圆角偏好设为 `DWMWCP_DONOTROUND`
/// 可让 Windows 不再应用系统圆角。
///
/// 注意：Tauri 2.11 内部依赖 windows 0.61，而本项目直接依赖 windows 0.58，
/// 两者的 `HWND` 是不同类型。通过 `.hwnd().0` 取出原始 `*mut c_void` 指针
/// 再用本 crate 的 `HWND` 重新构造即可桥接。
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
