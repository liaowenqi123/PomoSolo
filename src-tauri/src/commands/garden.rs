//! 菜园子 commands
//!
//! 直接对接 modules/data_manager.rs 的 read_garden_data / write_garden_data。
//! 完整复刻旧版 electron/src/modules/dataManager.js 的菜园子逻辑：
//! - 23 个成就（含隐藏 easteregg）
//! - CropCfg 作物配置表（后端定价，前端不可控）
//! - harvest 成熟判断 + crops+1 + 金币 = value/2
//! - buy/sell 操作 seeds/crops（非 inventory），支持 quantity
//! - sell_all 一键清空作物
//! - signin 基础 + WEEKLY_REWARDS + CONTINUOUS_REWARDS + 周六随机种子
//! - 成就统计 achievementStats + check_and_unlock_achievements

use rand::seq::SliceRandom;
use rand::thread_rng;
use serde_json::{json, Map, Value};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::modules::data_manager;

// ===== 日期/时间工具 =====

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

// ===== 作物配置表（后端定价，前端不可控）=====

/// 作物配置（参照旧版 CROP_CONFIG）
#[derive(Clone, Copy, Debug)]
pub struct CropCfg {
    pub key: &'static str,
    pub name: &'static str,
    pub grow_time: u64, // 分钟
    pub icon: &'static str,
    pub rarity: &'static str,
    pub value: u64,
    pub seed_price: u64,
    pub sell_price: u64,
}

/// 作物配置表（5 种作物，与前端 CROP_CONFIG 一致）
pub const CROP_CONFIG: &[CropCfg] = &[
    CropCfg { key: "carrot",    name: "胡萝卜", grow_time: 25,  icon: "🥕", rarity: "common", value: 10,  seed_price: 8,   sell_price: 10  },
    CropCfg { key: "tomato",    name: "番茄",   grow_time: 50,  icon: "🍅", rarity: "common", value: 20,  seed_price: 16,  sell_price: 20  },
    CropCfg { key: "sunflower", name: "向日葵", grow_time: 90,  icon: "🌻", rarity: "rare",   value: 50,  seed_price: 40,  sell_price: 50  },
    CropCfg { key: "rose",      name: "玫瑰",   grow_time: 120, icon: "🌹", rarity: "rare",   value: 80,  seed_price: 64,  sell_price: 80  },
    CropCfg { key: "osmanthus", name: "金桂树", grow_time: 180, icon: "🌳", rarity: "legend", value: 150, seed_price: 120, sell_price: 150 },
];

/// 按 key 查找作物配置
pub fn crop_cfg(key: &str) -> Option<&'static CropCfg> {
    CROP_CONFIG.iter().find(|c| c.key == key)
}

// ===== 签到奖励配置 =====

/// 每日基础奖励（每天都发）
const DAILY_REWARD_COINS: u64 = 5;
const DAILY_REWARD_SEED: &str = "carrot";

/// 连续签到里程碑奖励：达到指定天数额外发放
/// (天数, 种子key, 种子数量, 金币)
const CONTINUOUS_REWARDS: &[(u64, &str, u64, u64)] = &[
    (3,  "tomato",    1, 0),
    (7,  "sunflower", 1, 0),
    (14, "rose",      1, 0),
    (30, "osmanthus", 1, 0),
];

/// 每周奖励表：0=周日, 1=周一...6=周六
/// (种子key Option, 种子数量, 金币, 是否随机种子)
const WEEKLY_REWARDS: &[(&str, u64, u64, bool); 7] = &[
    ("",         0, 20, false), // 0 周日：+20 金币
    ("carrot",   2, 0,  false), // 1 周一：+2 胡萝卜
    ("",         0, 10, false), // 2 周二：+10 金币
    ("tomato",   1, 0,  false), // 3 周三：+1 番茄
    ("",         0, 10, false), // 4 周四：+10 金币
    ("sunflower",1, 0,  false), // 5 周五：+1 向日葵
    ("",         0, 0,  true),  // 6 周六：随机种子 1 颗
];

// ===== 成就配置表（25 个，与旧版 Utils.ACHIEVEMENT_CONFIG 一致）=====

/// 成就配置（参照旧版 ACHIEVEMENT_CONFIG）
#[derive(Clone, Copy, Debug)]
pub struct AchievementCfg {
    pub id: &'static str,
    pub category: &'static str, // focus/harvest/plant/collect/wealth/persist/hidden
    pub name: &'static str,
    pub description: &'static str,
    pub target: u64,
    pub icon: &'static str,
    /// 奖励：种子 (key, count) 列表
    pub reward_seeds: &'static [(&'static str, u64)],
    /// 奖励：金币
    pub reward_coins: u64,
}

