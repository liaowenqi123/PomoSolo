/**
 * 菜园子 API
 *
 * 对接 src-tauri/src/commands/garden.rs 中注册的 Tauri 命令。
 *
 * 命令对照（前端 camelCase 参数 → Tauri 自动转 snake_case → Rust 接收）：
 * - garden_read()
 * - garden_write(data)
 * - garden_plant(plot_id, crop)
 * - garden_harvest(plot_id)
 * - garden_buy(item, price)
 * - garden_sell(item, price)
 * - garden_unlock(plot_id)
 * - garden_signin()
 * - garden_update_focus(minutes)  [Rust 端暂未实现]
 * - garden_punishment(loss_amount)
 * - garden_grow(minutes)
 *
 * 返回值说明：Rust 的 garden_plant/harvest/buy/sell/unlock 返回裸 garden data
 * （serde_json::Value），前端用 wrapResult 统一包装为 GardenOperationResult 形状，
 * 使 store 的 applyResult 能正确读取 result.gardenData。
 * garden_signin 已返回 { success, gardenData, unlockedAchievements } 形状，无需包装。
 */
import { invoke } from "@tauri-apps/api/core";
import { CROP_CONFIG } from "../stores/garden";

// ===== 类型定义 =====

/** 菜园子完整数据（持久化结构） */
export interface GardenData {
  [key: string]: unknown;
}

/** 菜园子操作结果（成就解锁信息） */
export interface GardenOperationResult {
  /** 是否成功 */
  success: boolean;
  /** 本次操作新解锁的成就列表 */
  unlockedAchievements?: Achievement[];
  /** 当前菜园子数据（部分操作返回） */
  gardenData?: GardenData;
  /** 错误信息（失败时） */
  error?: string;
}

/** 成就定义 */
export interface Achievement {
  id: string;
  name: string;
  description?: string;
  icon?: string;
}

/** 单株枯萎作物明细（与 Rust garden_punishment 返回的 loss 结构一致） */
export interface PunishmentLoss {
  /** 作物 key */
  crop: string;
  /** 作物中文名 */
  name: string;
  /** 作物 emoji 图标 */
  icon: string;
  /** 已生长分钟数 */
  progress: number;
  /** 该作物总生长分钟数 */
  growTime: number;
}

/** 惩罚结果（对应 Rust garden_punishment 返回值） */
export interface PunishmentResult {
  /** 是否发生损失 */
  hasLoss: boolean;
  /** 枯萎的作物明细列表 */
  losses: PunishmentLoss[];
  /** 总损失专注分钟数（= 各枯萎作物 progress 之和） */
  totalMinutes: number;
}

// ===== 返回值包装 =====

/**
 * 将 Rust 返回的裸 garden data 包装为 GardenOperationResult 形状。
 * Rust 的 garden_plant/harvest/buy/sell/unlock 返回裸 Value（garden data 对象），
 * 前端 store 的 applyResult 期望 { success, gardenData } 结构。
 * 若返回值已包含 success 字段（如 garden_signin），则直接透传。
 */
function wrapResult(raw: unknown): GardenOperationResult {
  if (raw && typeof raw === "object" && "success" in raw) {
    return raw as GardenOperationResult;
  }
  return { success: true, gardenData: raw as GardenData };
}

// ===== 读写 =====

/**
 * 读取菜园子数据。
 * 后端：`garden_read() -> Result<Value, String>`
 */
export function gardenRead(): Promise<GardenData> {
  return invoke<GardenData>("garden_read");
}

/**
 * 写入菜园子数据（用于成就等直接更新）。
 * 后端：`garden_write(data: Value) -> Result<(), String>`
 * 参数名 data（camelCase）→ Tauri 转 data → Rust data ✓
 */
export function gardenWrite(data: GardenData): Promise<boolean> {
  return invoke<unknown>("garden_write", { data }).then(() => true);
}

// ===== 种植 / 收获 =====

/**
 * 在指定土地上种植种子。
 * 后端：`garden_plant(plot_id: u32, crop: String) -> Result<Value, String>`
 * 参数映射：plotIndex → plotId（→ Tauri 转 plot_id → Rust plot_id ✓）
 *           seedId → crop（→ Tauri 转 crop → Rust crop ✓）
 */
export function gardenPlant(
  plotIndex: number,
  seedId: string,
): Promise<GardenOperationResult> {
  return invoke<unknown>("garden_plant", { plotId: plotIndex, crop: seedId }).then(wrapResult);
}

/**
 * 收获指定土地上的作物。
 * 后端：`garden_harvest(plot_id: u32) -> Result<Value, String>`
 * 参数映射：plotIndex → plotId（→ Tauri 转 plot_id → Rust plot_id ✓）
 */
export function gardenHarvest(
  plotIndex: number,
): Promise<GardenOperationResult> {
  return invoke<unknown>("garden_harvest", { plotId: plotIndex }).then(wrapResult);
}

// ===== 商店 =====

/**
 * 购买种子。
 * 后端：`garden_buy(item: String, price: u32, quantity: Option<u32>) -> Result<Value, String>`
 * 参数映射：seedId → item（→ Tauri 转 item → Rust item ✓）
 *           quantity → quantity（→ Tauri 转 quantity → Rust quantity ✓）
 * 注意：price 参数虽传递但后端忽略，统一从 CropCfg.seed_price 读取（防止前端篡改价格）。
 */
export function gardenBuySeed(
  seedId: string,
  quantity: number,
): Promise<GardenOperationResult> {
  const price = CROP_CONFIG[seedId]?.seedPrice ?? 0;
  return invoke<unknown>("garden_buy", { item: seedId, price, quantity }).then(wrapResult);
}

