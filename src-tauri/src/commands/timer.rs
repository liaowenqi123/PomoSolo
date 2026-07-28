use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct TimerState {
    pub is_running: bool,
    pub mode: String,
    pub remaining_ms: u64,
}

/// 默认计时器状态（与 get_timer_state 命令返回值一致）
fn default_timer_state() -> TimerState {
    TimerState {
        is_running: false,
        mode: "work".to_string(),
        remaining_ms: 25 * 60 * 1000,
    }
}

#[tauri::command]
pub async fn get_timer_state() -> TimerState {
    default_timer_state()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_timer_state_default() {
        let state = default_timer_state();
        assert!(!state.is_running, "默认 is_running 应为 false");
        assert_eq!(state.mode, "work", "默认 mode 应为 work");
        assert_eq!(
            state.remaining_ms,
            25 * 60 * 1000,
            "默认 remaining_ms 应为 25 分钟（毫秒）"
        );
    }

    #[test]
    fn test_timer_state_serialization() {
        let state = default_timer_state();
        let json = serde_json::to_string(&state).expect("序列化应成功");
        // 字段名应为 snake_case（与 Tauri/JS 端约定一致）
        assert!(json.contains("\"is_running\""), "JSON 应包含 is_running 字段");
        assert!(json.contains("\"remaining_ms\""), "JSON 应包含 remaining_ms 字段");
        assert!(json.contains("\"mode\""));
        assert!(json.contains("\"work\""));

        let back: TimerState = serde_json::from_str(&json).expect("反序列化应成功");
        assert_eq!(back.is_running, false);
        assert_eq!(back.mode, "work");
        assert_eq!(back.remaining_ms, 25 * 60 * 1000);
    }

    #[test]
    fn test_default_remaining_ms_is_25_minutes() {
        let state = default_timer_state();
        // 25 分钟 = 1500 秒 = 1_500_000 毫秒
        assert_eq!(state.remaining_ms, 1_500_000);
        assert_eq!(state.remaining_ms / 1000 / 60, 25);
    }

    #[test]
    fn test_timer_state_default_matches_command_logic() {
        // 验证 default_timer_state 与 get_timer_state 函数体逻辑一致：
        // 两者均构造相同的默认状态
        let s1 = default_timer_state();
        let s2 = TimerState {
            is_running: false,
            mode: "work".to_string(),
            remaining_ms: 25 * 60 * 1000,
        };
        assert_eq!(s1.is_running, s2.is_running);
        assert_eq!(s1.mode, s2.mode);
        assert_eq!(s1.remaining_ms, s2.remaining_ms);
    }
}
