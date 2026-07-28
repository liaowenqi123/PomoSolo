/**
 * 菜园子 API
 *
 * 对应 Electron 旧版 dataManager + ipc-garden.js。
 *
 * 命令命名（Rust 端 snake_case）：
 * - garden_read / garden_write
 * - garden_plant(plot_index, seed_id)
 * - garden_harvest(plot_index)
 * - garden_buy_seed(seed_id, quantity)
 * - garden_sell_crop(crop_id, quantity)
 * - garden_unlock_plot(plot_index)
 * - garden_signin
 * - garden_update_focus(minutes)
 * - garden_punishment(loss_amount)
 *
 * 注意：当前 src-tauri/src/lib.rs 暂未注册这些命令，调用会失败。
 * 等后端 commands 注册后即可直接使用。
 */
import { invoke } from "@tauri-apps/api/core";

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

// ===== 读写 =====

/**
 * 读取菜园子数据。
 * 后端：`garden_read() -> Result<GardenData, String>`
 */
export function gardenRead(): Promise<GardenData> {
  return invoke<GardenData>("garden_read");
}

/**
 * 写入菜园子数据（用于成就等直接更新）。
 * 后端：`garden_write(garden_data: Value) -> Result<bool, String>`
 */
export function gardenWrite(data: GardenData): Promise<boolean> {
  return invoke<boolean>("garden_write", { gardenData: data });
}

// ===== 种植 / 收获 =====

/**
 * 在指定土地上种植种子。
 * 后端：`garden_plant(plot_index: usize, seed_id: String) -> Result<GardenOperationResult, String>`
 */
export function gardenPlant(
  plotIndex: number,
  seedId: string,
): Promise<GardenOperationResult> {
  return invoke<GardenOperationResult>("garden_plant", { plotIndex, seedId });
}

/**
 * 收获指定土地上的作物。
 * 后端：`garden_harvest(plot_index: usize) -> Result<GardenOperationResult, String>`
 */
export function gardenHarvest(
  plotIndex: number,
): Promise<GardenOperationResult> {
  return invoke<GardenOperationResult>("garden_harvest", { plotIndex });
}

// ===== 商店 =====

/**
 * 购买指定数量的种子。
 * 后端：`garden_buy_seed(seed_id: String, quantity: u32) -> Result<GardenOperationResult, String>`
 */
export function gardenBuySeed(
  seedId: string,
  quantity: number,
): Promise<GardenOperationResult> {
  return invoke<GardenOperationResult>("garden_buy_seed", {
    seedId,
    quantity,
  });
}

/**
 * 出售指定数量的作物。
 * 后端：`garden_sell_crop(crop_id: String, quantity: u32) -> Result<GardenOperationResult, String>`
 */
export function gardenSellCrop(
  cropId: string,
  quantity: number,
): Promise<GardenOperationResult> {
  return invoke<GardenOperationResult>("garden_sell_crop", {
    cropId,
    quantity,
  });
}

// ===== 土地 =====

/**
 * 解锁新的土地格子。
 * 后端：`garden_unlock_plot(plot_index: usize) -> Result<GardenOperationResult, String>`
 */
export function gardenUnlockPlot(
  plotIndex: number,
): Promise<GardenOperationResult> {
  return invoke<GardenOperationResult>("garden_unlock_plot", { plotIndex });
}

// ===== 签到 / 成就 =====

/**
 * 每日签到。
 * 后端：`garden_signin() -> Result<GardenOperationResult, String>`
 */
export function gardenSignin(): Promise<GardenOperationResult> {
  return invoke<GardenOperationResult>("garden_signin");
}

/**
 * 累加专注时间，触发对应成就。
 * 后端：`garden_update_focus(minutes: u32) -> Result<GardenOperationResult, String>`
 */
export function gardenUpdateFocus(
  minutes: number,
): Promise<GardenOperationResult> {
  return invoke<GardenOperationResult>("garden_update_focus", { minutes });
}

/**
 * 执行惩罚并返回损失结果（由前台检测调用）。
 * 后端：`garden_punishment(loss_amount: u32) -> Result<PunishmentResult, String>`
 *
 * @param lossAmount 预计损失的专注分钟数
 */
export function gardenPunishment(
  lossAmount: number,
): Promise<PunishmentResult> {
  return invoke<PunishmentResult>("garden_punishment", { lossAmount });
}
