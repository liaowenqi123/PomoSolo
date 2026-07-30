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

/// 生成当前 UTC 时间的 RFC3339 字符串（YYYY-MM-DDTHH:MM:SSZ）
///
/// 复用 epoch_secs_to_ymd 的算法，不引入 chrono 依赖。
/// 旧版 dataManager.js 用 `new Date().toISOString()` 生成同样格式。
fn now_iso_utc() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let day_secs = secs.rem_euclid(86400);
    let hour = day_secs / 3600;
    let min = (day_secs % 3600) / 60;
    let sec = day_secs % 60;

    let (year, month, day) = epoch_secs_to_ymd(secs);

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hour, min, sec
    )
}

/// 作物生长所需时间（分钟），参照旧版 CROP_CONFIG 配置
fn crop_grow_time(crop: &str) -> u64 {
    match crop {
        "carrot" => 25,
        "tomato" => 50,
        "sunflower" => 90,
        "rose" => 120,
        "osmanthus" => 180,
        _ => 0,
    }
}

/// 作物中文名，参照旧版 CROP_CONFIG 配置
fn crop_name(crop: &str) -> &'static str {
    match crop {
        "carrot" => "胡萝卜",
        "tomato" => "番茄",
        "sunflower" => "向日葵",
        "rose" => "玫瑰",
        "osmanthus" => "金桂树",
        _ => "未知作物",
    }
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
/// 参照旧版 dataManager.js 的 gardenPlant：
/// 1. 检查种子数量（seeds[crop] > 0）
/// 2. 检查土地锁定状态（plot.locked）
/// 3. 检查土地是否已有作物（plot.crop 不为 null）
/// 4. 扣减种子，写入 plots[plot_id] = {crop, progress: 0, plantedAt: ISO时间}
/// payload 例子: { "plot_id": 0, "crop": "tomato" }
#[tauri::command]
pub async fn garden_plant(app: AppHandle, plot_id: u32, crop: String) -> Result<Value, String> {
    let mut data = data_manager::read_garden_data(&app)?;
    let obj = data.as_object_mut().ok_or("garden data 不是对象")?;

    // 检查种子数量
    let seed_count = obj
        .get("seeds")
        .and_then(|v| v.as_object())
        .and_then(|s| s.get(&crop))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    if seed_count == 0 {
        return Err("种子不足".to_string());
    }

    // 检查土地状态（锁定 / 已有作物）
    let (locked, has_crop) = {
        let plots = obj
            .get("plots")
            .and_then(|v| v.as_array())
            .ok_or("plots 不是数组")?;
        if plot_id as usize >= plots.len() {
            return Err("土地不存在".to_string());
        }
        let plot = &plots[plot_id as usize];
        let locked = plot.get("locked").and_then(|v| v.as_bool()).unwrap_or(false);
        let has_crop = plot.get("crop").and_then(|v| v.as_str()).is_some();
        (locked, has_crop)
    };
    if locked {
        return Err("土地未解锁".to_string());
    }
    if has_crop {
        return Err("土地上已有作物".to_string());
    }

    // 扣减种子
    {
        let seeds = obj
            .entry("seeds".to_string())
            .or_insert(Value::Object(serde_json::Map::new()));
        if let Some(seeds_obj) = seeds.as_object_mut() {
            seeds_obj.insert(crop.clone(), Value::from(seed_count - 1));
        }
    }

    // 写入种植信息
    {
        let plots = obj
            .entry("plots".to_string())
            .or_insert(Value::Array(vec![]));
        if let Some(arr) = plots.as_array_mut() {
            if (plot_id as usize) < arr.len() {
                arr[plot_id as usize] = serde_json::json!({
                    "id": plot_id,
                    "crop": crop,
                    "progress": 0,
                    "plantedAt": now_iso_utc()
                });
            }
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
/// 参照旧版 dataManager.js 的 gardenUnlockPlot：
/// - 设置 locked = false（而非仅改 state）
/// - 确保 plot 有完整的字段结构（id/crop/progress/plantedAt/locked）
#[tauri::command]
pub async fn garden_unlock(app: AppHandle, plot_id: u32) -> Result<Value, String> {
    let mut data = data_manager::read_garden_data(&app)?;
    let obj = data.as_object_mut().ok_or("garden data 不是对象")?;

    if let Some(plots) = obj.get_mut("plots").and_then(|v| v.as_array_mut()) {
        if (plot_id as usize) < plots.len() {
            plots[plot_id as usize] = serde_json::json!({
                "id": plot_id,
                "crop": null,
                "progress": 0,
                "plantedAt": null,
                "locked": false
            });
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

/// 累加专注时间，触发对应成就
///
/// 在 garden data 中维护 `focusMinutes` 字段（累计专注分钟数），
/// 当达到阈值时返回新解锁的成就（stub：仅累加，不触发复杂成就逻辑）。
/// 返回 GardenOperationResult 形状，与前端 applyResult 期望一致。
#[tauri::command]
pub async fn garden_update_focus(app: AppHandle, minutes: u32) -> Result<Value, String> {
    let mut data = data_manager::read_garden_data(&app)?;
    let obj = data
        .as_object_mut()
        .ok_or("garden data 不是对象")?;

    // 累加 focusMinutes
    let prev = obj
        .get("focusMinutes")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    obj.insert(
        "focusMinutes".to_string(),
        Value::from(prev + minutes as u64),
    );

    data_manager::write_garden_data(&app, &data)?;

    Ok(serde_json::json!({
        "success": true,
        "gardenData": data,
        "unlockedAchievements": []
    }))
}

/// 执行惩罚并返回损失结果（由前台检测调用）
///
/// 参照旧版 dataManager.js 的 handleGardenPunishment：
/// - 遍历所有 plots
/// - 未锁定 + 有作物 + progress < growTime（未成熟）的清空（crop=null, progress=0, plantedAt=null）
/// - 累计 totalMinutes += progress
/// - 记录 losses 数组（含 crop/name/progress/growTime）
/// - 累计 totalLosses
/// - 返回 { hasLoss, losses, totalMinutes }
///
/// 注意：保留 loss_amount 参数以维持前端兼容的函数签名，实际逻辑参照旧版不依赖该值。
#[tauri::command]
pub async fn garden_punishment(app: AppHandle, loss_amount: u32) -> Result<Value, String> {
    let _ = loss_amount;

    let mut data = data_manager::read_garden_data(&app)?;
    let obj = data.as_object_mut().ok_or("garden data 不是对象")?;

    let mut losses: Vec<Value> = Vec::new();
    let mut total_minutes: u64 = 0;

    if let Some(plots) = obj.get_mut("plots").and_then(|v| v.as_array_mut()) {
        for plot in plots.iter_mut() {
            let locked = plot.get("locked").and_then(|v| v.as_bool()).unwrap_or(false);
            if locked {
                continue;
            }

            let crop = match plot.get("crop").and_then(|v| v.as_str()) {
                Some(c) => c.to_string(),
                None => continue,
            };

            let progress = plot.get("progress").and_then(|v| v.as_u64()).unwrap_or(0);
            let grow_time = crop_grow_time(&crop);

            // 只清空未成熟的作物（progress < growTime）
            if progress < grow_time {
                losses.push(serde_json::json!({
                    "crop": crop,
                    "name": crop_name(&crop),
                    "progress": progress,
                    "growTime": grow_time
                }));
                total_minutes += progress;

                // 清空土地
                let id = plot.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                *plot = serde_json::json!({
                    "id": id,
                    "crop": null,
                    "progress": 0,
                    "plantedAt": null
                });
            }
        }
    }

    let has_loss = !losses.is_empty();

    if has_loss {
        // 累计 totalLosses
        let total_losses = obj.get("totalLosses").and_then(|v| v.as_u64()).unwrap_or(0);
        obj.insert(
            "totalLosses".to_string(),
            Value::from(total_losses + losses.len() as u64),
        );
        data_manager::write_garden_data(&app, &data)?;
    }

    Ok(serde_json::json!({
        "hasLoss": has_loss,
        "losses": losses,
        "totalMinutes": total_minutes
    }))
}

/// 更新作物生长进度
///
/// 参照旧版 dataManager.js 的 updateGardenProgress：
/// - 遍历所有有作物的 plots
/// - plot.progress += minutes
/// - 返回更新后的 garden data
#[tauri::command]
pub async fn garden_grow(app: AppHandle, minutes: u32) -> Result<Value, String> {
    let mut data = data_manager::read_garden_data(&app)?;
    let obj = data.as_object_mut().ok_or("garden data 不是对象")?;

    if let Some(plots) = obj.get_mut("plots").and_then(|v| v.as_array_mut()) {
        for plot in plots.iter_mut() {
            let has_crop = plot.get("crop").and_then(|v| v.as_str()).is_some();
            if has_crop {
                let progress = plot.get("progress").and_then(|v| v.as_u64()).unwrap_or(0);
                plot["progress"] = Value::from(progress + minutes as u64);
            }
        }
    }

    data_manager::write_garden_data(&app, &data)?;
    Ok(data)
}
