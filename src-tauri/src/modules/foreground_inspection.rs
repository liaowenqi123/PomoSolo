//! 前台检测模块（Rust 重写，替代 Python foreground_inspection.py）
//!
//! 使用 windows crate 获取前台窗口标题
//! 使用 reqwest 调用 DeepSeek API 做娱乐性判断
//!
//! 检测优先级：自身窗口过滤 → 白名单 → 黑名单 → 历史记录 → AI 判断

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex};

#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};

/// 默认白名单（子串匹配，命中 → 非娱乐）。优先级高于黑名单。
const DEFAULT_WHITELIST: &[&str] = &[
    "文件资源管理器",
    "Visual Studio Code",
    "PowerShell",
    "PowerPoint",
    "演示文稿",
    "番茄钟",
    "PomoSolo",
    "cmd",
    "任务管理器",
    "设置",
    "Explorer",
    "SystemSettings",
    "Windows Input",
];

/// 默认黑名单（子串匹配，命中 → 娱乐）
const DEFAULT_BLACKLIST: &[&str] = &[
    "bilibili",
    "哔哩哔哩",
    "抖音",
    "Douyin",
    "快手",
    "Kuaishou",
    "斗鱼",
    "虎牙",
    "原神",
    "Genshin",
    "英雄联盟",
    "League of Legends",
    "王者荣耀",
    "Steam",
    "WeGame",
    "网易 CC",
    "YY 直播",
    "酷狗音乐",
    "网易云音乐",
    "QQ音乐",
    "酷我音乐",
    "爱奇艺",
    "优酷",
    "腾讯视频",
    "芒果TV",
    "YouTube",
    "Netflix",
    "Twitch",
    "小红书",
    "微博",
    "Weibo",
];

/// 自身窗口关键词（命中 → 跳过，视为非娱乐）
const SELF_WINDOW_KEYWORDS: &[&str] = &["PomoSolo", "番茄钟", "菜园子"];

/// 检测状态
pub struct DetectionState {
    pub running: AtomicBool,
    pub api_key: tokio::sync::RwLock<Option<String>>,
    /// 历史记录缓存：窗口标题 → 是否娱乐（进程生命周期内有效）
    pub history: Mutex<HashMap<String, bool>>,
}

impl Default for DetectionState {
    fn default() -> Self {
        Self {
            running: AtomicBool::new(false),
            api_key: tokio::sync::RwLock::new(None),
            history: Mutex::new(HashMap::new()),
        }
    }
}

/// 检测结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectionResult {
    pub window_title: String,
    pub is_entertainment: bool,
    /// "blacklist" | "whitelist" | "ai" | "history"
    pub source: String,
    pub keyword: String,
}

/// 检测事件（通过 channel 推送给 commands 层，再由 commands 层 emit 到前端）
#[derive(Debug)]
pub enum DetectionEvent {
    /// 检测到娱乐应用
    Entertainment(DetectionResult),
    /// API Key 已配置但无效（401/403）
    ApiKeyInvalid,
    /// 检测过程中发生错误
    Error(String),
}

/// AI 判断结果
enum AiOutcome {
    /// 成功得到判断
    Answer(bool),
    /// API Key 无效
    ApiKeyInvalid,
    /// 其他错误
    Error(String),
}

/// 获取当前前台窗口标题
#[cfg(windows)]
pub fn get_foreground_window_title() -> Option<String> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }

        let mut title = [0u16; 512];
        let len = GetWindowTextW(hwnd, &mut title);
        if len == 0 {
            return None;
        }

        Some(String::from_utf16_lossy(&title[..len as usize]))
    }
}

#[cfg(not(windows))]
pub fn get_foreground_window_title() -> Option<String> {
    None
}

/// 判断是否为自身窗口（番茄钟 / PomoSolo / 菜园子）
fn is_self_window(title: &str) -> bool {
    SELF_WINDOW_KEYWORDS.iter().any(|k| title.contains(*k))
}

/// 白名单子串匹配
fn match_whitelist(title: &str) -> Option<&'static str> {
    DEFAULT_WHITELIST.iter().copied().find(|k| title.contains(*k))
}

/// 黑名单子串匹配
fn match_blacklist(title: &str) -> Option<&'static str> {
    DEFAULT_BLACKLIST.iter().copied().find(|k| title.contains(*k))
}