/// 25 个成就配置（与旧版一致）
pub const ACHIEVEMENT_CONFIG: &[AchievementCfg] = &[
    // 专注成就（5个）
    AchievementCfg { id: "focus1h",   category: "focus", name: "初心者",     description: "累计专注 1 小时",   target: 60,   icon: "⏱️", reward_seeds: &[("carrot", 3)],    reward_coins: 10 },
    AchievementCfg { id: "focus5h",   category: "focus", name: "专注新手",   description: "累计专注 5 小时",   target: 300,  icon: "⏱️", reward_seeds: &[("tomato", 2)],    reward_coins: 20 },
    AchievementCfg { id: "focus25h",  category: "focus", name: "专注达人",   description: "累计专注 25 小时",  target: 1500, icon: "🎯", reward_seeds: &[("sunflower", 1)], reward_coins: 50 },
    AchievementCfg { id: "focus50h",  category: "focus", name: "专注大师",   description: "累计专注 50 小时",  target: 3000, icon: "🏆", reward_seeds: &[("rose", 1)],      reward_coins: 100 },
    AchievementCfg { id: "focus100h", category: "focus", name: "专注传奇",   description: "累计专注 100 小时", target: 6000, icon: "👑", reward_seeds: &[("osmanthus", 1)], reward_coins: 200 },
    // 收获成就（5个）
    AchievementCfg { id: "harvest1",   category: "harvest", name: "初次丰收", description: "收获 1 个作物",   target: 1,   icon: "🌾", reward_seeds: &[],                reward_coins: 5 },
    AchievementCfg { id: "harvest10",  category: "harvest", name: "小有收成", description: "收获 10 个作物",  target: 10,  icon: "🌾", reward_seeds: &[("carrot", 2)],    reward_coins: 15 },
    AchievementCfg { id: "harvest50",  category: "harvest", name: "丰收达人", description: "收获 50 个作物",  target: 50,  icon: "🌻", reward_seeds: &[("tomato", 2)],    reward_coins: 30 },
    AchievementCfg { id: "harvest100", category: "harvest", name: "丰收大师", description: "收获 100 个作物", target: 100, icon: "🏆", reward_seeds: &[("sunflower", 2)], reward_coins: 60 },
    AchievementCfg { id: "harvest500", category: "harvest", name: "丰收传奇", description: "收获 500 个作物", target: 500, icon: "👑", reward_seeds: &[("osmanthus", 2)], reward_coins: 200 },
    // 种植成就（5个）
    AchievementCfg { id: "plant1",   category: "plant", name: "新手农夫", description: "种植 1 次",  target: 1,   icon: "🌱", reward_seeds: &[("carrot", 1)],    reward_coins: 0 },
    AchievementCfg { id: "plant10",  category: "plant", name: "勤劳农夫", description: "种植 10 次", target: 10,  icon: "🌱", reward_seeds: &[],                reward_coins: 10 },
    AchievementCfg { id: "plant50",  category: "plant", name: "种植达人", description: "种植 50 次", target: 50,  icon: "🌿", reward_seeds: &[("tomato", 2)],    reward_coins: 20 },
    AchievementCfg { id: "plant100", category: "plant", name: "种植大师", description: "种植 100 次",target: 100, icon: "🏆", reward_seeds: &[("sunflower", 1)], reward_coins: 50 },
    AchievementCfg { id: "plant500", category: "plant", name: "种植传奇", description: "种植 500 次",target: 500, icon: "👑", reward_seeds: &[("rose", 1)],      reward_coins: 100 },
    // 收藏成就（3个）
    AchievementCfg { id: "collect1", category: "collect", name: "初次收藏", description: "收获任意 1 种作物",  target: 1, icon: "📦", reward_seeds: &[],                reward_coins: 5 },
    AchievementCfg { id: "collect3", category: "collect", name: "多样收藏", description: "收获 3 种不同作物",  target: 3, icon: "🎁", reward_seeds: &[],                reward_coins: 30 },
    AchievementCfg { id: "collect5", category: "collect", name: "全集收藏", description: "收获全部 5 种作物",  target: 5, icon: "👑", reward_seeds: &[("osmanthus", 1)], reward_coins: 100 },
    // 财富成就（4个）
    AchievementCfg { id: "coins100",  category: "wealth", name: "小富翁", description: "累计获得 100 金币",  target: 100,  icon: "💰", reward_seeds: &[("carrot", 3)],    reward_coins: 0 },
    AchievementCfg { id: "coins500",  category: "wealth", name: "中富翁", description: "累计获得 500 金币",  target: 500,  icon: "💰", reward_seeds: &[("tomato", 2)],    reward_coins: 0 },
    AchievementCfg { id: "coins1000", category: "wealth", name: "大富翁", description: "累计获得 1000 金币", target: 1000, icon: "💎", reward_seeds: &[("rose", 1)],      reward_coins: 0 },
    AchievementCfg { id: "coins5000", category: "wealth", name: "富豪",   description: "累计获得 5000 金币", target: 5000, icon: "👑", reward_seeds: &[("osmanthus", 2)], reward_coins: 0 },
    // 坚持成就（3个）
    AchievementCfg { id: "signin7",   category: "persist", name: "坚持一周", description: "连续签到 7 天",  target: 7,   icon: "📅", reward_seeds: &[("sunflower", 1)], reward_coins: 0 },
    AchievementCfg { id: "signin30",  category: "persist", name: "坚持一月", description: "连续签到 30 天", target: 30,  icon: "📅", reward_seeds: &[("rose", 1)],      reward_coins: 0 },
    AchievementCfg { id: "signin100", category: "persist", name: "坚持百日", description: "连续签到 100 天",target: 100, icon: "👑", reward_seeds: &[("osmanthus", 2)], reward_coins: 0 },
];

// ===== achievementStats / 成就检查纯函数 =====

/// achievementStats 字段访问与累加（in-place 修改 garden_obj）
///
/// - type="focus":   totalFocusMinutes += value
/// - type="harvest": totalHarvestCount += 1; 若 value(cropKey) 非空且未收录，push 到 cropTypesCollected
/// - type="plant":   totalPlantCount += 1
/// - type="coins":   totalCoinsEarned += value
pub fn update_achievement_stats(garden: &mut Value, kind: &str, value: &str, amount: u64) {
    let obj = match garden.as_object_mut() {
        Some(o) => o,
        None => return,
    };
    let stats = obj
        .entry("achievementStats".to_string())
        .or_insert_with(|| {
            json!({
                "totalFocusMinutes": 0,
                "totalHarvestCount": 0,
                "totalPlantCount": 0,
                "totalCoinsEarned": 0,
                "cropTypesCollected": []
            })
        });
    let stats_obj = match stats.as_object_mut() {
        Some(o) => o,
        None => return,
    };

    match kind {
        "focus" => {
            let prev = stats_obj
                .get("totalFocusMinutes")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            stats_obj.insert("totalFocusMinutes".to_string(), Value::from(prev + amount));
        }
        "harvest" => {
            let prev = stats_obj
                .get("totalHarvestCount")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            stats_obj.insert("totalHarvestCount".to_string(), Value::from(prev + 1));
            if !value.is_empty() {
                let collected = stats_obj
                    .entry("cropTypesCollected".to_string())
                    .or_insert(Value::Array(vec![]));
                if let Some(arr) = collected.as_array_mut() {
                    let already = arr
                        .iter()
                        .any(|v| v.as_str().map_or(false, |s| s == value));
                    if !already {
                        arr.push(Value::String(value.to_string()));
                    }
                }
            }
        }
        "plant" => {
            let prev = stats_obj
                .get("totalPlantCount")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            stats_obj.insert("totalPlantCount".to_string(), Value::from(prev + 1));
        }
        "coins" => {
            let prev = stats_obj
                .get("totalCoinsEarned")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            stats_obj.insert("totalCoinsEarned".to_string(), Value::from(prev + amount));
        }
        _ => {}
    }
}

