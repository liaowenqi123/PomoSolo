use tauri::{AppHandle, LogicalSize, Manager};

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
/// 对应前端 `src/api/window.ts` 中的 `enterMiniMode()`。
#[tauri::command]
pub async fn enter_mini_mode(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_size(LogicalSize::new(180.0, 220.0));
        let _ = window.set_always_on_top(true);
        let _ = window.set_minimizable(false);
        let _ = window.set_skip_taskbar(true);
    }
}

/// 退出迷你模式：
/// 恢复主窗口尺寸为 520x560（CSS 像素），取消置顶，恢复最小化与任务栏显示。
/// 对应前端 `src/api/window.ts` 中的 `exitMiniMode()`。
#[tauri::command]
pub async fn exit_mini_mode(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_size(LogicalSize::new(520.0, 560.0));
        let _ = window.set_always_on_top(false);
        let _ = window.set_minimizable(true);
        let _ = window.set_skip_taskbar(false);
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
