use std::sync::Mutex;

/// 应用全局状态（替代 Electron main/state.js）
pub struct AppState {
    /// 计时器是否运行中
    pub timer_running: Mutex<bool>,
    /// 专注模式是否开启
    pub focus_mode_enabled: Mutex<bool>,
    /// 前台检测是否就绪
    pub foreground_ready: Mutex<bool>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            timer_running: Mutex::new(false),
            focus_mode_enabled: Mutex::new(false),
            foreground_ready: Mutex::new(false),
        }
    }
}