/// DeepSeek API 娱乐性判断
async fn check_is_entertainment(api_key: &str, window_title: &str) -> AiOutcome {
    let client = reqwest::Client::new();

    let prompt = format!(
        "你是一个前台窗口检测助手。判断以下窗口标题是否属于娱乐应用（游戏、视频、音乐、直播、社交媒体）。\n\
         只回答 JSON：{{\"is_entertainment\": true}} 或 {{\"is_entertainment\": false}}\n\
         窗口标题：{}",
        window_title
    );

    let body = serde_json::json!({
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": "你是一个前台窗口检测助手。根据窗口标题判断是否属于娱乐类应用（游戏、视频、音乐、直播、社交媒体）。只回答 JSON 格式。"},
            {"role": "user", "content": prompt}
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 50,
        "temperature": 0.1
    });

    let resp = match client
        .post("https://api.deepseek.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return AiOutcome::Error(e.to_string()),
    };

    let status = resp.status();
    if status.as_u16() == 401 || status.as_u16() == 403 {
        return AiOutcome::ApiKeyInvalid;
    }

    if !status.is_success() {
        return AiOutcome::Error(format!("HTTP {}", status));
    }

    let json: Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => return AiOutcome::Error(e.to_string()),
    };

    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .trim()
        .to_lowercase();

    // 尝试解析 JSON，失败则降级为子串匹配
    let is_entertainment = if let Ok(parsed) = serde_json::from_str::<Value>(&content) {
        parsed["is_entertainment"]
            .as_bool()
            .unwrap_or_else(|| {
                parsed["is_entertainment"]
                    .as_str()
                    .map(|s| s.contains("true") || s == "是")
                    .unwrap_or(false)
            })
    } else {
        content.contains("true")
    };

    AiOutcome::Answer(is_entertainment)
}

/// 启动检测循环
pub fn start_detection(
    state: Arc<DetectionState>,
    event_tx: mpsc::UnboundedSender<DetectionEvent>,
) {
    state.running.store(true, Ordering::Relaxed);

    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(2));
        let mut last_title: Option<String> = None;

        while state.running.load(Ordering::Relaxed) {
            interval.tick().await;

            // 获取前台窗口标题
            let title = match get_foreground_window_title() {
                Some(t) if !t.is_empty() => t,
                _ => continue,
            };

            // 过滤自身窗口（番茄钟 / PomoSolo / 菜园子），视为非娱乐
            if is_self_window(&title) {
                last_title = Some(title);
                continue;
            }

            // 1. 白名单匹配（优先级最高）
            if match_whitelist(&title).is_some() {
                last_title = Some(title);
                continue;
            }

            // 2. 黑名单匹配
            if let Some(keyword) = match_blacklist(&title) {
                // 仅在标题变化时 emit，避免重复刷屏
                if last_title.as_deref() != Some(title.as_str()) {
                    let _ = event_tx.send(DetectionEvent::Entertainment(DetectionResult {
                        window_title: title.clone(),
                        is_entertainment: true,
                        source: "blacklist".to_string(),
                        keyword: keyword.to_string(),
                    }));
                }
                last_title = Some(title);
                continue;
            }

            // 3. 历史记录缓存
            let cached = {
                let history = state.history.lock().await;
                history.get(&title).copied()
            };
            if let Some(is_ent) = cached {
                if is_ent && last_title.as_deref() != Some(title.as_str()) {
                    let _ = event_tx.send(DetectionEvent::Entertainment(DetectionResult {
                        window_title: title.clone(),
                        is_entertainment: true,
                        source: "history".to_string(),
                        keyword: title.clone(),
                    }));
                }
                last_title = Some(title);
                continue;
            }

            // 获取 API Key
            let api_key = state.api_key.read().await.clone();

            // 4. 未配置 API Key：不发 AI 请求（黑白名单命中已在上面处理）
            let api_key = match api_key {
                Some(k) if !k.is_empty() => k,
                _ => {
                    last_title = Some(title);
                    continue;
                }
            };

            // 5. 标题未变化：跳过 AI 查询（黑白名单已在上面匹配过）
            if last_title.as_deref() == Some(title.as_str()) {
                continue;
            }

            // 6. 调用 AI 判断
            match check_is_entertainment(&api_key, &title).await {
                AiOutcome::Answer(true) => {
                    state.history.lock().await.insert(title.clone(), true);
                    let _ = event_tx.send(DetectionEvent::Entertainment(DetectionResult {
                        window_title: title.clone(),
                        is_entertainment: true,
                        source: "ai".to_string(),
                        keyword: String::new(),
                    }));
                }
                AiOutcome::Answer(false) => {
                    state.history.lock().await.insert(title.clone(), false);
                }
                AiOutcome::ApiKeyInvalid => {
                    let _ = event_tx.send(DetectionEvent::ApiKeyInvalid);
                }
                AiOutcome::Error(e) => {
                    eprintln!("[ForegroundDetection] AI 判断失败: {}", e);
                    let _ = event_tx.send(DetectionEvent::Error(e));
                }
            }

            last_title = Some(title);
        }
    });
}

/// 停止检测
pub fn stop_detection(state: &DetectionState) {
    state.running.store(false, Ordering::Relaxed);
}

