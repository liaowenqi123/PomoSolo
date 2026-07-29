use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// 获取数据目录路径
fn get_data_dir(app: &AppHandle) -> PathBuf {
    let mut path = app.path().app_data_dir().unwrap_or_else(|_| {
        dirs::data_dir().unwrap_or_else(|| PathBuf::from("."))
    });
    path.push("PomoSolo");
    path.push("data");
    let _ = fs::create_dir_all(&path);
    path
}

#[tauri::command]
pub async fn read_data(app: AppHandle) -> Result<Value, String> {
    let path = get_data_dir(&app).join("data.json");
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        Ok(serde_json::json!({}))
    }
}

#[tauri::command]
pub async fn write_data(app: AppHandle, data: Value) -> Result<(), String> {
    let path = get_data_dir(&app).join("data.json");
    let content = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_settings(app: AppHandle) -> Result<Value, String> {
    let path = get_data_dir(&app).join("settings.json");
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        Ok(serde_json::json!({}))
    }
}

#[tauri::command]
pub async fn write_settings(app: AppHandle, settings: Value) -> Result<(), String> {
    let path = get_data_dir(&app).join("settings.json");
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())
}