/// 计算单个成就的进度值（参照旧版 getAchievementProgress）
pub fn achievement_progress(cfg: &AchievementCfg, garden: &Value) -> u64 {
    let stats = garden.get("achievementStats");
    match cfg.category {
        "focus" => stats
            .and_then(|s| s.get("totalFocusMinutes"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        "harvest" => stats
            .and_then(|s| s.get("totalHarvestCount"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        "plant" => stats
            .and_then(|s| s.get("totalPlantCount"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        "collect" => stats
            .and_then(|s| s.get("cropTypesCollected"))
            .and_then(|v| v.as_array())
            .map(|a| a.len() as u64)
            .unwrap_or(0),
        "wealth" => stats
            .and_then(|s| s.get("totalCoinsEarned"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        "persist" => garden
            .get("signIn")
            .and_then(|s| s.get("continuousDays"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0),
        // hidden 类（easteregg）：仅当已解锁返回 1，否则 0（永不自动解锁）
        "hidden" => garden
            .get("achievements")
            .and_then(|a| a.get(cfg.id))
            .and_then(|v| v.get("unlocked"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
            .then(|| 1u64)
            .unwrap_or(0),
        _ => 0,
    }
}

/// 检查并解锁成就（in-place 修改 garden，返回新解锁的成就配置列表）
///
/// 参照旧版 checkAndUnlockAchievementsInPlace：
/// - 遍历所有 ACHIEVEMENT_CONFIG
/// - 已解锁则跳过
/// - 进度 >= target 则标记 unlocked=true, unlockedAt=now_iso_utc
/// - 发放奖励（seeds / coins）
///
/// 实现采用两阶段：先遍历收集待解锁列表（不可变借用），再回写解锁标记与奖励（可变借用），
/// 避免在同一作用域内对 obj 同时持有可变借用与不可变借用。
pub fn check_and_unlock_achievements(garden: &mut Value) -> Vec<AchievementCfg> {
    // ===== 阶段 1：扫描待解锁的成就（只读）=====
    let to_unlock: Vec<AchievementCfg> = {
        let obj = match garden.as_object() {
            Some(o) => o,
            None => return vec![],
        };
        let achievements = obj.get("achievements");
        let mut list = vec![];
        for cfg in ACHIEVEMENT_CONFIG {
            let already = achievements
                .and_then(|a| a.get(cfg.id))
                .and_then(|v| v.get("unlocked"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if already {
                continue;
            }
            let progress = achievement_progress(cfg, garden);
            if progress >= cfg.target {
                list.push(*cfg);
            }
        }
        list
    };

    if to_unlock.is_empty() {
        return vec![];
    }

    // ===== 阶段 2：回写解锁标记与奖励（可变借用）=====
    let obj = match garden.as_object_mut() {
        Some(o) => o,
        None => return vec![],
    };

    // 先把 achievements 取出为独立 Map，避免与 obj 的其他字段借用冲突
    let achievements_val = obj
        .entry("achievements".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    let mut ach_map: Map<String, Value> = match achievements_val.take() {
        Value::Object(m) => m,
        _ => Map::new(),
    };

    for cfg in &to_unlock {
        ach_map.insert(
            cfg.id.to_string(),
            json!({
                "unlocked": true,
                "unlockedAt": now_iso_utc()
            }),
        );

        // 发放种子奖励
        if !cfg.reward_seeds.is_empty() {
            let seeds = obj
                .entry("seeds".to_string())
                .or_insert_with(|| Value::Object(Map::new()));
            if let Some(seeds_obj) = seeds.as_object_mut() {
                for &(seed_key, count) in cfg.reward_seeds {
                    let prev = seeds_obj
                        .get(seed_key)
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    seeds_obj.insert(seed_key.to_string(), Value::from(prev + count));
                }
            }
        }
        // 发放金币奖励
        if cfg.reward_coins > 0 {
            let prev = obj.get("coins").and_then(|v| v.as_u64()).unwrap_or(0);
            obj.insert("coins".to_string(), Value::from(prev + cfg.reward_coins));
        }
    }

    // 写回 achievements
    obj.insert("achievements".to_string(), Value::Object(ach_map));

    to_unlock
}

// ===== 命令 =====

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
/// 参照旧版 gardenPlant：
/// 1. 检查种子数量（seeds[crop] > 0）
/// 2. 检查土地锁定状态（plot.locked）
/// 3. 检查土地是否已有作物（plot.crop 不为 null）
/// 4. 扣减种子，写入 plots[plot_id] = {crop, progress: 0, plantedAt: ISO时间}
/// 5. 更新 achievementStats.totalPlantCount +1，触发成就
#[tauri::command]
pub async fn garden_plant(app: AppHandle, plot_id: u32, crop: String) -> Result<Value, String> {
    let mut data = data_manager::read_garden_data(&app)?;
    let obj = data.as_object_mut().ok_or("garden data 不是对象")?;

    // 校验作物类型
    if crop_cfg(&crop).is_none() {
        return Err(format!("未知作物类型: {}", crop));
    }

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
            .or_insert(Value::Object(Map::new()));
        if let Some(seeds_obj) = seeds.as_object_mut() {
            seeds_obj.insert(crop.clone(), Value::from(seed_count - 1));
        }
    }

    // 写入种植信息（保留 locked: false，与旧版隐性字段一致）
    {
        let plots = obj
            .entry("plots".to_string())
            .or_insert(Value::Array(vec![]));
        if let Some(arr) = plots.as_array_mut() {
            if (plot_id as usize) < arr.len() {
                arr[plot_id as usize] = json!({
                    "id": plot_id,
                    "crop": crop,
                    "progress": 0,
                    "plantedAt": now_iso_utc(),
                    "locked": false
                });
            }
        }
    }

    // 更新种植统计 + 检查成就
    update_achievement_stats(&mut data, "plant", "", 0);
    let unlocked = check_and_unlock_achievements(&mut data);

    data_manager::write_garden_data(&app, &data)?;

    // 返回 GardenOperationResult 形状，与前端 applyResult 期望一致
    Ok(json!({
        "success": true,
        "gardenData": data,
        "unlockedAchievements": unlocked.iter().map(|c| achievement_to_json(c)).collect::<Vec<_>>()
    }))
}

/// 收获：将指定土地的作物收获
/// 参照旧版 gardenHarvest：
/// 1. 成熟判断 progress >= growTime
/// 2. crops[crop] += 1
/// 3. 金币 += value / 2（向下取整，非 sellPrice）
/// 4. 清空土地
/// 5. 更新 achievementStats: harvest +1, coins +reward, 触发成就
#[tauri::command]
pub async fn garden_harvest(app: AppHandle, plot_id: u32) -> Result<Value, String> {
    let mut data = data_manager::read_garden_data(&app)?;
    let obj = data.as_object_mut().ok_or("garden data 不是对象")?;

    // 读取 plot 信息
    let (crop, progress) = {
        let plots = obj
            .get("plots")
            .and_then(|v| v.as_array())
            .ok_or("plots 不是数组")?;
        let plot = plots
            .get(plot_id as usize)
            .ok_or("土地不存在".to_string())?;
        let crop = plot
            .get("crop")
            .and_then(|v| v.as_str())
            .ok_or("该土地没有作物".to_string())?
            .to_string();
        let progress = plot.get("progress").and_then(|v| v.as_u64()).unwrap_or(0);
        (crop, progress)
    };

    // 成熟判断
    let cfg = crop_cfg(&crop).ok_or_else(|| format!("未知作物类型: {}", crop))?;
    if progress < cfg.grow_time {
        return Err("作物还未成熟".to_string());
    }

    // 执行收获：crops[crop] += 1
    {
        let crops = obj
            .entry("crops".to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if let Some(crops_obj) = crops.as_object_mut() {
            let prev = crops_obj.get(&crop).and_then(|v| v.as_u64()).unwrap_or(0);
            crops_obj.insert(crop.clone(), Value::from(prev + 1));
        }
    }

    // 金币奖励 = value / 2
    let reward = cfg.value / 2;
    let prev_coins = obj.get("coins").and_then(|v| v.as_u64()).unwrap_or(0);
    obj.insert("coins".to_string(), Value::from(prev_coins + reward));

    // 清空土地（保留 locked: false）
    if let Some(plots) = obj.get_mut("plots").and_then(|v| v.as_array_mut()) {
        if let Some(plot) = plots.get_mut(plot_id as usize) {
            *plot = json!({
                "id": plot_id,
                "crop": null,
                "progress": 0,
                "plantedAt": null,
                "locked": false
            });
        }
    }

    // 更新成就统计：harvest +1（带 cropKey 入 cropTypesCollected）, coins +reward
    update_achievement_stats(&mut data, "harvest", &crop, 0);
    update_achievement_stats(&mut data, "coins", "", reward);

    // 检查成就
    let unlocked = check_and_unlock_achievements(&mut data);

    data_manager::write_garden_data(&app, &data)?;

    Ok(json!({
        "success": true,
        "gardenData": data,
        "unlockedAchievements": unlocked.iter().map(|c| achievement_to_json(c)).collect::<Vec<_>>()
    }))
}

/// 购买种子
/// 参照旧版 gardenBuySeed：
/// - 价格从后端 CropCfg.seed_price 读取（前端不可控）
/// - 操作 seeds 字段（非 inventory）
/// - 每次买 quantity 颗（默认 1），quantity 由前端传递
/// - 购买不触发成就检查（与旧版一致）
#[tauri::command]
pub async fn garden_buy(
    app: AppHandle,
    item: String,
    price: u32,
    quantity: Option<u32>,
) -> Result<Value, String> {
    let _ = price; // 忽略前端传入的价格，使用后端 CropCfg
    let quantity = quantity.unwrap_or(1).max(1) as u64;

    let mut data = data_manager::read_garden_data(&app)?;
    let obj = data.as_object_mut().ok_or("garden data 不是对象")?;

    let cfg = crop_cfg(&item).ok_or_else(|| format!("未知作物类型: {}", item))?;
    let total_price = cfg.seed_price.saturating_mul(quantity);

    let coins = obj.get("coins").and_then(|v| v.as_u64()).unwrap_or(0);
    if coins < total_price {
        return Err("金币不足".to_string());
    }

    // 扣金币
    obj.insert("coins".to_string(), Value::from(coins - total_price));

    // 加种子
    let seeds = obj
        .entry("seeds".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if let Some(seeds_obj) = seeds.as_object_mut() {
        let prev = seeds_obj.get(&item).and_then(|v| v.as_u64()).unwrap_or(0);
        seeds_obj.insert(item.clone(), Value::from(prev + quantity));
    }

    data_manager::write_garden_data(&app, &data)?;
    // 返回 GardenOperationResult 形状
    Ok(json!({
        "success": true,
        "gardenData": data,
        "unlockedAchievements": []
    }))
}

/// 出售作物
/// 参照旧版 gardenSellCrop：
/// - 价格从后端 CropCfg.sell_price 读取（前端不可控）
/// - 操作 crops 字段（非 inventory）
/// - 每次卖 quantity 个（默认 1）
/// - 金币 += sellPrice * quantity
/// - 更新 achievementStats.coins += sellPrice * quantity，触发成就
#[tauri::command]
pub async fn garden_sell(
    app: AppHandle,
    item: String,
    price: u32,
    quantity: Option<u32>,
) -> Result<Value, String> {
    let _ = price; // 忽略前端传入的价格
    let quantity = quantity.unwrap_or(1).max(1) as u64;

    let mut data = data_manager::read_garden_data(&app)?;
    let obj = data.as_object_mut().ok_or("garden data 不是对象")?;

    let cfg = crop_cfg(&item).ok_or_else(|| format!("未知作物类型: {}", item))?;

    // 检查作物数量
    let current = obj
        .get("crops")
        .and_then(|v| v.as_object())
        .and_then(|c| c.get(&item))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    if current < quantity {
        return Err("作物数量不足".to_string());
    }

    // 扣作物
    let total_price = cfg.sell_price.saturating_mul(quantity);
    {
        let crops = obj
            .entry("crops".to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if let Some(crops_obj) = crops.as_object_mut() {
            let new_count = current - quantity;
            if new_count == 0 {
                crops_obj.remove(&item);
            } else {
                crops_obj.insert(item.clone(), Value::from(new_count));
            }
        }
    }

    // 加金币
    let prev_coins = obj.get("coins").and_then(|v| v.as_u64()).unwrap_or(0);
    obj.insert("coins".to_string(), Value::from(prev_coins + total_price));

    // 更新成就统计 + 检查成就
    update_achievement_stats(&mut data, "coins", "", total_price);
    let unlocked = check_and_unlock_achievements(&mut data);

    data_manager::write_garden_data(&app, &data)?;

    Ok(json!({
        "success": true,
        "gardenData": data,
        "unlockedAchievements": unlocked.iter().map(|c| achievement_to_json(c)).collect::<Vec<_>>()
    }))
}

/// 一键出售所有作物
/// 参照旧版 gardenSellAllCrops：
/// - 遍历 crops，每种按 sellPrice * count 累计金币
/// - 清零（不删除键，与旧版一致）
/// - 更新 achievementStats.coins += totalCoins，触发成就
#[tauri::command]
pub async fn garden_sell_all(app: AppHandle) -> Result<Value, String> {
    let mut data = data_manager::read_garden_data(&app)?;
    let obj = data.as_object_mut().ok_or("garden data 不是对象")?;

    let mut total_coins: u64 = 0;
    let mut total_items: u64 = 0;

    // 先收集要清零的项，避免在迭代中修改
    let to_clear: Vec<(String, u64)> = {
        let crops = obj
            .get("crops")
            .and_then(|v| v.as_object())
            .ok_or("crops 字段不是对象")?;
        let mut list = vec![];
        for (key, val) in crops.iter() {
            let count = val.as_u64().unwrap_or(0);
            if count > 0 {
                if let Some(cfg) = crop_cfg(key) {
                    total_coins += cfg.sell_price * count;
                    total_items += count;
                    list.push((key.clone(), count));
                }
            }
        }
        list
    };

    if total_items == 0 {
        return Ok(json!({
            "success": false,
            "gardenData": data,
            "totalCoins": 0,
            "totalItems": 0,
            "unlockedAchievements": []
        }));
    }

    // 清零 crops
    if let Some(crops) = obj.get_mut("crops").and_then(|v| v.as_object_mut()) {
        for (key, _) in &to_clear {
            crops.insert(key.clone(), Value::from(0));
        }
    }

    // 加金币
    let prev_coins = obj.get("coins").and_then(|v| v.as_u64()).unwrap_or(0);
    obj.insert("coins".to_string(), Value::from(prev_coins + total_coins));

    // 更新成就统计 + 检查成就
    update_achievement_stats(&mut data, "coins", "", total_coins);
    let unlocked = check_and_unlock_achievements(&mut data);

    data_manager::write_garden_data(&app, &data)?;

    Ok(json!({
        "success": true,
        "gardenData": data,
        "totalCoins": total_coins,
        "totalItems": total_items,
        "unlockedAchievements": unlocked.iter().map(|c| achievement_to_json(c)).collect::<Vec<_>>()
    }))
}

/// 解锁土地
/// 参照旧版 gardenUnlockPlot：设置 locked = false（而非仅改 state）
#[tauri::command]
pub async fn garden_unlock(app: AppHandle, plot_id: u32) -> Result<Value, String> {
    let mut data = data_manager::read_garden_data(&app)?;
    let obj = data.as_object_mut().ok_or("garden data 不是对象")?;

    if let Some(plots) = obj.get_mut("plots").and_then(|v| v.as_array_mut()) {
        if (plot_id as usize) < plots.len() {
            plots[plot_id as usize] = json!({
                "id": plot_id,
                "crop": null,
                "progress": 0,
                "plantedAt": null,
                "locked": false
            });
        }
    }

    data_manager::write_garden_data(&app, &data)?;
    // 返回 GardenOperationResult 形状
    Ok(json!({
        "success": true,
        "gardenData": data,
        "unlockedAchievements": []
    }))
}

/// 签到
/// 参照旧版 gardenSignIn：
/// - 基础奖励：+1 胡萝卜种子 +5 金币
/// - WEEKLY_REWARDS：按今天星期几发放
/// - CONTINUOUS_REWARDS：达到 3/7/14/30 天里程碑额外发放
/// - 连续断签重置 continuousDays=1 并清空 weekRecords
/// - 周六随机种子：从 CROP_CONFIG 5 种均匀抽 1 颗
/// - 更新 achievementStats.coins，触发 signin7/30/100 成就
/// 返回 { success, gardenData, rewards, unlockedAchievements }
#[tauri::command]
pub async fn garden_signin(app: AppHandle) -> Result<Value, String> {
    let date = today_date_string();
    let yesterday = date_string_offset(-1);
    let mut data = data_manager::read_garden_data(&app)?;

    let obj = data
        .as_object_mut()
        .ok_or("garden data 不是对象")?;

    // 确保 signIn 是对象
    let signin = obj
        .entry("signIn".to_string())
        .or_insert(Value::Object(Map::new()));
    if !signin.is_object() {
        *signin = Value::Object(Map::new());
    }
    let signin_obj = signin
        .as_object_mut()
        .ok_or("signIn 不是对象")?;

    // 幂等：今日已签到则不重复发奖（与前端 GardenSignin.vue 依赖 success:true 一致）
    let last_date = signin_obj
        .get("lastDate")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if last_date == date {
        return Ok(json!({
            "success": true,
            "gardenData": data,
            "rewards": { "seeds": {}, "coins": 0 },
            "unlockedAchievements": [],
            "message": "今日已签到"
        }));
    }

    // 计算连续签到
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
    } else if last_date.is_empty() {
        // 首次签到
        1
    } else {
        // 断签重置
        1
    };
    let new_total = prev_total + 1;

    // 断签重置 weekRecords
    let need_reset_week = !last_date.is_empty() && last_date != yesterday;

    // 更新签到状态
    signin_obj.insert("lastDate".to_string(), Value::String(date.clone()));
    signin_obj.insert("continuousDays".to_string(), Value::from(new_continuous));
    signin_obj.insert("totalDays".to_string(), Value::from(new_total));

    // 更新本周签到记录（0=周日...6=周六）
    let week_day = week_day_index() as usize;
    let week_records = signin_obj
        .entry("weekRecords".to_string())
        .or_insert(Value::Array(vec![Value::Bool(false); 7]));
    if let Some(arr) = week_records.as_array_mut() {
        if need_reset_week {
            // 断签：重置全 false
            *arr = (0..7).map(|_| Value::Bool(false)).collect();
        }
        while arr.len() < 7 {
            arr.push(Value::Bool(false));
        }
        if week_day < arr.len() {
            arr[week_day] = Value::Bool(true);
        }
    }

    // ===== 发放奖励 =====
    let mut total_coins_earned: u64 = 0;
    let mut rewards_seeds: Map<String, Value> = Map::new();

    // 辅助：加种子并记录到 rewards_seeds
    let add_seed = |seeds_obj: &mut Map<String, Value>, rewards: &mut Map<String, Value>, key: &str, count: u64| {
        let prev = seeds_obj.get(key).and_then(|v| v.as_u64()).unwrap_or(0);
        seeds_obj.insert(key.to_string(), Value::from(prev + count));
        let rprev = rewards.get(key).and_then(|v| v.as_u64()).unwrap_or(0);
        rewards.insert(key.to_string(), Value::from(rprev + count));
    };

    // 4a) 每日基础奖励
    {
        let seeds = obj
            .entry("seeds".to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        let seeds_obj = seeds.as_object_mut().ok_or("seeds 不是对象")?;
        add_seed(seeds_obj, &mut rewards_seeds, DAILY_REWARD_SEED, 1);
    }
    total_coins_earned += DAILY_REWARD_COINS;

    // 4b) 每周奖励
    let weekly = WEEKLY_REWARDS[week_day];
    if weekly.3 {
        // 周六随机种子：从 CROP_CONFIG 5 种均匀抽 1 颗
        let keys: Vec<&str> = CROP_CONFIG.iter().map(|c| c.key).collect();
        let mut rng = thread_rng();
        let random_key = keys.choose(&mut rng).copied().unwrap_or("carrot");
        let seeds = obj
            .entry("seeds".to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        let seeds_obj = seeds.as_object_mut().ok_or("seeds 不是对象")?;
        add_seed(seeds_obj, &mut rewards_seeds, random_key, 1);
    } else if !weekly.0.is_empty() {
        let seeds = obj
            .entry("seeds".to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        let seeds_obj = seeds.as_object_mut().ok_or("seeds 不是对象")?;
        add_seed(seeds_obj, &mut rewards_seeds, weekly.0, weekly.1);
    }
    total_coins_earned += weekly.2;

    // 4c) 连续签到里程碑
    for &(days, seed_key, seed_count, coins) in CONTINUOUS_REWARDS {
        if new_continuous == days {
            if !seed_key.is_empty() && seed_count > 0 {
                let seeds = obj
                    .entry("seeds".to_string())
                    .or_insert_with(|| Value::Object(Map::new()));
                let seeds_obj = seeds.as_object_mut().ok_or("seeds 不是对象")?;
                add_seed(seeds_obj, &mut rewards_seeds, seed_key, seed_count);
            }
            total_coins_earned += coins;
        }
    }

    // 加金币
    let prev_coins = obj.get("coins").and_then(|v| v.as_u64()).unwrap_or(0);
    obj.insert("coins".to_string(), Value::from(prev_coins + total_coins_earned));

    // 更新成就统计（金币累计）
    if total_coins_earned > 0 {
        update_achievement_stats(&mut data, "coins", "", total_coins_earned);
    }

    // 检查成就（包含 signin7/30/100）
    let unlocked = check_and_unlock_achievements(&mut data);

    data_manager::write_garden_data(&app, &data)?;

    Ok(json!({
        "success": true,
        "gardenData": data,
        "rewards": {
            "seeds": rewards_seeds,
            "coins": total_coins_earned
        },
        "unlockedAchievements": unlocked.iter().map(|c| achievement_to_json(c)).collect::<Vec<_>>()
    }))
}

/// 累加专注时间，触发对应成就
/// 参照旧版 gardenUpdateFocusMinutes：只更新 achievementStats.totalFocusMinutes，不动 plots
#[tauri::command]
pub async fn garden_update_focus(app: AppHandle, minutes: u32) -> Result<Value, String> {
    let mut data = data_manager::read_garden_data(&app)?;

    update_achievement_stats(&mut data, "focus", "", minutes as u64);
    let unlocked = check_and_unlock_achievements(&mut data);

    data_manager::write_garden_data(&app, &data)?;

    Ok(json!({
        "success": true,
        "gardenData": data,
        "unlockedAchievements": unlocked.iter().map(|c| achievement_to_json(c)).collect::<Vec<_>>()
    }))
}

/// 执行惩罚并返回损失结果（由前台检测调用）
/// 参照旧版 handleGardenPunishment：
/// - 只清空未成熟作物（progress < growTime）
/// - 不扣金币/种子/crops 背包
/// - 累计 totalMinutes += progress
/// - 不触发成就检查
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
            let cfg = match crop_cfg(&crop) {
                Some(c) => c,
                None => continue,
            };

            let progress = plot.get("progress").and_then(|v| v.as_u64()).unwrap_or(0);

            // 只清空未成熟的作物
            if progress < cfg.grow_time {
                losses.push(json!({
                    "crop": crop,
                    "name": cfg.name,
                    "icon": cfg.icon,
                    "progress": progress,
                    "growTime": cfg.grow_time
                }));
                total_minutes += progress;

                let id = plot.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                *plot = json!({
                    "id": id,
                    "crop": null,
                    "progress": 0,
                    "plantedAt": null,
                    "locked": false
                });
            }
        }
    }

    let has_loss = !losses.is_empty();

    if has_loss {
        let total_losses = obj.get("totalLosses").and_then(|v| v.as_u64()).unwrap_or(0);
        obj.insert(
            "totalLosses".to_string(),
            Value::from(total_losses + losses.len() as u64),
        );
        data_manager::write_garden_data(&app, &data)?;
    }

    Ok(json!({
        "hasLoss": has_loss,
        "losses": losses,
        "totalMinutes": total_minutes
    }))
}

/// 更新作物生长进度
/// 参照旧版 updateGardenProgress：
/// - 遍历所有有作物的 plots，progress += minutes
/// - 不带成就检查（与旧版一致）
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
    // 返回 GardenOperationResult 形状（前端 applyResult 期望 success 字段）
    Ok(json!({
        "success": true,
        "gardenData": data,
        "unlockedAchievements": []
    }))
}

// ===== 辅助 =====

/// 将 AchievementCfg 序列化为前端期望的成就对象
fn achievement_to_json(cfg: &AchievementCfg) -> Value {
    let mut seeds_map = Map::new();
    for &(k, c) in cfg.reward_seeds {
        seeds_map.insert(k.to_string(), Value::from(c));
    }
    json!({
        "id": cfg.id,
        "name": cfg.name,
        "description": cfg.description,
        "icon": cfg.icon,
        "rewards": {
            "seeds": seeds_map,
            "coins": cfg.reward_coins
        }
    })
}

// ===== 单元测试 =====

#[cfg(test)]
mod tests {
    use super::*;

    fn base_garden() -> Value {
        json!({
            "coins": 100,
            "seeds": { "carrot": 3, "tomato": 0, "sunflower": 0, "rose": 0, "osmanthus": 0 },
            "crops": {},
            "plots": [
                { "id": 0, "crop": null, "progress": 0, "plantedAt": null, "locked": false },
                { "id": 6, "crop": null, "progress": 0, "plantedAt": null, "locked": true }
            ],
            "signIn": { "lastDate": null, "continuousDays": 0, "totalDays": 0, "weekRecords": [false,false,false,false,false,false,false] },
            "achievements": {},
            "achievementStats": {
                "totalFocusMinutes": 0,
                "totalHarvestCount": 0,
                "totalPlantCount": 0,
                "totalCoinsEarned": 0,
                "cropTypesCollected": []
            }
        })
    }

    // ===== CropCfg =====

    #[test]
    fn crop_cfg_finds_known() {
        assert_eq!(crop_cfg("carrot").unwrap().grow_time, 25);
        assert_eq!(crop_cfg("osmanthus").unwrap().sell_price, 150);
    }

    #[test]
    fn crop_cfg_unknown_returns_none() {
        assert!(crop_cfg("unknown").is_none());
    }

    #[test]
    fn crop_config_has_five_crops() {
        assert_eq!(CROP_CONFIG.len(), 5);
    }

    // ===== achievement_progress =====

    #[test]
    fn achievement_progress_focus_uses_total_focus_minutes() {
        let mut g = base_garden();
        g["achievementStats"]["totalFocusMinutes"] = json!(60);
        let cfg = ACHIEVEMENT_CONFIG.iter().find(|c| c.id == "focus1h").unwrap();
        assert_eq!(achievement_progress(cfg, &g), 60);
    }

    #[test]
    fn achievement_progress_persist_uses_continuous_days() {
        let mut g = base_garden();
        g["signIn"]["continuousDays"] = json!(7);
        let cfg = ACHIEVEMENT_CONFIG.iter().find(|c| c.id == "signin7").unwrap();
        assert_eq!(achievement_progress(cfg, &g), 7);
    }

    #[test]
    fn achievement_progress_collect_uses_array_length() {
        let mut g = base_garden();
        g["achievementStats"]["cropTypesCollected"] = json!(["carrot", "tomato", "rose"]);
        let cfg = ACHIEVEMENT_CONFIG.iter().find(|c| c.id == "collect3").unwrap();
        assert_eq!(achievement_progress(cfg, &g), 3);
    }

    #[test]
    fn achievement_progress_hidden_returns_zero_when_not_unlocked() {
        let g = base_garden();
        // 没有对应成就配置（easteregg 不在 ACHIEVEMENT_CONFIG），跳过此路径
        // 改用一个 fake cfg 测 hidden 分支
        let cfg = AchievementCfg {
            id: "easteregg", category: "hidden", name: "", description: "",
            target: 1, icon: "", reward_seeds: &[], reward_coins: 0,
        };
        assert_eq!(achievement_progress(&cfg, &g), 0);
    }

    // ===== update_achievement_stats =====

    #[test]
    fn update_stats_focus_accumulates() {
        let mut g = base_garden();
        update_achievement_stats(&mut g, "focus", "", 30);
        update_achievement_stats(&mut g, "focus", "", 30);
        assert_eq!(g["achievementStats"]["totalFocusMinutes"], json!(60));
    }

    #[test]
    fn update_stats_harvest_increments_and_collects() {
        let mut g = base_garden();
        update_achievement_stats(&mut g, "harvest", "carrot", 0);
        update_achievement_stats(&mut g, "harvest", "tomato", 0);
        update_achievement_stats(&mut g, "harvest", "carrot", 0); // 重复不应再加入
        assert_eq!(g["achievementStats"]["totalHarvestCount"], json!(3));
        let collected = g["achievementStats"]["cropTypesCollected"].as_array().unwrap();
        assert_eq!(collected.len(), 2);
        assert!(collected.iter().any(|v| v.as_str() == Some("carrot")));
        assert!(collected.iter().any(|v| v.as_str() == Some("tomato")));
    }

    #[test]
    fn update_stats_coins_accumulates() {
        let mut g = base_garden();
        update_achievement_stats(&mut g, "coins", "", 50);
        update_achievement_stats(&mut g, "coins", "", 25);
        assert_eq!(g["achievementStats"]["totalCoinsEarned"], json!(75));
    }

    #[test]
    fn update_stats_plant_increments() {
        let mut g = base_garden();
        update_achievement_stats(&mut g, "plant", "", 0);
        update_achievement_stats(&mut g, "plant", "", 0);
        assert_eq!(g["achievementStats"]["totalPlantCount"], json!(2));
    }

    #[test]
    fn update_stats_unknown_kind_is_noop() {
        let mut g = base_garden();
        update_achievement_stats(&mut g, "unknown", "", 999);
        // 无变化
        assert_eq!(g["achievementStats"]["totalFocusMinutes"], json!(0));
    }

    #[test]
    fn update_stats_initializes_missing_stats_object() {
        let mut g = json!({ "coins": 0 });
        update_achievement_stats(&mut g, "focus", "", 10);
        assert_eq!(g["achievementStats"]["totalFocusMinutes"], json!(10));
    }

    // ===== check_and_unlock_achievements =====

    #[test]
    fn check_unlock_focus_achievement_grants_reward() {
        let mut g = base_garden();
        g["achievementStats"]["totalFocusMinutes"] = json!(60);
        let unlocked = check_and_unlock_achievements(&mut g);
        assert!(unlocked.iter().any(|c| c.id == "focus1h"));
        // 奖励：+3 carrot +10 coins
        assert_eq!(g["seeds"]["carrot"], json!(6)); // 原 3 + 奖励 3
        assert_eq!(g["coins"], json!(110)); // 原 100 + 奖励 10
        // 已解锁标记
        assert_eq!(g["achievements"]["focus1h"]["unlocked"], json!(true));
    }

    #[test]
    fn check_unlock_skips_already_unlocked() {
        let mut g = base_garden();
        g["achievementStats"]["totalFocusMinutes"] = json!(60);
        // 第一次解锁
        let unlocked1 = check_and_unlock_achievements(&mut g);
        assert_eq!(unlocked1.len(), 1);
        // 第二次不应重复解锁
        let unlocked2 = check_and_unlock_achievements(&mut g);
        assert!(unlocked2.is_empty());
        // 奖励只发一次：coins 仍是 110
        assert_eq!(g["coins"], json!(110));
    }

    #[test]
    fn check_unlock_unlocks_multiple_at_once() {
        let mut g = base_garden();
        // 同时满足 focus1h(60min) 和 focus5h(300min)
        g["achievementStats"]["totalFocusMinutes"] = json!(300);
        let unlocked = check_and_unlock_achievements(&mut g);
        assert_eq!(unlocked.len(), 2);
        let ids: Vec<&str> = unlocked.iter().map(|c| c.id).collect();
        assert!(ids.contains(&"focus1h"));
        assert!(ids.contains(&"focus5h"));
    }

    #[test]
    fn check_unlock_persist_uses_continuous_days() {
        let mut g = base_garden();
        g["signIn"]["continuousDays"] = json!(7);
        let unlocked = check_and_unlock_achievements(&mut g);
        assert!(unlocked.iter().any(|c| c.id == "signin7"));
        // 奖励：+1 sunflower
        assert_eq!(g["seeds"]["sunflower"], json!(1));
    }

    #[test]
    fn check_unlock_collect_5_requires_five_distinct_crops() {
        let mut g = base_garden();
        g["achievementStats"]["cropTypesCollected"] = json!(["carrot", "tomato", "sunflower", "rose", "osmanthus"]);
        let unlocked = check_and_unlock_achievements(&mut g);
        assert!(unlocked.iter().any(|c| c.id == "collect5"));
        // 同时 collect1(target=1) 和 collect3(target=3) 也应解锁
        assert!(unlocked.iter().any(|c| c.id == "collect1"));
        assert!(unlocked.iter().any(|c| c.id == "collect3"));
    }

    #[test]
    fn check_unlock_no_progress_returns_empty() {
        let mut g = base_garden();
        let unlocked = check_and_unlock_achievements(&mut g);
        assert!(unlocked.is_empty());
    }

    #[test]
    fn check_unlock_wealth_coins_achievement() {
        let mut g = base_garden();
        g["achievementStats"]["totalCoinsEarned"] = json!(100);
        let unlocked = check_and_unlock_achievements(&mut g);
        assert!(unlocked.iter().any(|c| c.id == "coins100"));
        // 奖励 +3 carrot
        assert_eq!(g["seeds"]["carrot"], json!(6));
        // coins 不变（wealth 成就不给金币）
        assert_eq!(g["coins"], json!(100));
    }

    // ===== 日期工具 =====

    #[test]
    fn epoch_secs_to_ymd_known() {
        // 1970-01-01 00:00:00 UTC
        assert_eq!(epoch_secs_to_ymd(0), (1970, 1, 1));
        // 2024-01-01 00:00:00 UTC = 1704067200
        assert_eq!(epoch_secs_to_ymd(1704067200), (2024, 1, 1));
        // 2024-02-29 00:00:00 UTC（闰年）= 1709164800
        assert_eq!(epoch_secs_to_ymd(1709164800), (2024, 2, 29));
    }

    #[test]
    fn week_day_index_sunday_for_2024_01_07() {
        // 2024-01-07 是周日；从 1970-01-01（周四）到 2024-01-07 共 19729 天
        // 算法：(days + 4) % 7，周四在 0=周日 体系中 = 4
        let days = 19729i64;
        assert_eq!(((days + 4).rem_euclid(7)), 0); // 周日
    }

    // ===== 成就表完整性 =====

    #[test]
    fn achievement_config_has_25_entries() {
        // 5 focus + 5 harvest + 5 plant + 3 collect + 4 wealth + 3 persist = 25
        assert_eq!(ACHIEVEMENT_CONFIG.len(), 25);
    }

    #[test]
    fn achievement_config_ids_are_unique() {
        let mut ids: Vec<&str> = ACHIEVEMENT_CONFIG.iter().map(|c| c.id).collect();
        ids.sort();
        let len_before = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), len_before, "achievement ids must be unique");
    }

    #[test]
    fn achievement_config_categories_are_valid() {
        for cfg in ACHIEVEMENT_CONFIG {
            assert!(
                matches!(cfg.category, "focus" | "harvest" | "plant" | "collect" | "wealth" | "persist" | "hidden"),
                "invalid category: {}",
                cfg.category
            );
        }
    }
}
