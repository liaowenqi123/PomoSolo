//! 菜园子 commands
//!
//! 直接对接 modules/data_manager.rs 的 read_garden_data / write_garden_data
//! 原子操作（plant/harvest/buy/sell/unlock/signin）当前以 read+modify+write 的简化方式实现

use serde_json::Value;
use tauri::AppHandle;

use crate::modules::data_manager;

/// 读取菜园子数据
#[tauri::command]
pub async fn garden_read(app: AppHandle) -> Result<Value, String> {
    data_manager::read_garden_data(&app)
}

/// 写入菜园子数据
#[tauri::command]
pub async fn garden_write(app: AppHandle, data: Value) -> Result<(), String> {
    data_manager::write_garden_data(&app, &data)
}

/// 种植：在指定土地种植作物
/// payload 例子: { "plot_id": 0, "crop": "tomato" }
#[tauri::command]
pub async fn garden_plant(app: AppHandle, plot_id: u32, crop: String) -> Result<Value, String> {
    let mut data = data_manager::read_garden_data(&app)?;
    let plots = data
        .as_object_mut()
        .ok_or("garden data 不是对象")?
        .entry("plots")
        .or_insert(Value::Array(vec![]));
    if let Some(arr) = plots.as_array_mut() {
        if let Some(plot) = arr.get_mut(plot_id as usize) {
            plot["crop"] = Value::String(crop.clone());
            plot["state"] = Value::String("growing".to_string());
        }
    }
    data_manager::write_garden_data(&app, &data)?;
    Ok(data)
}

/// 收获：将指定土地的作物标记为已收获
#[tauri::command]
pub async fn garden_harvest(app: AppHandle, plot_id: u32) -> Result<Value, String> {
    let mut data = data_manager::read_garden_data(&app)?;
    if let Some(plots) = data.get_mut("plots").and_then(|v| v.as_array_mut()) {
        if let Some(plot) = plots.get_mut(plot_id as usize) {
            plot["crop"] = Value::Null;
            plot["state"] = Value::String("empty".to_string());
        }
    }
    data_manager::write_garden_data(&app, &data)?;
    Ok(data)
}

/// 购买：扣减金币
#[tauri::command]
pub async fn garden_buy(app: AppHandle, item: String, price: u32) -> Result<Value, String> {
    let mut data = data_manager::read_garden_data(&app)?;
    let coins = data
        .get("coins")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    if coins < price as u64 {
        return Err("金币不足".to_string());
    }
    if let Some(obj) = data.as_object_mut() {
        obj.insert("coins".to_string(), Value::from(coins - price as u64));
        let inventory = obj
            .entry("inventory")
            .or_insert_with(|| Value::Object(serde_json::Map::new()));
        if let Some(inv) = inventory.as_object_mut() {
            let count = inv.get(&item).and_then(|v| v.as_u64()).unwrap_or(0);
            inv.insert(item, Value::from(count + 1));
        }
    }
    data_manager::write_garden_data(&app, &data)?;
    Ok(data)
}

/// 出售：增加金币
#[tauri::command]
pub async fn garden_sell(app: AppHandle, item: String, price: u32) -> Result<Value, String> {
    let mut data = data_manager::read_garden_data(&app)?;
    if let Some(obj) = data.as_object_mut() {
        if let Some(inventory) = obj.get_mut("inventory").and_then(|v| v.as_object_mut()) {
            let count = inventory.get(&item).and_then(|v| v.as_u64()).unwrap_or(0);
            if count == 0 {
                return Err("物品不存在或数量为 0".to_string());
            }
            if count <= 1 {
                inventory.remove(&item);
            } else {
                inventory.insert(item.clone(), Value::from(count - 1));
            }
        }
        let coins = obj.get("coins").and_then(|v| v.as_u64()).unwrap_or(0);
        obj.insert("coins".to_string(), Value::from(coins + price as u64));
    }
    data_manager::write_garden_data(&app, &data)?;
    Ok(data)
}

/// 解锁土地
#[tauri::command]
pub async fn garden_unlock(app: AppHandle, plot_id: u32) -> Result<Value, String> {
    let mut data = data_manager::read_garden_data(&app)?;
    let plots = data
        .as_object_mut()
        .ok_or("garden data 不是对象")?
        .entry("plots")
        .or_insert(Value::Array(vec![]));
    if let Some(arr) = plots.as_array_mut() {
        while arr.len() <= plot_id as usize {
            arr.push(serde_json::json!({ "state": "locked" }));
        }
        if let Some(plot) = arr.get_mut(plot_id as usize) {
            plot["state"] = Value::String("empty".to_string());
        }
    }
    data_manager::write_garden_data(&app, &data)?;
    Ok(data)
}

/// 签到
#[tauri::command]
pub async fn garden_signin(app: AppHandle, date: String) -> Result<Value, String> {
    let mut data = data_manager::read_garden_data(&app)?;
    let signin = data
        .as_object_mut()
        .ok_or("garden data 不是对象")?
        .entry("signin")
        .or_insert(Value::Array(vec![]));
    if let Some(arr) = signin.as_array_mut() {
        if !arr.iter().any(|d| d.as_str() == Some(&date)) {
            arr.push(Value::String(date.clone()));
        }
    }
    let coins = data.get("coins").and_then(|v| v.as_u64()).unwrap_or(0);
    if let Some(obj) = data.as_object_mut() {
        obj.insert("coins".to_string(), Value::from(coins + 10));
    }
    data_manager::write_garden_data(&app, &data)?;
    Ok(data)
}
