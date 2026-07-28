//! 前台检测模块（Rust 重写，替代 Python foreground_inspection.py）
//!
//! 使用 windows crate 获取前台窗口标题
//! 使用 reqwest 调用 DeepSeek API 做娱乐性判断

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};
#[cfg(windows)]
use windows::Win32::Foundation::HWND;

/// 检测状态
pub struct DetectionState {
    pub running: AtomicBool,
    pub api_key: tokio::sync::RwLock<Option<String>>,
}

impl Default for DetectionState {
    fn default() -> Self {
        Self {
            running: AtomicBool::new(false),
            api_key: tokio::sync::RwLock::new(None),
        }
    }
}

/// 检测结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectionResult {
    pub window_title: String,
    pub is_entertainment: bool,
    pub source: String, // "blacklist" | "whitelist" | "ai" | "history"
    pub keyword: String,
}

/// 获取当前前台窗口标题
#[cfg(windows)]
pub fn get_foreground_window_title() -> Option<String> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0 == 0 {
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

/// DeepSeek API 娱乐性判断
pub async fn check_is_entertainment(
    api_key: &str,
    window_title: &str,
) -> Result<bool, String> {
    let client = reqwest::Client::new();
    
    let prompt = format!(
        "判断以下窗口标题是否属于娱乐类应用（如游戏、视频、音乐、社交媒体等）。\n\
         窗口标题: \"{}\"\n\n\
         只回答 true 或 false。",
        window_title
    );
    
    let body = serde_json::json!({
        "model": "deepseek-chat",
        "messages": [
            {"role": "system", "content": "你是一个窗口分类助手，只回答 true 或 false。"},
            {"role": "user", "content": prompt}
        ],
        "max_tokens": 10,
        "temperature": 0.1
    });
    
    let resp = client
        .post("https://api.deepseek.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    
    let json: Value = resp.json().await.map_err(|e| e.to_string())?;
    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("false")
        .trim()
        .to_lowercase();
    
    Ok(content.contains("true"))
}

use serde_json::Value;

/// 启动检测循环
pub fn start_detection(
    state: Arc<DetectionState>,
    event_tx: mpsc::UnboundedSender<DetectionResult>,
) {
    state.running.store(true, Ordering::Relaxed);
    
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        
        while state.running.load(Ordering::Relaxed) {
            interval.tick().await;
            
            // 获取前台窗口标题
            let title = match get_foreground_window_title() {
                Some(t) if !t.is_empty() => t,
                _ => continue,
            };
            
            // 获取 API Key
            let api_key = state.api_key.read().await.clone();
            
            if let Some(ref key) = api_key {
                // 调用 AI 判断
                match check_is_entertainment(key, &title).await {
                    Ok(true) => {
                        let _ = event_tx.send(DetectionResult {
                            window_title: title,
                            is_entertainment: true,
                            source: "ai".to_string(),
                            keyword: String::new(),
                        });
                    }
                    Ok(false) => {}
                    Err(e) => {
                        eprintln!("[ForegroundDetection] AI 判断失败: {}", e);
                    }
                }
            }
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
