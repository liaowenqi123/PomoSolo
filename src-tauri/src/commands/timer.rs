use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct TimerState {
    pub is_running: bool,
    pub mode: String,
    pub remaining_ms: u64,
}

#[tauri::command]
pub async fn get_timer_state() -> TimerState {
    TimerState {
        is_running: false,
        mode: "work".to_string(),
        remaining_ms: 25 * 60 * 1000,
    }
}
