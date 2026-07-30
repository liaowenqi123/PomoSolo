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
 * - garden_punishment(loss_amount) [Rust 端暂未实现]
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

/** 惩罚结果 */
export interface PunishmentResult {
  /** 是否发生损失 */
  hasLoss: boolean;
  /** 各项损失明细 */
  losses: Array<{
    /** 损失类型描述 */
    type: string;
    /** 损失数量 */
    amount: number;
  }>;
  /** 总损失分钟数 */
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
 * 后端：`garden_buy(item: String, price: u32) -> Result<Value, String>`
 * 参数映射：seedId → item（→ Tauri 转 item → Rust item ✓）
 *           price 从 CROP_CONFIG[seedId].seedPrice 查询（→ Rust price ✓）
 * 注意：Rust garden_buy 每次只购买 1 个，quantity 暂未传递给后端。
 */
export function gardenBuySeed(
  seedId: string,
  quantity: number,
): Promise<GardenOperationResult> {
  const price = CROP_CONFIG[seedId]?.seedPrice ?? 0;
  return invoke<unknown>("garden_buy", { item: seedId, price }).then(wrapResult);
}

/**
 * 出售作物。
 * 后端：`garden_sell(item: String, price: u32) -> Result<Value, String>`
 * 参数映射：cropId → item（→ Tauri 转 item → Rust item ✓）
 *           price 从 CROP_CONFIG[cropId].sellPrice 查询（→ Rust price ✓）
 * 注意：Rust garden_sell 每次只出售 1 个，quantity 暂未传递给后端。
 */
export function gardenSellCrop(
  cropId: string,
  quantity: number,
): Promise<GardenOperationResult> {
  const price = CROP_CONFIG[cropId]?.sellPrice ?? 0;
  return invoke<unknown>("garden_sell", { item: cropId, price }).then(wrapResult);
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
