//! 前台检测模块（Rust 重写，替代 Python foreground_inspection.py）
//!
//! 使用 windows crate 获取前台窗口标题
//! 使用 reqwest 调用 DeepSeek API 做娱乐性判断
//!
//! 检测优先级：自身窗口过滤 → 白名单 → 黑名单 → 历史记录 → AI 判断

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
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

/// 名单配置（对应旧版 list_config.json）
///
/// 与默认名单的关系：用户自定义名单与默认名单合并匹配，用户名单优先。
/// 历史记录持久化在文件里，重启后 AI 判断结果不丢失（旧版 Rust 迁移前是内存缓存）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ListConfig {
    /// 用户自定义白名单（子串匹配，命中 → 非娱乐，优先级最高）
    #[serde(default)]
    pub whitelist: Vec<String>,
    /// 用户自定义黑名单（子串匹配，命中 → 娱乐）
    #[serde(default)]
    pub blacklist: Vec<String>,
    /// AI 判断历史：窗口标题 → 是否娱乐
    #[serde(default, deserialize_with = "deserialize_history")]
    pub history: HashMap<String, bool>,
}

/// 兼容旧版 Electron/Python 格式：history 值可能是 bool 或 "是"/"不是" 字符串
fn deserialize_history<'de, D>(deserializer: D) -> Result<HashMap<String, bool>, D::Error>
where
    D: Deserializer<'de>,
{
    let map: HashMap<String, serde_json::Value> = HashMap::deserialize(deserializer)?;
    Ok(map
        .into_iter()
        .map(|(k, v)| {
            let b = match &v {
                serde_json::Value::Bool(b) => *b,
                serde_json::Value::String(s) => s.trim() == "是",
                _ => false,
            };
            (k, b)
        })
        .collect())
}

