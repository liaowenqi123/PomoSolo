use std::sync::{Arc, Mutex};

use crate::modules::cloud_auth::Session;
use crate::modules::foreground_inspection::DetectionState;

/// 应用全局状态（替代 Electron main/state.js）
pub struct AppState {
    /// 计时器是否运行中
    pub timer_running: Mutex<bool>,
    /// 专注模式是否开启
    pub focus_mode_enabled: Mutex<bool>,
    /// 前台检测是否就绪
    pub foreground_ready: Mutex<bool>,
    /// 云端会话
    pub cloud_session: Mutex<Option<Session>>,
    /// 前台检测状态
    pub detection_state: Arc<DetectionState>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            timer_running: Mutex::new(false),
            focus_mode_enabled: Mutex::new(false),
            foreground_ready: Mutex::new(false),
            cloud_session: Mutex::new(None),
            detection_state: Arc::new(DetectionState::default()),
        }
    }
}
