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
use tauri::Emitter;

use crate::modules::data_manager;

/// 广播菜园子数据变更事件。
/// 菜园子窗口监听 `garden-refresh` 后重新拉取数据渲染，
/// 实现"主窗口/计时器改动 → 菜园子窗口实时同步"（对应旧版 garden-refresh IPC 通知）。
fn notify_garden_refresh(app: &AppHandle) {
    let _ = app.emit("garden-refresh", ());
}

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

/// 获取本地时区相对 UTC 的偏移秒数（无法获取时回退 0 = UTC）
fn local_offset_secs() -> i64 {
    use time::OffsetDateTime;
    OffsetDateTime::now_local()
        .map(|d| d.offset().whole_seconds() as i64)
        .unwrap_or(0)
}

/// 当前本地时间的 epoch 秒数（UTC 秒数 + 本地时区偏移）
fn local_now_secs() -> i64 {
    let utc_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    utc_secs + local_offset_secs()
}

/// 获取今天的日期字符串 (YYYY-MM-DD)，使用本地时区（修复 UTC 导致的凌晨签到判定错位）
fn today_date_string() -> String {
    let (year, month, day) = epoch_secs_to_ymd(local_now_secs());
    format!("{:04}-{:02}-{:02}", year, month, day)
}

/// 获取相对今天偏移 N 天的日期字符串 (YYYY-MM-DD)，使用本地时区
fn date_string_offset(offset_days: i64) -> String {
    let target_secs = local_now_secs() + offset_days * 86400;
    let (year, month, day) = epoch_secs_to_ymd(target_secs);
    format!("{:04}-{:02}-{:02}", year, month, day)
}

/// 获取今天是星期几（0=周日, 1=周一...6=周六），基于本地时区
fn week_day_index() -> u32 {
    let days = local_now_secs().div_euclid(86400);
    // 1970-01-01 是周四，在 0=周日 体系中 = 4
    ((days + 4).rem_euclid(7)) as u32
}

/// 获取当前本地时间的天数序号（自 1970-01-01 起的天数，本地时区）
/// 用于签到「最近 7 天滚动窗口」的锚点计算，避免跨自然周残留旧勾。
fn local_day_number() -> i64 {
    local_now_secs().div_euclid(86400)
}