/**
 * 出售作物。
 * 后端：`garden_sell(item: String, price: u32, quantity: Option<u32>) -> Result<Value, String>`
 * 参数映射：cropId → item（→ Tauri 转 item → Rust item ✓）
 *           quantity → quantity（→ Tauri 转 quantity → Rust quantity ✓）
 * 注意：price 参数虽传递但后端忽略，统一从 CropCfg.sell_price 读取。
 */
export function gardenSellCrop(
  cropId: string,
  quantity: number,
): Promise<GardenOperationResult> {
  const price = CROP_CONFIG[cropId]?.sellPrice ?? 0;
  return invoke<unknown>("garden_sell", { item: cropId, price, quantity }).then(wrapResult);
}

/**
 * 一键出售所有作物。
 * 后端：`garden_sell_all() -> Result<Value, String>`
 * 返回 { success, gardenData, totalCoins, totalItems, unlockedAchievements }。
 */
export interface SellAllResult extends GardenOperationResult {
  totalCoins?: number;
  totalItems?: number;
}
export function gardenSellAll(): Promise<SellAllResult> {
  return invoke<SellAllResult>("garden_sell_all");
}

// ===== 土地 =====

/**
 * 解锁新的土地格子。
 * 后端：`garden_unlock(plot_id: u32) -> Result<Value, String>`
 * 参数映射：plotIndex → plotId（→ Tauri 转 plot_id → Rust plot_id ✓）
 */
export function gardenUnlockPlot(
  plotIndex: number,
): Promise<GardenOperationResult> {
  return invoke<unknown>("garden_unlock", { plotId: plotIndex }).then(wrapResult);
}

// ===== 签到 / 成就 =====

/**
 * 每日签到。
 * 后端：`garden_signin() -> Result<Value, String>`
 * Rust 已返回 { success, gardenData, unlockedAchievements } 形状，无需 wrapResult。
 */
export function gardenSignin(): Promise<GardenOperationResult> {
  return invoke<GardenOperationResult>("garden_signin");
}

/**
 * 累加专注时间，触发对应成就。
 * 后端：`garden_update_focus(minutes: u32)` — Rust 端暂未实现/注册，调用会失败。
 */
export function gardenUpdateFocus(
  minutes: number,
): Promise<GardenOperationResult> {
  return invoke<GardenOperationResult>("garden_update_focus", { minutes });
}

/**
 * 执行惩罚并返回损失结果（由前台检测调用）。
 * 后端：`garden_punishment(loss_amount: u32)` — Rust 端暂未实现/注册，调用会失败。
 *
 * @param lossAmount 预计损失的专注分钟数
 */
export function gardenPunishment(
  lossAmount: number,
): Promise<PunishmentResult> {
  return invoke<PunishmentResult>("garden_punishment", { lossAmount });
}

/**
 * 作物成长（计时器 tick 时调用，让所有种植中的作物 progress += minutes）。
 * 后端：`garden_grow(minutes: u32) -> Result<Value, String>`
 * 返回更新后的 garden data（裸 Value，需 wrapResult 包装）。
 * v3 隔离架构：前端只在专注进行中调用，告诉菜园子"涨了几分钟"。
 */
export function gardenGrow(minutes: number): Promise<GardenOperationResult> {
  return invoke<unknown>("garden_grow", { minutes }).then(wrapResult);
}

/**
 * 记录专注会话结果（v3 隔离架构核心信号）。
 * 后端：`garden_record_focus(completed: bool)`
 * - completed=true：专注完成 → 连击+1、救活枯萎、恢复微黄
 * - completed=false：专注断了（关闭/手动/违规，统一一个信号）→ 连击清零
 */
export function gardenRecordFocus(
  completed: boolean,
): Promise<GardenOperationResult & { revivedCount?: number }> {
  return invoke<GardenOperationResult & { revivedCount?: number }>(
    "garden_record_focus",
    { completed },
  );
}

/**
 * 检查并同步菜园状态（打开菜园窗口时调用）。
 * 后端：`garden_check_state()`
 * 计算段位 tier / 微黄 languish / 渐进解锁 unlocks，并持久化。
 */
export interface GardenCheckStateResult extends GardenOperationResult {
  tier?: { current: number; best: number };
  languish?: { level: number };
  unlocks?: Record<string, string>;
}
export function gardenCheckState(): Promise<GardenCheckStateResult> {
  return invoke<GardenCheckStateResult>("garden_check_state");
}

/**
 * 留种繁殖：1 作物 → 1 种子（HayDay 式，作物变作物）。
 * 后端：`garden_seed_from_crop(crop, count)`
 */
export function gardenSeedFromCrop(
  crop: string,
  count?: number,
): Promise<GardenOperationResult> {
  return invoke<unknown>("garden_seed_from_crop", { crop, count }).then(wrapResult);
}

/**
 * 解锁隐藏彩蛋成就（设置面板连续点击版本号 5 次触发）。
 * 后端：`garden_unlock_easteregg() -> { success, alreadyUnlocked, gardenData, unlockedAchievements }`
 * 幂等：已解锁时 success=false 且 alreadyUnlocked=true，不重复发放奖励。
 */
export function gardenUnlockEasteregg(): Promise<
  GardenOperationResult & { alreadyUnlocked?: boolean }
> {
  return invoke<GardenOperationResult & { alreadyUnlocked?: boolean }>(
    "garden_unlock_easteregg",
  );
}
