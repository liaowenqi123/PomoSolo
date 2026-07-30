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

/// 创建默认菜园子数据结构（参照旧版 electron/src/modules/dataManager.js 的 createDefaultGardenData）
fn create_default_garden_data() -> Value {
    let plots: Vec<Value> = (0..12)
        .map(|i| {
            let mut plot = serde_json::json!({
                "id": i,
                "crop": null,
                "progress": 0,
                "plantedAt": null
            });
            if i >= 6 {
                plot["locked"] = Value::Bool(true);
            }
            plot
        })
        .collect();

    serde_json::json!({
        "coins": 100,
        "focusMinutes": 0,
        "seeds": { "carrot": 3, "tomato": 3, "sunflower": 1, "rose": 0, "osmanthus": 0 },
        "crops": { "carrot": 0, "tomato": 0, "sunflower": 0, "rose": 0, "osmanthus": 0 },
        "plots": plots,
        "achievements": {},
        "totalLosses": 0,
        "checkInData": { "lastCheckIn": null, "streak": 0, "totalDays": 0 }
    })
}

/// 确保 plots 数组有 12 个元素且结构完整（缺失则补齐，超出则截断）
fn ensure_plots_complete(data: &mut Value) {
    let obj = match data.as_object_mut() {
        Some(o) => o,
        None => return,
    };

    let plots = obj
        .entry("plots".to_string())
        .or_insert(Value::Array(vec![]));

    if !plots.is_array() {
        *plots = Value::Array(vec![]);
    }

    let arr = plots.as_array_mut().unwrap();

    while arr.len() < 12 {
        let idx = arr.len() as u32;
        let mut plot = serde_json::json!({
            "id": idx,
            "crop": null,
            "progress": 0,
            "plantedAt": null
        });
        if idx >= 6 {
            plot["locked"] = Value::Bool(true);
        }
        arr.push(plot);
    }

    arr.truncate(12);
}

/// 读取菜园子数据（带锁）
///
/// 文件不存在或为空时返回默认数据结构（含 12 块 plots），
/// 文件存在但 plots 缺失或不足 12 个时自动补齐。
pub fn read_garden_data(app: &AppHandle) -> Result<Value, String> {
    let _lock = GARDEN_LOCK.lock().map_err(|e| e.to_string())?;
    let path = get_data_dir(app).join("garden_data.json");

    let mut data = if !path.exists() {
        create_default_garden_data()
    } else {
        match fs::read_to_string(&path) {
            Ok(content) if content.trim().is_empty() => create_default_garden_data(),
            Ok(content) => match serde_json::from_str::<Value>(&content) {
                Ok(v) if v.is_object() => v,
                _ => create_default_garden_data(),
            },
            Err(_) => create_default_garden_data(),
        }
    };

    ensure_plots_complete(&mut data);

    Ok(data)
}

/// 写入菜园子数据（带锁）
pub fn write_garden_data(app: &AppHandle, data: &Value) -> Result<(), String> {
    let _lock = GARDEN_LOCK.lock().map_err(|e| e.to_string())?;
    let path = get_data_dir(app).join("garden_data.json");
    write_json_file(&path, data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;
    use tempfile::TempDir;

    #[test]
    fn test_read_json_file_nonexistent() {
        // 不存在的文件应返回空对象
        let path = PathBuf::from("/this/path/should/not/exist/anywhere/data.json");
        let result = read_json_file(&path).expect("读取不存在的文件应返回 Ok(空对象)");
        assert!(result.is_object(), "结果应为 JSON 对象");
        assert!(result.as_object().unwrap().is_empty(), "对象应为空");
    }

    #[test]
    fn test_read_json_file_empty_returns_empty_object() {
        // 空文件应返回空对象
        let dir = TempDir::new().expect("创建临时目录失败");
        let path = dir.path().join("empty.json");
        std::fs::write(&path, "   ").expect("写入空文件失败");

        let result = read_json_file(&path).expect("读取空文件应返回 Ok(空对象)");
        assert!(result.is_object());
        assert!(result.as_object().unwrap().is_empty());
    }

    #[test]
    fn test_write_and_read_json() {
        let dir = TempDir::new().expect("创建临时目录失败");
        let path = dir.path().join("data.json");

        let data = json!({
            "name": "PomoSolo",
            "count": 42,
            "nested": { "key": "value" },
            "list": [1, 2, 3]
        });

        write_json_file(&path, &data).expect("写入 JSON 应成功");

        // 文件应确实存在
        assert!(path.exists(), "写入后文件应存在");

        let read_back = read_json_file(&path).expect("读取 JSON 应成功");
        assert_eq!(read_back, data, "读取的数据应与写入的数据相同");
    }

    #[test]
    fn test_write_json_overwrites_existing() {
        let dir = TempDir::new().expect("创建临时目录失败");
        let path = dir.path().join("overwrite.json");

        let first = json!({ "version": 1 });
        write_json_file(&path, &first).expect("首次写入应成功");

        let second = json!({ "version": 2, "extra": true });
        write_json_file(&path, &second).expect("覆盖写入应成功");

        let read_back = read_json_file(&path).expect("读取应成功");
        assert_eq!(read_back, second, "应得到最新写入的数据");
    }

    #[test]
    fn test_read_json_file_invalid_json_returns_error() {
        let dir = TempDir::new().expect("创建临时目录失败");
        let path = dir.path().join("invalid.json");
        std::fs::write(&path, "{ not valid json").expect("写入非法 JSON 失败");

        let result = read_json_file(&path);
        assert!(result.is_err(), "非法 JSON 应返回错误");
    }

    #[test]
    fn test_write_json_creates_pretty_format() {
        let dir = TempDir::new().expect("创建临时目录失败");
        let path = dir.path().join("pretty.json");

        let data = json!({ "a": 1, "b": 2 });
        write_json_file(&path, &data).expect("写入应成功");

        let content = std::fs::read_to_string(&path).expect("读取文件内容失败");
        // pretty 格式应包含换行
        assert!(content.contains('\n'), "pretty JSON 应包含换行");
        // 应能重新解析
        let parsed: Value = serde_json::from_str(&content).expect("pretty JSON 应可解析");
        assert_eq!(parsed, data);
    }
}
