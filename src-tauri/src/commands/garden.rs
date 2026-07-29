//! 菜园子 commands
//!
//! 直接对接 modules/data_manager.rs 的 read_garden_data / write_garden_data
//! 原子操作（plant/harvest/buy/sell/unlock/signin）当前以 read+modify+write 的简化方式实现

use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::modules::data_manager;

/// 将 epoch 秒数转换为 (year, month, day)，基于 UTC
fn epoch_secs_to_ymd(secs: i64) -> (i64, i64, i64) {
    let mut days = secs.div_euclid(86400);

    let mut year = 1970i64;
    loop {
        let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
        let days_in_year = if is_leap { 366 } else { 365 };
        if days < days_in_year {
            break;
        }
        days -= days_in_year;
        year += 1;
    }

    let is_leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
    let days_in_months: [i64; 12] = if is_leap {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut month = 1i64;
    for (i, &dim) in days_in_months.iter().enumerate() {
        if days < dim {
            month = (i + 1) as i64;
            break;
        }
        days -= dim;
    }

    let day = days + 1;
    (year, month, day)
}

/// 获取今天的日期字符串 (YYYY-MM-DD)，使用 UTC（与前端 toISOString 一致）
fn today_date_string() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (year, month, day) = epoch_secs_to_ymd(secs);
    format!("{:04}-{:02}-{:02}", year, month, day)
}

/// 获取相对今天偏移 N 天的日期字符串 (YYYY-MM-DD)，使用 UTC
fn date_string_offset(offset_days: i64) -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let target_secs = secs + offset_days * 86400;
    let (year, month, day) = epoch_secs_to_ymd(target_secs);
    format!("{:04}-{:02}-{:02}", year, month, day)
}

/// 获取今天是星期几（0=周日, 1=周一...6=周六），基于 UTC
fn week_day_index() -> u32 {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86400);
    // 1970-01-01 是周四，在 0=周日 体系中 = 4
    ((days + 4).rem_euclid(7)) as u32
}

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
/// 写入前端期望的 signIn 对象结构：{ lastDate, continuousDays, totalDays, weekRecords }
/// 返回 GardenOperationResult 形状：{ success, gardenData, unlockedAchievements }
#[tauri::command]
pub async fn garden_signin(app: AppHandle) -> Result<Value, String> {
    let date = today_date_string();
    let mut data = data_manager::read_garden_data(&app)?;

    let obj = data
        .as_object_mut()
        .ok_or("garden data 不是对象")?;

    // 确保 signIn 是对象（注意：前端使用 camelCase 的 signIn）
    let signin = obj
        .entry("signIn".to_string())
        .or_insert(Value::Object(serde_json::Map::new()));
    // 兼容旧数据格式：若 signIn 之前是数组则重置为对象
    if !signin.is_object() {
        *signin = Value::Object(serde_json::Map::new());
    }
    let signin_obj = signin
        .as_object_mut()
        .ok_or("signIn 不是对象")?;

    // 幂等：今日已签到则不重复发奖
    let last_date = signin_obj
        .get("lastDate")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if last_date == date {
        return Ok(serde_json::json!({
            "success": true,
            "gardenData": data,
            "unlockedAchievements": [],
            "message": "今日已签到"
        }));
    }

    // 计算连续签到：上次签到是昨天则 +1，否则重置为 1
    let yesterday = date_string_offset(-1);
    let prev_continuous = signin_obj
        .get("continuousDays")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let prev_total = signin_obj
        .get("totalDays")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let new_continuous = if last_date == yesterday {
        prev_continuous + 1
    } else {
        1
    };
    let new_total = prev_total + 1;

    // 更新签到状态
    signin_obj.insert("lastDate".to_string(), Value::String(date.clone()));
    signin_obj.insert("continuousDays".to_string(), Value::from(new_continuous));
    signin_obj.insert("totalDays".to_string(), Value::from(new_total));

    // 更新本周签到记录（0=周日, 1=周一...6=周六，与前端 weekRecords 约定一致）
    let week_day = week_day_index() as usize;
    let week_records = signin_obj
        .entry("weekRecords".to_string())
        .or_insert(Value::Array(vec![Value::Bool(false); 7]));
    if let Some(arr) = week_records.as_array_mut() {
        while arr.len() < 7 {
            arr.push(Value::Bool(false));
        }
        if week_day < arr.len() {
            arr[week_day] = Value::Bool(true);
        }
    }

    // 发放奖励：+10 金币 +1 胡萝卜种子（与前端 DAILY_REWARD 一致）
    let coins = obj.get("coins").and_then(|v| v.as_u64()).unwrap_or(0);
    obj.insert("coins".to_string(), Value::from(coins + 10));

    let seeds = obj
        .entry("seeds".to_string())
        .or_insert(Value::Object(serde_json::Map::new()));
    if let Some(seeds_obj) = seeds.as_object_mut() {
        let carrot_count = seeds_obj
            .get("carrot")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        seeds_obj.insert("carrot".to_string(), Value::from(carrot_count + 1));
    }

    data_manager::write_garden_data(&app, &data)?;

    // 返回 GardenOperationResult 形状，与前端 applyResult 期望一致
    Ok(serde_json::json!({
        "success": true,
        "gardenData": data,
        "unlockedAchievements": []
    }))
}