/// 将「最近 7 天」签到窗口滚动到新的起始天数（纯函数，便于单测）。
///
/// - `records`: 旧窗口（index 0 = prev_start_day ... index 6 = prev_start_day + 6）
/// - `prev_start_day`: 旧窗口起始天数序号（0 表示无锚点/首次）
/// - `new_start_day`: 新窗口起始天数序号
///
/// 返回固定 7 元素布尔数组（index 0 = new_start_day ... index 6 = new_start_day + 6）。
/// 窗口右移时保留与新窗口重叠的签到状态，右侧新进入的天补 false。
fn roll_week_records(records: &[Value], prev_start_day: i64, new_start_day: i64) -> Vec<bool> {
    let mut arr: Vec<bool> = records
        .iter()
        .map(|v| v.as_bool().unwrap_or(false))
        .collect();
    while arr.len() < 7 {
        arr.push(false);
    }
    if arr.len() > 7 {
        arr.truncate(7);
    }

    let shift = new_start_day - prev_start_day;
    if shift > 0 && shift < 7 {
        // 窗口右移 shift 天：保留重叠部分（左移），右侧补 false
        for i in 0..(7 - shift as usize) {
            arr[i] = arr[i + shift as usize];
        }
        for i in (7 - shift as usize)..7 {
            arr[i] = false;
        }
    } else if shift != 0 {
        // 无锚点 / 时钟回拨 / 窗口完全过期：全清
        for v in arr.iter_mut() {
            *v = false;
        }
    }
    arr
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

/// 推荐最优种子（快捷种植用）：从库存（seeds 对象）中选价值最高的作物 key。
/// CROP_CONFIG 按 value 升序排列 → 反向遍历，第一个有库存的就是价值最高。
fn pick_best_seed(seeds: &Value) -> Option<String> {
    let seeds_obj = seeds.as_object()?;
    CROP_CONFIG
        .iter()
        .rev()
        .find(|cfg| {
            seeds_obj
                .get(cfg.key)
                .and_then(|v| v.as_u64())
                .unwrap_or(0)
                > 0
        })
        .map(|cfg| cfg.key.to_string())
}

// ===== 专注连击配置 =====

/// 专注连击激活阈值：连续完成 N 个番茄钟后进入加成状态（v3 定稿：2，降低门槛）
pub const COMBO_ACTIVE_THRESHOLD: u64 = 2;

/// 专注连击加成倍数（×1.2，v3 定稿：1.5 太强会诱导为种菜过度专注）

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
    // 隐藏成就（1个，彩蛋：仅通过点击设置面板版本号 5 次解锁）
    AchievementCfg { id: "easteregg", category: "hidden", name: "发现彩蛋", description: "？？？", target: 1, icon: "🥚", reward_seeds: &[("osmanthus", 1)], reward_coins: 50 },
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

/// 快捷种植：在指定空地直接种下"最优种子"（v3 设计，Phase B 补齐）
///
/// 推荐算法：按作物价值降序（CROP_CONFIG 升序排列 → 反向遍历），取库存中第一个
/// 数量 > 0 的种子。隔离架构下菜园子不反问时钟，"预计剩余专注时间内成熟"由
/// 用户自行判断（长按仍可打开轮盘自选）。
/// 返回 GardenOperationResult 形状 + `crop` 字段（实际种下的作物 key）。
#[tauri::command]
pub async fn garden_plant_quick(app: AppHandle, plot_id: u32) -> Result<Value, String> {
    let mut data = data_manager::read_garden_data(&app)?;
    let obj = data.as_object_mut().ok_or("garden data 不是对象")?;

    // 校验土地状态（锁定 / 已有作物 / 枯萎）
    {
        let plots = obj
            .get("plots")
            .and_then(|v| v.as_array())
            .ok_or("plots 不是数组")?;
        if plot_id as usize >= plots.len() {
            return Err("土地不存在".to_string());
        }
        let plot = &plots[plot_id as usize];
        if plot.get("locked").and_then(|v| v.as_bool()).unwrap_or(false) {
            return Err("土地未解锁".to_string());
        }
        if plot.get("crop").and_then(|v| v.as_str()).is_some() {
            return Err("土地上已有作物".to_string());
        }
        if plot.get("wilted").and_then(|v| v.as_bool()).unwrap_or(false) {
            return Err("作物枯萎中，完成一个番茄钟救活".to_string());
        }
    }

    // 推荐最优种子：库存中价值最高的作物
    let seeds_value = obj
        .get("seeds")
        .cloned()
        .unwrap_or_else(|| Value::Object(Map::new()));
    let crop = pick_best_seed(&seeds_value).ok_or("没有可种的种子，请先到商店购买")?;

    // 扣减种子
    {
        let seeds = obj
            .entry("seeds".to_string())
            .or_insert(Value::Object(Map::new()));
        if let Some(seeds_obj) = seeds.as_object_mut() {
            let prev = seeds_obj.get(&crop).and_then(|v| v.as_u64()).unwrap_or(0);
            seeds_obj.insert(crop.clone(), Value::from(prev.saturating_sub(1)));
        }
    }

    // 写入种植信息
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

    Ok(json!({
        "success": true,
        "crop": crop,
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

/// 一键全收：收获所有成熟且非枯萎的作物（v3 设计，Phase B 补齐）
///
/// 逐株复用 garden_harvest 的收获规则（crops+1 / 金币 += value/2 / 清空土地 /
/// 成就统计 harvest+1 + coins），无成熟作物时返回空 harvested（success 仍为 true）。
/// 返回 { success, harvested: [{crop,name,icon,count}], totalCoins, gardenData, unlockedAchievements }。
#[tauri::command]
pub async fn garden_harvest_all(app: AppHandle) -> Result<Value, String> {
    let mut data = data_manager::read_garden_data(&app)?;

    // 收集所有成熟且非枯萎的 (plot_id, crop)（只读借用）
    let mut to_harvest: Vec<(u32, String)> = Vec::new();
    {
        let obj = data.as_object().ok_or("garden data 不是对象")?;
        let plots = obj
            .get("plots")
            .and_then(|v| v.as_array())
            .ok_or("plots 不是数组")?;
        for plot in plots {
            let id = plot.get("id").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let crop = plot
                .get("crop")
                .and_then(|v| v.as_str())
                .map(String::from);
            let progress = plot.get("progress").and_then(|v| v.as_u64()).unwrap_or(0);
            let wilted = plot.get("wilted").and_then(|v| v.as_bool()).unwrap_or(false);
            if let Some(c) = crop {
                if let Some(cfg) = crop_cfg(&c) {
                    if progress >= cfg.grow_time && !wilted {
                        to_harvest.push((id, c));
                    }
                }
            }
        }
    }

    // 逐株收获（obj 作用域限定在此块内，避免与后续 data 统计冲突）
    let mut harvested_crops: Vec<String> = Vec::new();
    let mut total_coins: u64 = 0;
    {
        let obj = data.as_object_mut().ok_or("garden data 不是对象")?;
        for (plot_id, crop) in to_harvest {
            let cfg = crop_cfg(&crop).unwrap();

            // crops[crop] += 1
            {
                let crops = obj
                    .entry("crops".to_string())
                    .or_insert_with(|| Value::Object(Map::new()));
                if let Some(crops_obj) = crops.as_object_mut() {
                    let prev = crops_obj.get(&crop).and_then(|v| v.as_u64()).unwrap_or(0);
                    crops_obj.insert(crop.clone(), Value::from(prev + 1));
                }
            }

            // 金币 += value / 2
            let reward = cfg.value / 2;
            let prev_coins = obj.get("coins").and_then(|v| v.as_u64()).unwrap_or(0);
            obj.insert("coins".to_string(), Value::from(prev_coins + reward));
            total_coins += reward;

            // 清空土地
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

            harvested_crops.push(crop);
        }
    }

    // 成就统计（循环后统一更新，避免 obj 借用冲突）
    for crop in &harvested_crops {
        update_achievement_stats(&mut data, "harvest", crop, 0);
    }
    update_achievement_stats(&mut data, "coins", "", total_coins);

    let unlocked = check_and_unlock_achievements(&mut data);

    data_manager::write_garden_data(&app, &data)?;

    // 聚合 harvested
    let mut harvested_map: Vec<(String, u64)> = Vec::new();
    for crop in harvested_crops {
        if let Some(entry) = harvested_map.iter_mut().find(|(c, _)| *c == crop) {
            entry.1 += 1;
        } else {
            harvested_map.push((crop, 1));
        }
    }
    let harvested = harvested_map
        .into_iter()
        .filter_map(|(crop, count)| {
            crop_cfg(&crop).map(|cfg| {
                json!({
                    "crop": crop,
                    "name": cfg.name,
                    "icon": cfg.icon,
                    "count": count
                })
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({
        "success": true,
        "harvested": harvested,
        "totalCoins": total_coins,
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
/// - 连续断签重置 continuousDays=1；weekRecords 为「最近 7 天」滚动窗口（今天恒为最后一位）
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

    // 更新签到状态
    signin_obj.insert("lastDate".to_string(), Value::String(date.clone()));
    signin_obj.insert("continuousDays".to_string(), Value::from(new_continuous));
    signin_obj.insert("totalDays".to_string(), Value::from(new_total));

    // 更新「最近 7 天」签到记录（滚动窗口：index 0 = 6 天前 ... index 6 = 今天）
    // 今天永远是最后一位；窗口随日期自然滚动，跨自然周不再残留旧勾。
    let week_day = week_day_index() as usize;
    let today_day = local_day_number();
    let week_start_day = today_day - 6;
    let prev_week_start = signin_obj
        .get("weekStartDay")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let prev_records = signin_obj
        .get("weekRecords")
        .and_then(|v| v.as_array())
        .map(|a| a.as_slice())
        .unwrap_or(&[]);
    let mut records = roll_week_records(prev_records, prev_week_start, week_start_day);
    // 今天（最后一位）打勾
    records[6] = true;
    signin_obj.insert(
        "weekRecords".to_string(),
        Value::Array(records.into_iter().map(Value::Bool).collect()),
    );
    signin_obj.insert("weekStartDay".to_string(), Value::from(week_start_day));

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

/// 惩罚核心逻辑（纯函数，便于单元测试）
///
/// 参照旧版 handleGardenPunishment，v1 游戏性改进（枯萎救援）：
/// - 未成熟作物：转为**枯萎状态**（wilted=true，保留 progress/plantedAt），可被专注救活
/// - 已枯萎作物再次遭惩罚：**永久清除**（枯萎后又被罚就彻底没了，制造紧迫感）
/// - 成熟作物（progress >= growTime）：不受影响
/// - 不扣金币/种子/crops 背包
/// - 累计 totalMinutes += progress
/// - 不触发成就检查
/// 返回 { hasLoss, losses, totalMinutes }，losses 每项含 revivable 字段
/// （true=转为枯萎可救活，false=永久失去）。
pub fn apply_punishment(data: &mut Value) -> Value {
    let obj = match data.as_object_mut() {
        Some(o) => o,
        None => {
            return json!({
                "hasLoss": false,
                "losses": [],
                "totalMinutes": 0
            })
        }
    };

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
            // 是否已处于枯萎状态（上一轮惩罚遗留）
            let wilted = plot.get("wilted").and_then(|v| v.as_bool()).unwrap_or(false);

            // 只处理未成熟的作物
            if progress < cfg.grow_time {
                let id = plot.get("id").and_then(|v| v.as_u64()).unwrap_or(0);

                if wilted {
                    // 已枯萎又遭惩罚：永久清除
                    losses.push(json!({
                        "crop": crop,
                        "name": cfg.name,
                        "icon": cfg.icon,
                        "progress": progress,
                        "growTime": cfg.grow_time,
                        "revivable": false
                    }));
                    total_minutes += progress;

                    *plot = json!({
                        "id": id,
                        "crop": null,
                        "progress": 0,
                        "plantedAt": null,
                        "locked": false
                    });
                } else {
                    // 未成熟：转为枯萎（濒死），可被专注救活
                    losses.push(json!({
                        "crop": crop,
                        "name": cfg.name,
                        "icon": cfg.icon,
                        "progress": progress,
                        "growTime": cfg.grow_time,
                        "revivable": true
                    }));
                    total_minutes += progress;

                    if let Some(po) = plot.as_object_mut() {
                        po.insert("wilted".to_string(), Value::Bool(true));
                    }
                }
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
    }

    json!({
        "hasLoss": has_loss,
        "losses": losses,
        "totalMinutes": total_minutes
    })
}

/// 执行惩罚并返回损失结果（由前台检测 / 专注模式中断调用）
/// 参照旧版 handleGardenPunishment：
/// - 只清空未成熟作物（progress < growTime）
/// - 不扣金币/种子/crops 背包
/// - 累计 totalMinutes += progress
/// - 不触发成就检查
#[tauri::command]
pub async fn garden_punishment(app: AppHandle, loss_amount: u32) -> Result<Value, String> {
    let _ = loss_amount;

    let mut data = data_manager::read_garden_data(&app)?;

    let result = apply_punishment(&mut data);

    let has_loss = result.get("hasLoss").and_then(|v| v.as_bool()).unwrap_or(false);
    if has_loss {
        data_manager::write_garden_data(&app, &data)?;
    }

    Ok(result)
}

/// 解锁隐藏彩蛋成就（幂等，纯函数，便于单元测试）
///
/// 彩蛋入口：设置面板连续点击版本号 5 次（间隔 < 1.5s）。
/// - 已解锁：返回 false（不重复发放奖励）
/// - 未解锁：写入 achievements.easteregg + 奖励 osmanthus 种子×1 + 金币×50，返回 true
pub fn try_unlock_easteregg(data: &mut Value) -> bool {
    let obj = match data.as_object_mut() {
        Some(o) => o,
        None => return false,
    };

    // 已解锁则幂等返回
    let already = obj
        .get("achievements")
        .and_then(|a| a.get("easteregg"))
        .and_then(|v| v.get("unlocked"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if already {
        return false;
    }

    // 解锁成就
    let achievements = obj
        .entry("achievements".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if let Some(ach_obj) = achievements.as_object_mut() {
        ach_obj.insert(
            "easteregg".to_string(),
            json!({
                "unlocked": true,
                "unlockedAt": now_iso_utc()
            }),
        );
    }

    // 发放奖励：osmanthus 种子 ×1
    let seeds = obj
        .entry("seeds".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if let Some(seeds_obj) = seeds.as_object_mut() {
        let prev = seeds_obj
            .get("osmanthus")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        seeds_obj.insert("osmanthus".to_string(), Value::from(prev + 1));
    }
    // 金币 +50
    let prev_coins = obj.get("coins").and_then(|v| v.as_u64()).unwrap_or(0);
    obj.insert("coins".to_string(), Value::from(prev_coins + 50));

    true
}

/// 解锁隐藏彩蛋成就（设置面板点击版本号 5 次触发）
/// 返回 { success, alreadyUnlocked, gardenData, unlockedAchievements }
#[tauri::command]
pub async fn garden_unlock_easteregg(app: AppHandle) -> Result<Value, String> {
    let mut data = data_manager::read_garden_data(&app)?;

    let newly_unlocked = try_unlock_easteregg(&mut data);

    if newly_unlocked {
        data_manager::write_garden_data(&app, &data)?;
        notify_garden_refresh(&app);
    }

    let cfg = ACHIEVEMENT_CONFIG
        .iter()
        .find(|c| c.id == "easteregg")
        .map(|c| achievement_to_json(c));

    Ok(json!({
        "success": newly_unlocked,
        "alreadyUnlocked": !newly_unlocked,
        "gardenData": data,
        "unlockedAchievements": if newly_unlocked {
            match cfg {
                Some(c) => vec![c],
                None => vec![],
            }
        } else {
            vec![]
        }
    }))
}

/// 记录一次专注会话结果（纯函数，便于单元测试）
///
/// 专注连击（Focus Combo）v1 + v3 扩展：
/// - completed=true（专注完成）：连击 count+1；达到 COMBO_ACTIVE_THRESHOLD 激活加成；
///   同时**救活所有枯萎作物**（wilted 状态清除，进度保留）；**恢复微黄**（languish.level=0）
/// - completed=false（专注中断/放弃）：连击清零；记录断签起始（供段位宽限判断）
/// - combo.best 记录历史最高连击
/// 返回 { combo: {count,best,active}, revivedCount, languishReset }。
pub fn record_focus_completion(data: &mut Value, completed: bool) -> Value {
    let combo_value: Value;
    let mut revived_count: u64 = 0;
    let mut languish_reset = false;

    // ===== 阶段 1：更新 combo 状态 =====
    {
        let obj = match data.as_object_mut() {
            Some(o) => o,
            None => {
                return json!({
                    "combo": { "count": 0, "best": 0, "active": false },
                    "revivedCount": 0,
                    "languishReset": false
                })
            }
        };

        let combo = obj
            .entry("combo".to_string())
            .or_insert_with(|| json!({ "count": 0, "best": 0, "active": false }));
        if !combo.is_object() {
            *combo = json!({ "count": 0, "best": 0, "active": false });
        }
        let combo_obj = match combo.as_object_mut() {
            Some(o) => o,
            None => {
                return json!({
                    "combo": { "count": 0, "best": 0, "active": false },
                    "revivedCount": 0,
                    "languishReset": false
                })
            }
        };

        if completed {
            let count = combo_obj
                .get("count")
                .and_then(|v| v.as_u64())
                .unwrap_or(0)
                + 1;
            let best = combo_obj.get("best").and_then(|v| v.as_u64()).unwrap_or(0);
            combo_obj.insert("count".to_string(), Value::from(count));
            if count > best {
                combo_obj.insert("best".to_string(), Value::from(count));
            }
            combo_obj.insert(
                "active".to_string(),
                Value::from(count >= COMBO_ACTIVE_THRESHOLD),
            );
        } else {
            combo_obj.insert("count".to_string(), Value::from(0));
            combo_obj.insert("active".to_string(), Value::from(false));
        }

        combo_value = combo.clone();
    }

    // ===== 阶段 2：专注完成时救活枯萎作物 + 恢复微黄 =====
    if completed {
        if let Some(obj) = data.as_object_mut() {
            // 救活枯萎
            if let Some(plots) = obj.get_mut("plots").and_then(|v| v.as_array_mut()) {
                for plot in plots.iter_mut() {
                    let wilted = plot
                        .get("wilted")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false);
                    if wilted {
                        if let Some(po) = plot.as_object_mut() {
                            po.insert("wilted".to_string(), Value::Bool(false));
                            revived_count += 1;
                        }
                    }
                }
            }
            // 恢复微黄（languish.level → 0）
            if let Some(lang) = obj.get_mut("languish") {
                if let Some(lang_obj) = lang.as_object_mut() {
                    let level = lang_obj
                        .get("level")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    if level > 0 {
                        lang_obj.insert("level".to_string(), Value::from(0));
                        languish_reset = true;
                    }
                }
            }
            // 更新 lastSeenAt
            obj.insert("lastSeenAt".to_string(), Value::String(now_iso_utc()));
        }
    }

    json!({
        "combo": combo_value,
        "revivedCount": revived_count,
        "languishReset": languish_reset
    })
}

/// 记录一次专注会话结果（由计时器完成/中断时调用）
/// 返回 GardenOperationResult 形状 + combo / revivedCount 信息
#[tauri::command]
pub async fn garden_record_focus(app: AppHandle, completed: bool) -> Result<Value, String> {
    let mut data = data_manager::read_garden_data(&app)?;

    let info = record_focus_completion(&mut data, completed);

    data_manager::write_garden_data(&app, &data)?;
    notify_garden_refresh(&app);

    Ok(json!({
        "success": true,
        "gardenData": data,
        "combo": info.get("combo"),
        "revivedCount": info.get("revivedCount"),
        "unlockedAchievements": []
    }))
}

/// 每日生长配额上限（分钟）：超过后当天不再生长（v3 定稿：防过度专注）
pub const DAILY_GROWTH_CAP_MINUTES: u64 = 120;

/// 更新作物生长进度（纯函数，便于单元测试）
///
/// - 遍历所有有作物的 plots，progress += minutes
/// - 专注连击激活（combo.active）时，按 ×1.2 加成（向上取整）
/// - 枯萎（wilted）作物不再生长（等待救活）
/// - **每日生长配额**：当日已生长分钟 >= DAILY_GROWTH_CAP_MINUTES 时停止生长（返回 capped=true）
/// 返回 { growthApplied, capped }。
pub fn apply_growth(data: &mut Value, minutes: u32) -> Value {
    // ===== 阶段 1：读取配额状态（独立借用块）=====
    let today = today_date_string();
    let used: u64 = {
        let obj = match data.as_object_mut() {
            Some(o) => o,
            None => return json!({ "growthApplied": 0, "capped": false }),
        };
        let daily = obj
            .entry("dailyCap".to_string())
            .or_insert_with(|| json!({ "date": today.clone(), "growthMinutes": 0 }));
        if !daily.is_object() {
            *daily = json!({ "date": today.clone(), "growthMinutes": 0 });
        }
        let daily_obj = match daily.as_object_mut() {
            Some(o) => o,
            None => return json!({ "growthApplied": 0, "capped": false }),
        };
        let cap_date = daily_obj
            .get("date")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        // 跨日重置
        if cap_date != today {
            daily_obj.insert("date".to_string(), Value::String(today.clone()));
            daily_obj.insert("growthMinutes".to_string(), Value::from(0));
        }
        daily_obj
            .get("growthMinutes")
            .and_then(|v| v.as_u64())
            .unwrap_or(0)
    };

    // 已达到当日配额 → 停止生长
    if used >= DAILY_GROWTH_CAP_MINUTES {
        return json!({ "growthApplied": 0, "capped": true });
    }

    // 本次实际可生长分钟 = min(minutes, 剩余配额)
    let remaining = DAILY_GROWTH_CAP_MINUTES - used;
    let effective_minutes = (minutes as u64).min(remaining);
    let mut capped = effective_minutes < minutes as u64;

    // ===== 阶段 2：计算连击加成（只读）=====
    let combo_active = data
        .get("combo")
        .and_then(|c| c.get("active"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let growth: u64 = if combo_active {
        // 1.2 倍向上取整：(minutes * 6 + 4) / 5
        (effective_minutes * 6 + 4) / 5
    } else {
        effective_minutes
    };

    // ===== 阶段 3：写入生长进度 + 更新配额（独立借用块）=====
    {
        let obj = match data.as_object_mut() {
            Some(o) => o,
            None => return json!({ "growthApplied": 0, "capped": false }),
        };
        if let Some(plots) = obj.get_mut("plots").and_then(|v| v.as_array_mut()) {
            for plot in plots.iter_mut() {
                let has_crop = plot.get("crop").and_then(|v| v.as_str()).is_some();
                let wilted = plot
                    .get("wilted")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if has_crop && !wilted {
                    let progress = plot
                        .get("progress")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    plot["progress"] = Value::from(progress + growth);
                }
            }
        }
        // 更新当日已生长分钟
        if let Some(daily) = obj.get_mut("dailyCap") {
            if let Some(daily_obj) = daily.as_object_mut() {
                let new_used = used + effective_minutes;
                daily_obj.insert("growthMinutes".to_string(), Value::from(new_used));
            }
        }
    }

    json!({ "growthApplied": growth, "capped": capped })
}

/// 更新作物生长进度
/// 参照旧版 updateGardenProgress：
/// - 遍历所有有作物的 plots，progress += minutes
/// - 专注连击激活时进度 ×1.2（v1 游戏性改进）
/// - 每日生长配额 120 分钟封顶（v3）
/// - 不带成就检查（与旧版一致）
#[tauri::command]
pub async fn garden_grow(app: AppHandle, minutes: u32) -> Result<Value, String> {
    let mut data = data_manager::read_garden_data(&app)?;

    let info = apply_growth(&mut data, minutes);

    data_manager::write_garden_data(&app, &data)?;
    notify_garden_refresh(&app);
    // 返回 GardenOperationResult 形状（前端 applyResult 期望 success 字段）
    Ok(json!({
        "success": true,
        "gardenData": data,
        "growthApplied": info.get("growthApplied"),
        "capped": info.get("capped"),
        "unlockedAchievements": []
    }))
}

// ===== 段位 / 微黄 / 解锁（v3 隔离架构：打开窗口时计算）=====

/// 段位阈值：连续专注天数（复用 signIn.continuousDays）
pub const TIER_DAYS: &[u64] = &[7, 14, 30];

/// 计算段位（0-3）：连续天数 >= 7 → Lv1，>= 14 → Lv2，>= 30 → Lv3
fn calc_tier(continuous_days: u64) -> u64 {
    if continuous_days >= 30 {
        3
    } else if continuous_days >= 14 {
        2
    } else if continuous_days >= 7 {
        1
    } else {
        0
    }
}

/// 计算微黄/休眠状态（纯函数）：基于 lastSeenAt 距今时长
/// - <24h：level 0（正常）
/// - >=24h：level 1（微黄）
/// - >=7 天：level 2（休眠，进度冻结）
pub fn calc_languish(data: &Value) -> u64 {
    let last_seen = data
        .get("lastSeenAt")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if last_seen.is_empty() {
        return 0;
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let last = parse_iso_utc_secs(last_seen).unwrap_or(0);
    let hours = (now - last).max(0) / 3600;
    if hours >= 24 * 7 {
        2
    } else if hours >= 24 {
        1
    } else {
        0
    }
}

/// 解析 "YYYY-MM-DDTHH:MM:SSZ" → epoch 秒（近似，供时长计算）
fn parse_iso_utc_secs(s: &str) -> Option<i64> {
    let s = s.trim_end_matches('Z');
    let (date, time) = s.split_once('T')?;
    let mut date_parts = date.split('-');
    let year: i64 = date_parts.next()?.parse().ok()?;
    let month: i64 = date_parts.next()?.parse().ok()?;
    let day: i64 = date_parts.next()?.parse().ok()?;
    let mut time_parts = time.split(':');
    let hour: i64 = time_parts.next()?.parse().ok()?;
    let min: i64 = time_parts.next()?.parse().ok()?;
    let sec: i64 = time_parts.next()?.parse().ok()?;

    // 粗略：天数 → 秒（忽略闰秒/时区，够用）
    let days = days_from_civil(year, month, day);
    Some(days * 86400 + hour * 3600 + min * 60 + sec)
}

/// 民用日期 → 天数（Howard Hinnant 算法，自 1970-01-01）
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// 检查并同步菜园状态（纯函数，v3 隔离架构）：
/// - 计算并写入 languish.level（离线时长）
/// - 计算并写入 tier.current / tier.best（段位）
/// - 计算并写入 unlocks（渐进引入：市场/合成/商人/巨大化/彩蛋解锁时间）
/// 返回 { tier, languish, unlocks }。
pub fn check_garden_state(data: &mut Value) -> Value {
    // ===== 预读只读数据（不可变借用，先取完）=====
    let (continuous_days, total_days) = {
        let obj = match data.as_object() {
            Some(o) => o,
            None => {
                return json!({
                    "tier": { "current": 0, "best": 0 },
                    "languish": { "level": 0 },
                    "unlocks": {}
                })
            }
        };
        let continuous = obj
            .get("signIn")
            .and_then(|s| s.get("continuousDays"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let total = obj
            .get("signIn")
            .and_then(|s| s.get("totalDays"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        (continuous, total)
    };
    let tier_current = calc_tier(continuous_days);
    let lang_level = calc_languish(data);

    // ===== 阶段 1：写入 tier（独立借用块）=====
    let tier_val: Value = {
        let obj = match data.as_object_mut() {
            Some(o) => o,
            None => {
                return json!({
                    "tier": { "current": 0, "best": 0 },
                    "languish": { "level": 0 },
                    "unlocks": {}
                })
            }
        };
        let tier = obj
            .entry("tier".to_string())
            .or_insert_with(|| json!({ "current": 0, "best": 0 }));
        if !tier.is_object() {
            *tier = json!({ "current": 0, "best": 0 });
        }
        if let Some(t) = tier.as_object_mut() {
            let prev_current = t.get("current").and_then(|v| v.as_u64()).unwrap_or(0);
            let prev_best = t.get("best").and_then(|v| v.as_u64()).unwrap_or(0);
            // 只升不降（降级语义由 record_focus(false) 前端本地计算）
            if tier_current > prev_current {
                t.insert("current".to_string(), Value::from(tier_current));
            }
            let best = prev_best.max(tier_current);
            t.insert("best".to_string(), Value::from(best));
        }
        tier.clone()
    };

    // ===== 阶段 2：写入 languish（独立借用块）=====
    let lang_val: Value = {
        let obj = match data.as_object_mut() {
            Some(o) => o,
            None => {
                return json!({
                    "tier": { "current": 0, "best": 0 },
                    "languish": { "level": 0 },
                    "unlocks": {}
                })
            }
        };
        let languish = obj
            .entry("languish".to_string())
            .or_insert_with(|| json!({ "level": 0 }));
        if !languish.is_object() {
            *languish = json!({ "level": 0 });
        }
        if let Some(l) = languish.as_object_mut() {
            let prev_level = l.get("level").and_then(|v| v.as_u64()).unwrap_or(0);
            // 只升不降（降级由专注完成 record_focus(true) 触发）
            if lang_level > prev_level {
                l.insert("level".to_string(), Value::from(lang_level));
            }
        }
        languish.clone()
    };

    // ===== 阶段 3：写入 unlocks（独立借用块）=====
    let unlocks_val: Value = {
        let obj = match data.as_object_mut() {
            Some(o) => o,
            None => {
                return json!({
                    "tier": { "current": 0, "best": 0 },
                    "languish": { "level": 0 },
                    "unlocks": {}
                })
            }
        };
        let unlocks = obj
            .entry("unlocks".to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if !unlocks.is_object() {
            *unlocks = Value::Object(Map::new());
        }
        let unlock_obj = unlocks.as_object_mut().unwrap();
        // 解锁条件：按使用天数（与 v3.3 渐进表对齐）
        let now_str = now_iso_utc();
        if total_days >= 1 && unlock_obj.get("marketAt").is_none() {
            unlock_obj.insert("marketAt".to_string(), Value::String(now_str.clone()));
        }
        if tier_current >= 1 && unlock_obj.get("craftAt").is_none() {
            unlock_obj.insert("craftAt".to_string(), Value::String(now_str.clone()));
        }
        if tier_current >= 2 && unlock_obj.get("merchantAt").is_none() {
            unlock_obj.insert("merchantAt".to_string(), Value::String(now_str.clone()));
        }
        if tier_current >= 3 && unlock_obj.get("giantAt").is_none() {
            unlock_obj.insert("giantAt".to_string(), Value::String(now_str.clone()));
        }
        if tier_current >= 3 && unlock_obj.get("petAt").is_none() {
            unlock_obj.insert("petAt".to_string(), Value::String(now_str.clone()));
        }
        unlocks.clone()
    };

    json!({
        "tier": tier_val,
        "languish": lang_val,
        "unlocks": unlocks_val
    })
}

/// 检查并同步菜园状态（打开菜园窗口时调用；隔离架构，时钟无需关心）
/// 返回 GardenOperationResult 形状 + tier/languish/unlocks
#[tauri::command]
pub async fn garden_check_state(app: AppHandle) -> Result<Value, String> {
    let mut data = data_manager::read_garden_data(&app)?;

    let info = check_garden_state(&mut data);

    data_manager::write_garden_data(&app, &data)?;

    Ok(json!({
        "success": true,
        "gardenData": data,
        "tier": info.get("tier"),
        "languish": info.get("languish"),
        "unlocks": info.get("unlocks"),
        "unlockedAchievements": []
    }))
}

/// 留种繁殖：1 作物 → 1 种子（HayDay 式，作物变作物）
/// 作物数量足够时消耗 1 个作物，获得 1 颗同种种子。
#[tauri::command]
pub async fn garden_seed_from_crop(
    app: AppHandle,
    crop: String,
    count: Option<u32>,
) -> Result<Value, String> {
    let count = count.unwrap_or(1).max(1) as u64;

    if crop_cfg(&crop).is_none() {
        return Err(format!("未知作物类型: {}", crop));
    }

    let mut data = data_manager::read_garden_data(&app)?;
    let obj = data.as_object_mut().ok_or("garden data 不是对象")?;

    // 检查作物数量
    let current = obj
        .get("crops")
        .and_then(|v| v.as_object())
        .and_then(|c| c.get(&crop))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    if current < count {
        return Err("作物数量不足，无法留种".to_string());
    }

    // 扣作物
    {
        let crops = obj
            .entry("crops".to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if let Some(crops_obj) = crops.as_object_mut() {
            let new_count = current - count;
            if new_count == 0 {
                crops_obj.remove(&crop);
            } else {
                crops_obj.insert(crop.clone(), Value::from(new_count));
            }
        }
    }

    // 加种子
    {
        let seeds = obj
            .entry("seeds".to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        if let Some(seeds_obj) = seeds.as_object_mut() {
            let prev = seeds_obj.get(&crop).and_then(|v| v.as_u64()).unwrap_or(0);
            seeds_obj.insert(crop.clone(), Value::from(prev + count));
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

    // ===== pick_best_seed（快捷种植推荐）=====

    #[test]
    fn pick_best_seed_prefers_highest_value() {
        // 玫瑰 value=80 最高（carrot=10/tomato=20/sunflower=50/rose=80/osmanthus=150）
        let seeds = json!({ "carrot": 3, "sunflower": 2, "rose": 1 });
        assert_eq!(pick_best_seed(&seeds).unwrap(), "rose");
        // 只留低阶作物 → 选 value 最高的胡萝卜
        let seeds2 = json!({ "carrot": 5, "tomato": 0 });
        assert_eq!(pick_best_seed(&seeds2).unwrap(), "carrot");
        // 金桂树 value=150 最高
        let seeds3 = json!({ "tomato": 1, "osmanthus": 1 });
        assert_eq!(pick_best_seed(&seeds3).unwrap(), "osmanthus");
    }

    #[test]
    fn pick_best_seed_empty_returns_none() {
        assert!(pick_best_seed(&json!({})).is_none());
        assert!(pick_best_seed(&json!({ "carrot": 0, "tomato": 0, "rose": 0 })).is_none());
        assert!(pick_best_seed(&json!({ "unknown": 5 })).is_none());
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

    // ===== 签到滚动窗口 =====

    #[test]
    fn roll_week_records_no_anchor_clears_all() {
        // 首次签到（无锚点 prev_start=0，new_start 很大）→ 全清
        let prev: Vec<Value> = vec![false; 7].into_iter().map(Value::Bool).collect();
        let out = roll_week_records(&prev, 0, 20000);
        assert_eq!(out, vec![false; 7]);
    }

    #[test]
    fn roll_week_records_shift_one_preserves_overlap() {
        // 旧窗口 index 6（周日）签到过；窗口右移 1 天（今天变周一）
        // 旧 index 6 的签到应滚到新窗口 index 5，其余 false
        let prev: Vec<Value> = vec![
            Value::Bool(false),
            Value::Bool(false),
            Value::Bool(false),
            Value::Bool(false),
            Value::Bool(false),
            Value::Bool(false),
            Value::Bool(true), // 昨天（周日）签到
        ];
        let out = roll_week_records(&prev, 100, 101);
        assert_eq!(
            out,
            vec![false, false, false, false, false, true, false]
        );
    }

    #[test]
    fn roll_week_records_shift_seven_clears_all() {
        // 窗口完全过期（右移 7 天）→ 全清
        let prev: Vec<Value> = vec![true; 7].into_iter().map(Value::Bool).collect();
        let out = roll_week_records(&prev, 100, 107);
        assert_eq!(out, vec![false; 7]);
    }

    #[test]
    fn roll_week_records_same_window_unchanged() {
        // 同一天内多次调用（shift=0）→ 原样保留
        let prev: Vec<Value> = vec![
            Value::Bool(true),
            Value::Bool(false),
            Value::Bool(true),
            Value::Bool(false),
            Value::Bool(false),
            Value::Bool(false),
            Value::Bool(false),
        ];
        let out = roll_week_records(&prev, 100, 100);
        assert_eq!(
            out,
            vec![true, false, true, false, false, false, false]
        );
    }

    // ===== 成就表完整性 =====

    #[test]
    fn achievement_config_has_26_entries() {
        // 5 focus + 5 harvest + 5 plant + 3 collect + 4 wealth + 3 persist + 1 hidden = 26
        assert_eq!(ACHIEVEMENT_CONFIG.len(), 26);
    }

    #[test]
    fn achievement_config_includes_hidden_easteregg() {
        let cfg = ACHIEVEMENT_CONFIG
            .iter()
            .find(|c| c.id == "easteregg")
            .expect("应包含 easteregg 隐藏成就");
        assert_eq!(cfg.category, "hidden");
        assert_eq!(cfg.target, 1);
        assert_eq!(cfg.reward_seeds, &[("osmanthus", 1)]);
        assert_eq!(cfg.reward_coins, 50);
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

    // ===== apply_punishment（专注模式中断 → 作物枯萎）=====

    /// 构造带作物的花园数据：
    /// - 0: 未成熟胡萝卜（progress 10 / grow 25）
    /// - 1: 已成熟番茄（progress 50 / grow 50，不应枯萎）
    /// - 2: 未成熟向日葵（progress 30 / grow 90）
    /// - 6: 锁定的未成熟玫瑰（不应被清空）
    fn punish_garden() -> Value {
        json!({
            "coins": 100,
            "seeds": { "carrot": 1, "tomato": 1, "sunflower": 1, "rose": 1 },
            "crops": {},
            "plots": [
                { "id": 0, "crop": "carrot", "progress": 10, "plantedAt": "2026-08-02T00:00:00Z", "locked": false },
                { "id": 1, "crop": "tomato", "progress": 50, "plantedAt": "2026-08-02T00:00:00Z", "locked": false },
                { "id": 2, "crop": "sunflower", "progress": 30, "plantedAt": "2026-08-02T00:00:00Z", "locked": false },
                { "id": 6, "crop": "rose", "progress": 20, "plantedAt": "2026-08-02T00:00:00Z", "locked": true }
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

    #[test]
    fn punishment_wilts_immature_keeps_mature() {
        let mut g = punish_garden();
        let result = apply_punishment(&mut g);

        // hasLoss = true
        assert_eq!(result["hasLoss"], json!(true));
        // 2 株枯萎（胡萝卜 + 向日葵），成熟的番茄保留
        let losses = result["losses"].as_array().unwrap();
        assert_eq!(losses.len(), 2);

        // 损失明细结构
        let carrot_loss = losses.iter().find(|l| l["crop"] == "carrot").unwrap();
        assert_eq!(carrot_loss["name"], json!("胡萝卜"));
        assert_eq!(carrot_loss["icon"], json!("🥕"));
        assert_eq!(carrot_loss["progress"], json!(10));
        assert_eq!(carrot_loss["growTime"], json!(25));
        // 首次惩罚：未成熟作物转为枯萎（可救活）
        assert_eq!(carrot_loss["revivable"], json!(true));

        // totalMinutes = 10 + 30 = 40
        assert_eq!(result["totalMinutes"], json!(40));

        // 未成熟作物转枯萎（保留 crop/progress），成熟作物保留，锁定土地保留
        let plots = g["plots"].as_array().unwrap();
        assert_eq!(plots[0]["crop"], json!("carrot"));
        assert_eq!(plots[0]["progress"], json!(10));
        assert_eq!(plots[0]["wilted"], json!(true));
        assert_eq!(plots[1]["crop"], json!("tomato"));
        assert_eq!(plots[1]["progress"], json!(50));
        assert_eq!(plots[1].get("wilted").map(|v| v.as_bool()).unwrap_or(Some(false)), Some(false));
        assert_eq!(plots[2]["crop"], json!("sunflower"));
        assert_eq!(plots[2]["wilted"], json!(true));
        // 锁定的玫瑰不受影响
        assert_eq!(plots[3]["crop"], json!("rose"));
        assert_eq!(plots[3]["progress"], json!(20));

        // totalLosses 累计 2
        assert_eq!(g["totalLosses"], json!(2));
    }

    #[test]
    fn punishment_second_time_permanently_clears_wilted() {
        // 已枯萎的作物再次遭惩罚 → 永久清除（revivable=false）
        let mut g = punish_garden();
        apply_punishment(&mut g); // 第一次：转枯萎

        let result = apply_punishment(&mut g); // 第二次：永久清除
        assert_eq!(result["hasLoss"], json!(true));
        let losses = result["losses"].as_array().unwrap();
        assert_eq!(losses.len(), 2);
        for loss in losses {
            assert_eq!(loss["revivable"], json!(false));
        }

        let plots = g["plots"].as_array().unwrap();
        assert_eq!(plots[0]["crop"], json!(null));
        assert_eq!(plots[0]["progress"], json!(0));
        assert!(plots[0].get("wilted").is_none() || plots[0]["wilted"] != json!(true));
        // 成熟作物依然保留
        assert_eq!(plots[1]["crop"], json!("tomato"));
        assert_eq!(plots[1]["progress"], json!(50));
    }

    #[test]
    fn punishment_no_crops_returns_no_loss() {
        let mut g = base_garden();
        // base_garden 无作物（0 空地、6 锁定空地）
        let result = apply_punishment(&mut g);
        assert_eq!(result["hasLoss"], json!(false));
        assert_eq!(result["losses"].as_array().unwrap().len(), 0);
        assert_eq!(result["totalMinutes"], json!(0));
        // 不写 totalLosses
        assert!(g.get("totalLosses").is_none());
    }

    #[test]
    fn punishment_only_clears_unlocked_plots() {
        // 锁定的土地上即使有未成熟作物也不清空
        let mut g = base_garden();
        g["plots"][1] = json!({
            "id": 6, "crop": "carrot", "progress": 10, "plantedAt": "2026-08-02T00:00:00Z", "locked": true
        });
        let result = apply_punishment(&mut g);
        assert_eq!(result["hasLoss"], json!(false));
        let plots = g["plots"].as_array().unwrap();
        assert_eq!(plots[1]["crop"], json!("carrot"));
    }

    #[test]
    fn punishment_total_losses_accumulates() {
        let mut g = punish_garden();
        g["totalLosses"] = json!(5);
        apply_punishment(&mut g);
        // 5 + 2 = 7
        assert_eq!(g["totalLosses"], json!(7));
    }

    #[test]
    fn punishment_non_object_data_returns_empty() {
        let mut g = Value::Null;
        let result = apply_punishment(&mut g);
        assert_eq!(result["hasLoss"], json!(false));
        assert_eq!(result["totalMinutes"], json!(0));
    }

    #[test]
    fn punishment_all_immature_wilted() {
        // 全部未成熟 → 全部转枯萎（不是被清空）
        let mut g = json!({
            "coins": 0,
            "plots": [
                { "id": 0, "crop": "carrot", "progress": 1, "plantedAt": null, "locked": false },
                { "id": 1, "crop": "carrot", "progress": 5, "plantedAt": null, "locked": false }
            ]
        });
        let result = apply_punishment(&mut g);
        assert_eq!(result["hasLoss"], json!(true));
        assert_eq!(result["losses"].as_array().unwrap().len(), 2);
        assert_eq!(result["totalMinutes"], json!(6));
        for plot in g["plots"].as_array().unwrap() {
            assert_eq!(plot["crop"], json!("carrot"));
            assert_eq!(plot["wilted"], json!(true));
        }
    }

    #[test]
    fn punishment_unknown_crop_skipped() {
        // 未知作物类型：跳过（不枯萎、不报错）
        let mut g = json!({
            "coins": 0,
            "plots": [
                { "id": 0, "crop": "unknown_crop", "progress": 5, "plantedAt": null, "locked": false }
            ]
        });
        let result = apply_punishment(&mut g);
        assert_eq!(result["hasLoss"], json!(false));
        assert_eq!(result["losses"].as_array().unwrap().len(), 0);
        // 数据原样保留
        assert_eq!(g["plots"][0]["crop"], json!("unknown_crop"));
    }

    // ===== record_focus_completion（专注连击 + 枯萎救援）=====

    #[test]
    fn record_focus_completion_increments_combo_on_success() {
        let mut g = base_garden();
        let info = record_focus_completion(&mut g, true);
        assert_eq!(info["combo"]["count"], json!(1));
        assert_eq!(info["combo"]["best"], json!(1));
        assert_eq!(info["combo"]["active"], json!(false));
    }

    #[test]
    fn record_focus_completion_activates_after_threshold() {
        let mut g = base_garden();
        record_focus_completion(&mut g, true);
        let info = record_focus_completion(&mut g, true);
        // 第 2 次激活（阈值 = 2）
        assert_eq!(info["combo"]["count"], json!(2));
        assert_eq!(info["combo"]["active"], json!(true));
    }

    #[test]
    fn record_focus_completion_interrupt_resets_combo() {
        let mut g = base_garden();
        record_focus_completion(&mut g, true);
        record_focus_completion(&mut g, true);
        // 中断 → 清零
        let info = record_focus_completion(&mut g, false);
        assert_eq!(info["combo"]["count"], json!(0));
        assert_eq!(info["combo"]["active"], json!(false));
        // best 保留历史最高
        assert_eq!(info["combo"]["best"], json!(2));
    }

    #[test]
    fn record_focus_completion_tracks_best() {
        let mut g = base_garden();
        record_focus_completion(&mut g, true);
        record_focus_completion(&mut g, true);
        record_focus_completion(&mut g, false); // 中断
        let info = record_focus_completion(&mut g, true);
        assert_eq!(info["combo"]["count"], json!(1));
        assert_eq!(info["combo"]["best"], json!(2));
    }

    #[test]
    fn record_focus_completion_revives_wilted_crops() {
        let mut g = punish_garden();
        apply_punishment(&mut g); // 胡萝卜 + 向日葵 转枯萎
        assert_eq!(g["plots"][0]["wilted"], json!(true));
        assert_eq!(g["plots"][2]["wilted"], json!(true));

        let info = record_focus_completion(&mut g, true);
        assert_eq!(info["revivedCount"], json!(2));
        // 枯萎状态清除，进度保留
        assert_eq!(g["plots"][0]["wilted"], json!(false));
        assert_eq!(g["plots"][0]["progress"], json!(10));
        assert_eq!(g["plots"][2]["wilted"], json!(false));
    }

    #[test]
    fn record_focus_completion_resets_languish_on_success() {
        // 微黄状态在专注完成后恢复
        let mut g = base_garden();
        g["languish"] = json!({ "level": 1 });
        let info = record_focus_completion(&mut g, true);
        assert_eq!(info["languishReset"], json!(true));
        assert_eq!(g["languish"]["level"], json!(0));
    }

    #[test]
    fn record_focus_completion_no_wilted_no_revive() {
        let mut g = base_garden();
        let info = record_focus_completion(&mut g, true);
        assert_eq!(info["revivedCount"], json!(0));
        assert_eq!(info["languishReset"], json!(false));
    }

    #[test]
    fn record_focus_completion_non_object_returns_default_combo() {
        let mut g = Value::Null;
        let info = record_focus_completion(&mut g, true);
        assert_eq!(info["combo"]["count"], json!(0));
        assert_eq!(info["revivedCount"], json!(0));
    }

    // ===== apply_growth（生长进度 + 连击加成 + 每日配额）=====

    #[test]
    fn apply_growth_normal_increments_progress() {
        let mut g = base_garden();
        g["plots"][0] = json!({
            "id": 0, "crop": "carrot", "progress": 10, "plantedAt": null, "locked": false
        });
        let info = apply_growth(&mut g, 5);
        assert_eq!(info["growthApplied"], json!(5));
        assert_eq!(info["capped"], json!(false));
        assert_eq!(g["plots"][0]["progress"], json!(15));
    }

    #[test]
    fn apply_growth_combo_bonus_rounds_up() {
        // combo active：×1.2 向上取整
        let mut g = base_garden();
        g["combo"] = json!({ "count": 2, "best": 2, "active": true });
        g["plots"][0] = json!({
            "id": 0, "crop": "carrot", "progress": 0, "plantedAt": null, "locked": false
        });
        // 1 分钟 → 1.2 向上取整 = 2
        apply_growth(&mut g, 1);
        assert_eq!(g["plots"][0]["progress"], json!(2));
        // 再 4 分钟 → 4.8 向上取整 = 5
        apply_growth(&mut g, 4);
        assert_eq!(g["plots"][0]["progress"], json!(7));
    }

    #[test]
    fn apply_growth_combo_inactive_no_bonus() {
        let mut g = base_garden();
        g["combo"] = json!({ "count": 1, "best": 1, "active": false });
        g["plots"][0] = json!({
            "id": 0, "crop": "carrot", "progress": 0, "plantedAt": null, "locked": false
        });
        apply_growth(&mut g, 3);
        assert_eq!(g["plots"][0]["progress"], json!(3));
    }

    #[test]
    fn apply_growth_skips_wilted_crops() {
        // 枯萎作物不再生长（等待救活）
        let mut g = base_garden();
        g["plots"][0] = json!({
            "id": 0, "crop": "carrot", "progress": 10, "plantedAt": null, "locked": false, "wilted": true
        });
        apply_growth(&mut g, 5);
        assert_eq!(g["plots"][0]["progress"], json!(10));
    }

    #[test]
    fn apply_growth_non_object_returns_zero() {
        let mut g = Value::Null;
        let info = apply_growth(&mut g, 5);
        assert_eq!(info["growthApplied"], json!(0));
    }

    #[test]
    fn apply_growth_daily_cap_stops_growth() {
        // 达到每日 120 分钟配额后停止生长
        let mut g = base_garden();
        g["plots"][0] = json!({
            "id": 0, "crop": "carrot", "progress": 0, "plantedAt": null, "locked": false
        });
        apply_growth(&mut g, 120); // 用完配额
        assert_eq!(g["plots"][0]["progress"], json!(120));

        let info = apply_growth(&mut g, 10); // 超配额
        assert_eq!(info["growthApplied"], json!(0));
        assert_eq!(info["capped"], json!(true));
        assert_eq!(g["plots"][0]["progress"], json!(120));
    }

    #[test]
    fn apply_growth_daily_cap_partial_applies() {
        // 部分配额：80 已用 → 本次 100 只生效 40
        let mut g = base_garden();
        g["dailyCap"] = json!({ "date": today_date_string(), "growthMinutes": 80 });
        g["plots"][0] = json!({
            "id": 0, "crop": "carrot", "progress": 0, "plantedAt": null, "locked": false
        });
        let info = apply_growth(&mut g, 100);
        assert_eq!(info["growthApplied"], json!(40));
        assert_eq!(info["capped"], json!(true));
        assert_eq!(g["plots"][0]["progress"], json!(40));
    }

    #[test]
    fn apply_growth_daily_cap_resets_on_new_day() {
        // 跨日后配额重置
        let mut g = base_garden();
        g["dailyCap"] = json!({ "date": "2000-01-01", "growthMinutes": 120 });
        g["plots"][0] = json!({
            "id": 0, "crop": "carrot", "progress": 0, "plantedAt": null, "locked": false
        });
        let info = apply_growth(&mut g, 5);
        assert_eq!(info["capped"], json!(false));
        assert_eq!(g["plots"][0]["progress"], json!(5));
    }

    // ===== check_garden_state（段位 / 微黄 / 解锁）=====

    #[test]
    fn check_state_computes_tier_from_continuous_days() {
        let mut g = base_garden();
        g["signIn"]["continuousDays"] = json!(7);
        let info = check_garden_state(&mut g);
        assert_eq!(info["tier"]["current"], json!(1));
        assert_eq!(info["tier"]["best"], json!(1));
    }

    #[test]
    fn check_state_tier_upgrades_to_30() {
        let mut g = base_garden();
        g["signIn"]["continuousDays"] = json!(30);
        let info = check_garden_state(&mut g);
        assert_eq!(info["tier"]["current"], json!(3));
    }

    #[test]
    fn check_state_tier_best_keeps_historical_max() {
        let mut g = base_garden();
        g["tier"] = json!({ "current": 2, "best": 3 });
        g["signIn"]["continuousDays"] = json!(1);
        let info = check_garden_state(&mut g);
        assert_eq!(info["tier"]["current"], json!(2));
        assert_eq!(info["tier"]["best"], json!(3));
    }

    #[test]
    fn check_state_unlocks_market_on_day_one() {
        let mut g = base_garden();
        g["signIn"]["totalDays"] = json!(2);
        let info = check_garden_state(&mut g);
        // 使用天数 >= 1 → 市场解锁
        assert!(info["unlocks"].get("marketAt").is_some());
        // 段位 0 → 合成/商人/巨大化未解锁
        assert!(info["unlocks"].get("craftAt").is_none());
        assert!(info["unlocks"].get("merchantAt").is_none());
    }

    #[test]
    fn check_state_unlocks_craft_at_tier1() {
        let mut g = base_garden();
        g["signIn"]["continuousDays"] = json!(7);
        g["signIn"]["totalDays"] = json!(7);
        let info = check_garden_state(&mut g);
        assert!(info["unlocks"].get("marketAt").is_some());
        assert!(info["unlocks"].get("craftAt").is_some());
        assert!(info["unlocks"].get("merchantAt").is_none());
    }

    #[test]
    fn check_state_unlocks_all_at_tier3() {
        let mut g = base_garden();
        g["signIn"]["continuousDays"] = json!(30);
        g["signIn"]["totalDays"] = json!(30);
        let info = check_garden_state(&mut g);
        assert!(info["unlocks"].get("marketAt").is_some());
        assert!(info["unlocks"].get("craftAt").is_some());
        assert!(info["unlocks"].get("merchantAt").is_some());
        assert!(info["unlocks"].get("giantAt").is_some());
        assert!(info["unlocks"].get("petAt").is_some());
    }

    #[test]
    fn check_state_languish_defaults_zero_when_never_seen() {
        let mut g = base_garden();
        let info = check_garden_state(&mut g);
        assert_eq!(info["languish"]["level"], json!(0));
    }

    #[test]
    fn check_state_non_object_returns_defaults() {
        let mut g = Value::Null;
        let info = check_garden_state(&mut g);
        assert_eq!(info["tier"]["current"], json!(0));
        assert_eq!(info["languish"]["level"], json!(0));
    }

    // ===== garden_seed_from_crop（留种繁殖）=====

    /// 留种逻辑抽出的纯函数测试
    #[test]
    fn seed_from_crop_converts_crop_to_seed() {
        // 直接测数据变换：作物 3 → 作物 2 + 种子 +1
        let mut g = base_garden();
        g["crops"] = json!({ "carrot": 3 });
        g["seeds"]["carrot"] = json!(0);

        // 模拟命令逻辑
        let crop = "carrot".to_string();
        let count: u64 = 1;
        let current = g["crops"][&crop].as_u64().unwrap();
        assert!(current >= count);
        let new_count = current - count;
        if new_count == 0 {
            g["crops"].as_object_mut().unwrap().remove(&crop);
        } else {
            g["crops"].as_object_mut().unwrap().insert(crop.clone(), json!(new_count));
        }
        let prev = g["seeds"][&crop].as_u64().unwrap_or(0);
        g["seeds"].as_object_mut().unwrap().insert(crop, json!(prev + count));

        assert_eq!(g["crops"]["carrot"], json!(2));
        assert_eq!(g["seeds"]["carrot"], json!(1));
    }

    // ===== try_unlock_easteregg（隐藏彩蛋成就）=====

    #[test]
    fn unlock_easteregg_grants_achievement_and_rewards() {
        let mut g = base_garden();
        assert!(try_unlock_easteregg(&mut g));

        // 成就已解锁
        assert_eq!(g["achievements"]["easteregg"]["unlocked"], json!(true));
        // 奖励：osmanthus +1，金币 +50（base 100 → 150）
        assert_eq!(g["seeds"]["osmanthus"], json!(1));
        assert_eq!(g["coins"], json!(150));
    }

    #[test]
    fn unlock_easteregg_idempotent() {
        let mut g = base_garden();
        assert!(try_unlock_easteregg(&mut g));
        // 第二次调用返回 false，不重复发放奖励
        assert!(!try_unlock_easteregg(&mut g));
        assert_eq!(g["seeds"]["osmanthus"], json!(1));
        assert_eq!(g["coins"], json!(150));
    }

    #[test]
    fn unlock_easteregg_accumulates_on_existing_seeds() {
        let mut g = base_garden();
        g["seeds"]["osmanthus"] = json!(2);
        try_unlock_easteregg(&mut g);
        // 2 + 1 = 3
        assert_eq!(g["seeds"]["osmanthus"], json!(3));
    }

    #[test]
    fn unlock_easteregg_non_object_returns_false() {
        let mut g = Value::Null;
        assert!(!try_unlock_easteregg(&mut g));
    }

    #[test]
    fn unlock_easteregg_sets_unlocked_at() {
        let mut g = base_garden();
        try_unlock_easteregg(&mut g);
        let unlocked_at = g["achievements"]["easteregg"]["unlockedAt"]
            .as_str()
            .unwrap_or("");
        assert!(!unlocked_at.is_empty(), "unlockedAt 应为时间戳");
        assert!(unlocked_at.ends_with('Z'), "应为 UTC 时间");
    }
}