/// 从文件加载名单配置（文件不存在或损坏时返回默认空配置）
pub fn load_list_config(path: &Path) -> Result<ListConfig, String> {
    if !path.exists() {
        return Ok(ListConfig::default());
    }
    let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    if content.trim().is_empty() {
        return Ok(ListConfig::default());
    }
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

/// 保存名单配置到文件
pub fn save_list_config(path: &Path, config: &ListConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    std::fs::write(path, content).map_err(|e| e.to_string())
}

/// 检测状态
pub struct DetectionState {
    pub running: AtomicBool,
    pub api_key: tokio::sync::RwLock<Option<String>>,
    /// 名单配置（白/黑名单 + 历史记录），检测循环与名单管理命令共用
    pub list_config: Mutex<ListConfig>,
    /// list_config.json 路径（由命令层首次解析后写入；None 时跳过持久化）
    pub config_path: std::sync::Mutex<Option<PathBuf>>,
}

impl Default for DetectionState {
    fn default() -> Self {
        Self {
            running: AtomicBool::new(false),
            api_key: tokio::sync::RwLock::new(None),
            list_config: Mutex::new(ListConfig::default()),
            config_path: std::sync::Mutex::new(None),
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

/// 白名单子串匹配：用户名单优先，然后默认名单。返回命中的关键词。
fn match_whitelist(title: &str, config: &ListConfig) -> Option<String> {
    config
        .whitelist
        .iter()
        .find(|k| !k.is_empty() && title.contains(k.as_str()))
        .cloned()
        .or_else(|| {
            DEFAULT_WHITELIST
                .iter()
                .copied()
                .find(|k| title.contains(*k))
                .map(String::from)
        })
}

/// 黑名单子串匹配：用户名单优先，然后默认名单。返回命中的关键词。
fn match_blacklist(title: &str, config: &ListConfig) -> Option<String> {
    config
        .blacklist
        .iter()
        .find(|k| !k.is_empty() && title.contains(k.as_str()))
        .cloned()
        .or_else(|| {
            DEFAULT_BLACKLIST
                .iter()
                .copied()
                .find(|k| title.contains(*k))
                .map(String::from)
        })
}

/// 读取 config_path（防 poison）
fn read_config_path(state: &DetectionState) -> Option<PathBuf> {
    state
        .config_path
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

/// 保存名单配置到文件（路径已知时）；失败仅打日志，不阻塞检测
pub async fn save_list_config_if_possible(state: &DetectionState) {
    let path = match read_config_path(state) {
        Some(p) => p,
        None => return,
    };
    let cfg = state.list_config.lock().await.clone();
    if let Err(e) = save_list_config(&path, &cfg) {
        eprintln!("[ForegroundDetection] 保存名单配置失败: {}", e);
    }
}

// ===== 名单管理操作（供 commands 层调用） =====

/// 添加关键词到白名单（去重）。返回是否真正新增。
pub async fn add_to_whitelist(state: &DetectionState, keyword: &str) -> bool {
    let keyword = keyword.trim();
    if keyword.is_empty() {
        return false;
    }
    let added = {
        let mut cfg = state.list_config.lock().await;
        if cfg.whitelist.iter().any(|k| k == keyword) {
            false
        } else {
            cfg.whitelist.push(keyword.to_string());
            true
        }
    };
    if added {
        save_list_config_if_possible(state).await;
    }
    added
}

/// 添加关键词到黑名单（去重）。返回是否真正新增。
pub async fn add_to_blacklist(state: &DetectionState, keyword: &str) -> bool {
    let keyword = keyword.trim();
    if keyword.is_empty() {
        return false;
    }
    let added = {
        let mut cfg = state.list_config.lock().await;
        if cfg.blacklist.iter().any(|k| k == keyword) {
            false
        } else {
            cfg.blacklist.push(keyword.to_string());
            true
        }
    };
    if added {
        save_list_config_if_possible(state).await;
    }
    added
}

/// 将历史记录中的窗口标题标记为"不是娱乐"（用户在警告弹窗点"不是娱乐"时调用）
pub async fn mark_history_not(state: &DetectionState, window_title: &str) -> bool {
    let window_title = window_title.trim();
    if window_title.is_empty() {
        return false;
    }
    {
        let mut cfg = state.list_config.lock().await;
        cfg.history.insert(window_title.to_string(), false);
    }
    save_list_config_if_possible(state).await;
    true
}

/// 把黑名单关键词移到白名单（误判纠正）。
///
/// 即使关键词只在默认黑名单中（用户黑名单里没有），加入用户白名单后
/// 也会因白名单优先而生效，因此只要加白成功即返回 true。
pub async fn move_blacklist_to_whitelist(state: &DetectionState, keyword: &str) -> bool {
    let keyword = keyword.trim();
    if keyword.is_empty() {
        return false;
    }
    {
        let mut cfg = state.list_config.lock().await;
        cfg.blacklist.retain(|k| k != keyword);
        if !cfg.whitelist.iter().any(|k| k == keyword) {
            cfg.whitelist.push(keyword.to_string());
        }
    }
    save_list_config_if_possible(state).await;
    true
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

            // 读取一次名单配置快照（本 tick 内白/黑/历史匹配共用）
            let cfg_snapshot = state.list_config.lock().await.clone();

            // 1. 白名单匹配（优先级最高）
            if match_whitelist(&title, &cfg_snapshot).is_some() {
                last_title = Some(title);
                continue;
            }

            // 2. 黑名单匹配
            if let Some(keyword) = match_blacklist(&title, &cfg_snapshot) {
                // 仅在标题变化时 emit，避免重复刷屏
                if last_title.as_deref() != Some(title.as_str()) {
                    let _ = event_tx.send(DetectionEvent::Entertainment(DetectionResult {
                        window_title: title.clone(),
                        is_entertainment: true,
                        source: "blacklist".to_string(),
                        keyword,
                    }));
                }
                last_title = Some(title);
                continue;
            }

            // 3. 历史记录缓存（持久化于 list_config.json，重启不丢）
            let cached = cfg_snapshot.history.get(&title).copied();
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
                    {
                        let mut cfg = state.list_config.lock().await;
                        cfg.history.insert(title.clone(), true);
                    }
                    save_list_config_if_possible(&state).await;
                    let _ = event_tx.send(DetectionEvent::Entertainment(DetectionResult {
                        window_title: title.clone(),
                        is_entertainment: true,
                        source: "ai".to_string(),
                        keyword: String::new(),
                    }));
                }
                AiOutcome::Answer(false) => {
                    {
                        let mut cfg = state.list_config.lock().await;
                        cfg.history.insert(title.clone(), false);
                    }
                    save_list_config_if_possible(&state).await;
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
        let cfg = ListConfig::default();
        assert!(match_whitelist("文件资源管理器", &cfg).is_some());
        assert!(match_whitelist("Visual Studio Code - main.rs", &cfg).is_some());
        assert!(match_whitelist("PowerShell - 7", &cfg).is_some());
        assert!(match_whitelist("PomoSolo 番茄钟", &cfg).is_some());
        assert!(match_whitelist("cmd.exe", &cfg).is_some());
        assert!(match_whitelist("任务管理器", &cfg).is_some());
        assert!(match_whitelist("设置", &cfg).is_some());
        assert!(match_whitelist("Explorer", &cfg).is_some());
        assert!(match_whitelist("SystemSettings", &cfg).is_some());
        assert!(match_whitelist("Windows Input Experience", &cfg).is_some());
        assert!(match_whitelist("random window", &cfg).is_none());
        // 黑名单项不应被白名单命中
        assert!(match_whitelist("原神", &cfg).is_none());
        assert!(match_whitelist("bilibili", &cfg).is_none());
    }

    #[test]
    fn test_blacklist_match() {
        let cfg = ListConfig::default();
        assert!(match_blacklist("原神 - 游戏", &cfg).is_some());
        assert!(match_blacklist("bilibili - 首页", &cfg).is_some());
        assert!(match_blacklist("哔哩哔哩", &cfg).is_some());
        assert!(match_blacklist("英雄联盟", &cfg).is_some());
        assert!(match_blacklist("League of Legends", &cfg).is_some());
        assert!(match_blacklist("网易云音乐", &cfg).is_some());
        assert!(match_blacklist("YouTube - Chrome", &cfg).is_some());
        assert!(match_blacklist("抖音", &cfg).is_some());
        assert!(match_blacklist("小红书", &cfg).is_some());
        assert!(match_blacklist("微博", &cfg).is_some());
        assert!(match_blacklist("Weibo", &cfg).is_some());
        // 白名单项不应被黑名单命中
        assert!(match_blacklist("Visual Studio Code", &cfg).is_none());
        assert!(match_blacklist("文件资源管理器", &cfg).is_none());
    }

    #[test]
    fn test_user_whitelist_takes_priority_over_default_blacklist() {
        // 用户把默认黑名单关键词加入白名单后，白名单应先生效（误判纠正路径）
        let mut cfg = ListConfig::default();
        cfg.whitelist.push("网易云音乐".to_string());
        assert!(match_whitelist("网易云音乐 - 私人FM", &cfg).is_some());
    }

    #[test]
    fn test_user_blacklist_extends_default() {
        let mut cfg = ListConfig::default();
        cfg.blacklist.push("我的自定义游戏".to_string());
        assert!(match_blacklist("我的自定义游戏 - 启动器", &cfg).is_some());
        // 默认黑名单依然有效
        assert!(match_blacklist("抖音", &cfg).is_some());
    }

    #[test]
    fn test_empty_keyword_never_matches() {
        let mut cfg = ListConfig::default();
        cfg.whitelist.push(String::new());
        // 空关键词不应导致所有标题都命中
        assert!(match_whitelist("任意窗口", &cfg).is_none());
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
                let mut cfg = state.list_config.lock().await;
                cfg.history.insert("原神".to_string(), true);
                cfg.history.insert("记事本".to_string(), false);
            }
            let cfg = state.list_config.lock().await;
            assert_eq!(cfg.history.get("原神"), Some(&true));
            assert_eq!(cfg.history.get("记事本"), Some(&false));
            assert_eq!(cfg.history.get("未知窗口"), None);
        });
    }

    // ===== 名单配置持久化 =====

    #[test]
    fn test_list_config_save_load_roundtrip() {
        let dir = tempfile::tempdir().expect("创建临时目录失败");
        let path = dir.path().join("list_config.json");

        let mut cfg = ListConfig::default();
        cfg.whitelist.push("Visual Studio Code".to_string());
        cfg.blacklist.push("抖音".to_string());
        cfg.history.insert("原神".to_string(), true);
        cfg.history.insert("记事本".to_string(), false);

        save_list_config(&path, &cfg).expect("保存应成功");
        let loaded = load_list_config(&path).expect("加载应成功");
        assert_eq!(loaded.whitelist, vec!["Visual Studio Code"]);
        assert_eq!(loaded.blacklist, vec!["抖音"]);
        assert_eq!(loaded.history.get("原神"), Some(&true));
        assert_eq!(loaded.history.get("记事本"), Some(&false));
    }

    #[test]
    fn test_load_list_config_missing_file_returns_default() {
        let path = std::path::PathBuf::from("/nonexistent/list_config.json");
        let cfg = load_list_config(&path).expect("缺失文件应返回默认配置");
        assert!(cfg.whitelist.is_empty());
        assert!(cfg.blacklist.is_empty());
        assert!(cfg.history.is_empty());
    }

    #[test]
    fn test_load_list_config_legacy_string_history() {
        // 旧版 Electron/Python 格式：history 值为 "是"/"不是" 字符串
        let dir = tempfile::tempdir().expect("创建临时目录失败");
        let path = dir.path().join("list_config.json");
        std::fs::write(
            &path,
            r#"{
                "whitelist": ["文件资源管理器"],
                "blacklist": ["抖音"],
                "history": {"原神": "是", "记事本": "不是"}
            }"#,
        )
        .expect("写入测试文件失败");

        let cfg = load_list_config(&path).expect("旧格式应能加载");
        assert_eq!(cfg.history.get("原神"), Some(&true));
        assert_eq!(cfg.history.get("记事本"), Some(&false));
    }

    // ===== 名单管理操作 =====

    #[test]
    fn test_add_to_whitelist_dedup_and_empty() {
        let state = DetectionState::default();
        let rt = tokio::runtime::Runtime::new().expect("创建 tokio 运行时失败");
        rt.block_on(async {
            assert!(add_to_whitelist(&state, "工作应用").await);
            // 重复添加返回 false
            assert!(!add_to_whitelist(&state, "工作应用").await);
            // 空关键词拒绝
            assert!(!add_to_whitelist(&state, "  ").await);
            let cfg = state.list_config.lock().await;
            assert_eq!(cfg.whitelist.len(), 1);
        });
    }

    #[test]
    fn test_add_to_blacklist_dedup_and_empty() {
        let state = DetectionState::default();
        let rt = tokio::runtime::Runtime::new().expect("创建 tokio 运行时失败");
        rt.block_on(async {
            assert!(add_to_blacklist(&state, "新游戏").await);
            assert!(!add_to_blacklist(&state, "新游戏").await);
            assert!(!add_to_blacklist(&state, "").await);
            let cfg = state.list_config.lock().await;
            assert_eq!(cfg.blacklist.len(), 1);
        });
    }

    #[test]
    fn test_mark_history_not() {
        let state = DetectionState::default();
        let rt = tokio::runtime::Runtime::new().expect("创建 tokio 运行时失败");
        rt.block_on(async {
            {
                let mut cfg = state.list_config.lock().await;
                cfg.history.insert("某窗口".to_string(), true);
            }
            assert!(mark_history_not(&state, "某窗口").await);
            let cfg = state.list_config.lock().await;
            assert_eq!(cfg.history.get("某窗口"), Some(&false));
            drop(cfg);
            assert!(!mark_history_not(&state, "  ").await);
        });
    }

    #[test]
    fn test_move_blacklist_to_whitelist() {
        let state = DetectionState::default();
        let rt = tokio::runtime::Runtime::new().expect("创建 tokio 运行时失败");
        rt.block_on(async {
            add_to_blacklist(&state, "误伤应用").await;
            assert!(move_blacklist_to_whitelist(&state, "误伤应用").await);
            let cfg = state.list_config.lock().await;
            assert!(!cfg.blacklist.iter().any(|k| k == "误伤应用"));
            assert!(cfg.whitelist.iter().any(|k| k == "误伤应用"));
            drop(cfg);
            // 默认黑名单中的词也能移（用户黑名单没有，但会加入白名单）
            assert!(move_blacklist_to_whitelist(&state, "抖音").await);
            let cfg = state.list_config.lock().await;
            assert!(cfg.whitelist.iter().any(|k| k == "抖音"));
            drop(cfg);
            assert!(!move_blacklist_to_whitelist(&state, "").await);
        });
    }

    #[test]
    fn test_list_operations_persist_to_file() {
        let dir = tempfile::tempdir().expect("创建临时目录失败");
        let path = dir.path().join("list_config.json");
        let state = DetectionState::default();
        *state.config_path.lock().unwrap() = Some(path.clone());

        let rt = tokio::runtime::Runtime::new().expect("创建 tokio 运行时失败");
        rt.block_on(async {
            add_to_whitelist(&state, "工作应用").await;
            mark_history_not(&state, "某窗口").await;
        });

        // 从文件重新加载，验证已持久化
        let loaded = load_list_config(&path).expect("加载应成功");
        assert!(loaded.whitelist.iter().any(|k| k == "工作应用"));
        assert_eq!(loaded.history.get("某窗口"), Some(&false));
    }
}
