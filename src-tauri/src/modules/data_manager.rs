//! 数据管理模块（Rust 重写）
//! 
//! 对应 Electron 版的 src/modules/dataManager.js
//! 管理 data.json / garden_data.json / settings.json

use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// 菜园子数据锁（防止并发写）
static GARDEN_LOCK: Mutex<()> = Mutex::new(());

/// 获取数据目录
fn get_data_dir(app: &AppHandle) -> PathBuf {
    let mut path = app.path().app_data_dir().unwrap_or_else(|_| {
        dirs::data_dir().unwrap_or_else(|| PathBuf::from("."))
    });
    path.push("PomoSolo");
    path.push("data");
    let _ = fs::create_dir_all(&path);
    path
}

/// 读取 JSON 文件
pub fn read_json_file(path: &PathBuf) -> Result<Value, String> {
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    if content.trim().is_empty() {
        return Ok(serde_json::json!({}));
    }
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

/// 写入 JSON 文件
pub fn write_json_file(path: &PathBuf, data: &Value) -> Result<(), String> {
    let content = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

/// 读取主数据
pub fn read_data(app: &AppHandle) -> Result<Value, String> {
    let path = get_data_dir(app).join("data.json");
    read_json_file(&path)
}

/// 写入主数据
pub fn write_data(app: &AppHandle, data: &Value) -> Result<(), String> {
    let path = get_data_dir(app).join("data.json");
    write_json_file(&path, data)
}

/// 读取设置
pub fn read_settings(app: &AppHandle) -> Result<Value, String> {
    let path = get_data_dir(app).join("settings.json");
    read_json_file(&path)
}

/// 写入设置
pub fn write_settings(app: &AppHandle, settings: &Value) -> Result<(), String> {
    let path = get_data_dir(app).join("settings.json");
    write_json_file(&path, settings)
}

/// 读取菜园子数据（带锁）
pub fn read_garden_data(app: &AppHandle) -> Result<Value, String> {
    let _lock = GARDEN_LOCK.lock().map_err(|e| e.to_string())?;
    let path = get_data_dir(app).join("garden_data.json");
    read_json_file(&path)
}

/// 写入菜园子数据（带锁）
pub fn write_garden_data(app: &AppHandle, data: &Value) -> Result<(), String> {
    let _lock = GARDEN_LOCK.lock().map_err(|e| e.to_string())?;
    let path = get_data_dir(app).join("garden_data.json");
    write_json_file(&path, data)
}