/// 设置 API Key
pub async fn set_api_key(state: &DetectionState, key: String) {
    *state.api_key.write().await = Some(key);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detection_state_default() {
        let state = DetectionState::default();
        assert_eq!(
            state.running.load(Ordering::Relaxed),
            false,
            "默认 running 应为 false"
        );

        // 通过 block_on 检查 api_key 默认为 None
        let rt = tokio::runtime::Runtime::new().expect("创建 tokio 运行时失败");
        let api_key = rt.block_on(async { state.api_key.read().await.clone() });
        assert!(api_key.is_none(), "默认 api_key 应为 None");
    }

    #[test]
    fn test_stop_detection_sets_running_false() {
        let state = DetectionState::default();
        // 先置为 true，再 stop，应变为 false
        state.running.store(true, Ordering::Relaxed);
        assert!(state.running.load(Ordering::Relaxed));

        stop_detection(&state);

        assert_eq!(
            state.running.load(Ordering::Relaxed),
            false,
            "stop_detection 后 running 应为 false"
        );
    }

    #[test]
    fn test_stop_detection_idempotent() {
        let state = DetectionState::default();
        // 已经是 false，再 stop 一次也应保持 false，不报错
        stop_detection(&state);
        stop_detection(&state);
        assert!(!state.running.load(Ordering::Relaxed));
    }

    #[test]
    fn test_set_and_clear_api_key() {
        let state = DetectionState::default();
        let rt = tokio::runtime::Runtime::new().expect("创建 tokio 运行时失败");

        rt.block_on(set_api_key(&state, "sk-test-key".to_string()));

        let key = rt.block_on(async { state.api_key.read().await.clone() });
        assert_eq!(key.as_deref(), Some("sk-test-key"));

        // 清空
        rt.block_on(set_api_key(&state, String::new()));
        let key = rt.block_on(async { state.api_key.read().await.clone() });
        // 注意：set_api_key 把空字符串也当作 Some("")，这里仅验证写入逻辑
        assert_eq!(key, Some(String::new()));
    }

    #[test]
    fn test_detection_result_serialization() {
        let result = DetectionResult {
            window_title: "Test Window".to_string(),
            is_entertainment: true,
            source: "ai".to_string(),
            keyword: "game".to_string(),
        };
        let json = serde_json::to_string(&result).expect("序列化应成功");
        let back: DetectionResult = serde_json::from_str(&json).expect("反序列化应成功");
        assert_eq!(back.window_title, "Test Window");
        assert!(back.is_entertainment);
        assert_eq!(back.source, "ai");
        assert_eq!(back.keyword, "game");
    }

    #[test]
    fn test_whitelist_match() {
        assert!(match_whitelist("文件资源管理器").is_some());
        assert!(match_whitelist("Visual Studio Code - main.rs").is_some());
        assert!(match_whitelist("PowerShell - 7").is_some());
        assert!(match_whitelist("PomoSolo 番茄钟").is_some());
        assert!(match_whitelist("cmd.exe").is_some());
        assert!(match_whitelist("任务管理器").is_some());
        assert!(match_whitelist("设置").is_some());
        assert!(match_whitelist("Explorer").is_some());
        assert!(match_whitelist("SystemSettings").is_some());
        assert!(match_whitelist("Windows Input Experience").is_some());
        assert!(match_whitelist("random window").is_none());
        // 黑名单项不应被白名单命中
        assert!(match_whitelist("原神").is_none());
        assert!(match_whitelist("bilibili").is_none());
    }

    #[test]
    fn test_blacklist_match() {
        assert!(match_blacklist("原神 - 游戏").is_some());
        assert!(match_blacklist("bilibili - 首页").is_some());
        assert!(match_blacklist("哔哩哔哩").is_some());
        assert!(match_blacklist("英雄联盟").is_some());
        assert!(match_blacklist("League of Legends").is_some());
        assert!(match_blacklist("网易云音乐").is_some());
        assert!(match_blacklist("YouTube - Chrome").is_some());
        assert!(match_blacklist("抖音").is_some());
        assert!(match_blacklist("小红书").is_some());
        assert!(match_blacklist("微博").is_some());
        assert!(match_blacklist("Weibo").is_some());
        // 白名单项不应被黑名单命中
        assert!(match_blacklist("Visual Studio Code").is_none());
        assert!(match_blacklist("文件资源管理器").is_none());
    }

    #[test]
    fn test_self_window_filter() {
        assert!(is_self_window("PomoSolo - 番茄钟"));
        assert!(is_self_window("番茄钟"));
        assert!(is_self_window("菜园子工具箱"));
        assert!(!is_self_window("原神"));
        assert!(!is_self_window("Visual Studio Code"));
    }

    #[test]
    fn test_history_cache_roundtrip() {
        let state = DetectionState::default();
        let rt = tokio::runtime::Runtime::new().expect("创建 tokio 运行时失败");
        rt.block_on(async {
            {
                let mut history = state.history.lock().await;
                history.insert("原神".to_string(), true);
                history.insert("记事本".to_string(), false);
            }
            let history = state.history.lock().await;
            assert_eq!(history.get("原神"), Some(&true));
            assert_eq!(history.get("记事本"), Some(&false));
            assert_eq!(history.get("未知窗口"), None);
        });
    }
}
