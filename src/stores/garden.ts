/**
 * 菜园子 Store
 *
 * 参考 electron/src/scripts/modules/garden.js 与 utils.js 中的数据结构，
 * 通过 src/api/garden.ts 调用后端原子操作。
 *
 * 同时导出作物 / 成就 / 签到 / 土地解锁等静态配置，供 garden 子组件使用。
 */
import { defineStore, acceptHMRUpdate } from "pinia";
import { ref, computed } from "vue";
import {
  gardenRead,
  gardenPlant,
  gardenPlantQuick,
  gardenHarvest,
  gardenHarvestAll,
  gardenBuySeed,
  gardenSellCrop,
  gardenSellAll,
  gardenUnlockPlot,
  gardenSignin,
  gardenUpdateFocus,
  gardenPunishment,
  gardenGrow,
  gardenRecordFocus,
  gardenCheckState,
  gardenSeedFromCrop,
  type GardenData,
  type GardenOperationResult,
  type PunishmentResult,
} from "../api/garden";

// ===== 静态配置（参考 electron utils.js）=====

/** 作物稀有度 */
export type Rarity = "common" | "rare" | "legend";

/** 作物配置 */
export interface CropConfig {
  name: string;
  growTime: number;
  icon: string;
  seedType: string;
  rarity: Rarity;
  value: number;
  seedPrice: number;
  sellPrice: number;
}

/** 作物配置表 */
export const CROP_CONFIG: Record<string, CropConfig> = {
  carrot: { name: "胡萝卜", growTime: 25, icon: "🥕", seedType: "carrot", rarity: "common", value: 10, seedPrice: 8, sellPrice: 10 },
  tomato: { name: "番茄", growTime: 50, icon: "🍅", seedType: "tomato", rarity: "common", value: 20, seedPrice: 16, sellPrice: 20 },
  sunflower: { name: "向日葵", growTime: 90, icon: "🌻", seedType: "sunflower", rarity: "rare", value: 50, seedPrice: 40, sellPrice: 50 },
  rose: { name: "玫瑰", growTime: 120, icon: "🌹", seedType: "rose", rarity: "rare", value: 80, seedPrice: 64, sellPrice: 80 },
  osmanthus: { name: "金桂树", growTime: 180, icon: "🌳", seedType: "osmanthus", rarity: "legend", value: 150, seedPrice: 120, sellPrice: 150 },
};

/** 作物顺序（用于遍历展示） */
export const CROP_ORDER: string[] = ["carrot", "tomato", "sunflower", "rose", "osmanthus"];

/** 奖励 */
export interface Reward {
  seeds: Record<string, number>;
  coins: number;
  randomSeed?: boolean;
  message?: string;
}

/** 成就配置 */
export interface AchievementConfig {
  id: string;
  category: string;
  name: string;
  description: string;
  target: number;
  icon: string;
  rewards: Reward;
}

/** 成就配置表 */
export const ACHIEVEMENT_CONFIG: Record<string, AchievementConfig> = {
  focus1h: { id: "focus1h", category: "focus", name: "初心者", description: "累计专注 1 小时", target: 60, icon: "⏱️", rewards: { seeds: { carrot: 3 }, coins: 10 } },
  focus5h: { id: "focus5h", category: "focus", name: "专注新手", description: "累计专注 5 小时", target: 300, icon: "⏱️", rewards: { seeds: { tomato: 2 }, coins: 20 } },
  focus25h: { id: "focus25h", category: "focus", name: "专注达人", description: "累计专注 25 小时", target: 1500, icon: "🎯", rewards: { seeds: { sunflower: 1 }, coins: 50 } },
  focus50h: { id: "focus50h", category: "focus", name: "专注大师", description: "累计专注 50 小时", target: 3000, icon: "🏆", rewards: { seeds: { rose: 1 }, coins: 100 } },
  focus100h: { id: "focus100h", category: "focus", name: "专注传奇", description: "累计专注 100 小时", target: 6000, icon: "👑", rewards: { seeds: { osmanthus: 1 }, coins: 200 } },
  harvest1: { id: "harvest1", category: "harvest", name: "初次丰收", description: "收获 1 个作物", target: 1, icon: "🌾", rewards: { seeds: {}, coins: 5 } },
  harvest10: { id: "harvest10", category: "harvest", name: "小有收成", description: "收获 10 个作物", target: 10, icon: "🌾", rewards: { seeds: { carrot: 2 }, coins: 15 } },
  harvest50: { id: "harvest50", category: "harvest", name: "丰收达人", description: "收获 50 个作物", target: 50, icon: "🌻", rewards: { seeds: { tomato: 2 }, coins: 30 } },
  harvest100: { id: "harvest100", category: "harvest", name: "丰收大师", description: "收获 100 个作物", target: 100, icon: "🏆", rewards: { seeds: { sunflower: 2 }, coins: 60 } },
  harvest500: { id: "harvest500", category: "harvest", name: "丰收传奇", description: "收获 500 个作物", target: 500, icon: "👑", rewards: { seeds: { osmanthus: 2 }, coins: 200 } },
  plant1: { id: "plant1", category: "plant", name: "新手农夫", description: "种植 1 次", target: 1, icon: "🌱", rewards: { seeds: { carrot: 1 }, coins: 0 } },
  plant10: { id: "plant10", category: "plant", name: "勤劳农夫", description: "种植 10 次", target: 10, icon: "🌱", rewards: { seeds: {}, coins: 10 } },
  plant50: { id: "plant50", category: "plant", name: "种植达人", description: "种植 50 次", target: 50, icon: "🌿", rewards: { seeds: { tomato: 2 }, coins: 20 } },
  plant100: { id: "plant100", category: "plant", name: "种植大师", description: "种植 100 次", target: 100, icon: "🏆", rewards: { seeds: { sunflower: 1 }, coins: 50 } },
  plant500: { id: "plant500", category: "plant", name: "种植传奇", description: "种植 500 次", target: 500, icon: "👑", rewards: { seeds: { rose: 1 }, coins: 100 } },
  collect1: { id: "collect1", category: "collect", name: "初次收藏", description: "收获任意 1 种作物", target: 1, icon: "📦", rewards: { seeds: {}, coins: 5 } },
  collect3: { id: "collect3", category: "collect", name: "多样收藏", description: "收获 3 种不同作物", target: 3, icon: "🎁", rewards: { seeds: {}, coins: 30 } },
  collect5: { id: "collect5", category: "collect", name: "全集收藏", description: "收获全部 5 种作物", target: 5, icon: "👑", rewards: { seeds: { osmanthus: 1 }, coins: 100 } },
  coins100: { id: "coins100", category: "wealth", name: "小富翁", description: "累计获得 100 金币", target: 100, icon: "💰", rewards: { seeds: { carrot: 3 }, coins: 0 } },
  coins500: { id: "coins500", category: "wealth", name: "中富翁", description: "累计获得 500 金币", target: 500, icon: "💰", rewards: { seeds: { tomato: 2 }, coins: 0 } },
  coins1000: { id: "coins1000", category: "wealth", name: "大富翁", description: "累计获得 1000 金币", target: 1000, icon: "💎", rewards: { seeds: { rose: 1 }, coins: 0 } },
  coins5000: { id: "coins5000", category: "wealth", name: "富豪", description: "累计获得 5000 金币", target: 5000, icon: "👑", rewards: { seeds: { osmanthus: 2 }, coins: 0 } },
  signin7: { id: "signin7", category: "persist", name: "坚持一周", description: "连续签到 7 天", target: 7, icon: "📅", rewards: { seeds: { sunflower: 1 }, coins: 0 } },
  signin30: { id: "signin30", category: "persist", name: "坚持一月", description: "连续签到 30 天", target: 30, icon: "📅", rewards: { seeds: { rose: 1 }, coins: 0 } },
  signin100: { id: "signin100", category: "persist", name: "坚持百日", description: "连续签到 100 天", target: 100, icon: "👑", rewards: { seeds: { osmanthus: 2 }, coins: 0 } },
  easteregg: { id: "easteregg", category: "hidden", name: "发现彩蛋", description: "？？？", target: 1, icon: "🥚", rewards: { seeds: { osmanthus: 1 }, coins: 50 } },
};

/** 成就分类 */
export const ACHIEVEMENT_CATEGORIES: { key: string; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "focus", label: "专注" },
  { key: "harvest", label: "收获" },
  { key: "plant", label: "种植" },
  { key: "collect", label: "收藏" },
  { key: "wealth", label: "财富" },
  { key: "persist", label: "坚持" },
  { key: "hidden", label: "隐藏" },
];

/** 土地解锁配置 */
export interface PlotUnlockConfig {
  type: "default" | "coins" | "achievement";
  price?: number;
  achievementId?: string;
  description?: string;
}

export const PLOT_UNLOCK_CONFIG: Record<number, PlotUnlockConfig> = {
  0: { type: "default" },
  1: { type: "default" },
  2: { type: "default" },
  3: { type: "default" },
  4: { type: "default" },
  5: { type: "default" },
  6: { type: "coins", price: 100 },
  7: { type: "coins", price: 150 },
  8: { type: "achievement", achievementId: "signin100", description: "连续签到100天" },
  9: { type: "achievement", achievementId: "coins5000", description: "累计获得5000金币" },
  10: { type: "coins", price: 500 },
  11: { type: "coins", price: 800 },
};

/** 每日签到基础奖励 */
export const DAILY_REWARD: Reward = {
  seeds: { carrot: 1 },
  coins: 5,
};

/** 连续签到奖励 */
export const CONTINUOUS_REWARDS: Record<number, Reward> = {
  3: { seeds: { tomato: 1 }, coins: 0, message: "连续签到3天！" },
  7: { seeds: { sunflower: 1 }, coins: 0, message: "连续签到7天！" },
  14: { seeds: { rose: 1 }, coins: 0, message: "连续签到14天！" },
  30: { seeds: { osmanthus: 1 }, coins: 0, message: "连续签到30天！" },
};

/** 每周循环奖励（0=周日, 1=周一...） */
export const WEEKLY_REWARDS: Record<number, Reward> = {
  1: { seeds: { carrot: 2 }, coins: 0, message: "周一奖励" },
  2: { seeds: {}, coins: 10, message: "周二奖励" },
  3: { seeds: { tomato: 1 }, coins: 0, message: "周三奖励" },
  4: { seeds: {}, coins: 10, message: "周四奖励" },
  5: { seeds: { sunflower: 1 }, coins: 0, message: "周五奖励" },
  6: { seeds: {}, coins: 0, randomSeed: true, message: "周六随机奖励" },
  0: { seeds: {}, coins: 20, message: "周日奖励" },
};

// ===== 数据类型 =====

/** 种子背包：{ 种子ID: 数量 } */
export type SeedBag = Record<string, number>;

/** 作物背包：{ 作物ID: 数量 } */
export type CropBag = Record<string, number>;

/** 单块土地 */
export interface Plot {
  id: number;
  crop: string | null;
  progress: number;
  plantedAt: string | null;
  locked?: boolean;
  /** 枯萎状态（v1 违规惩罚，专注完成可救活） */
  wilted?: boolean;
  /** 闪光变异（v3 彩蛋） */
  mutated?: boolean;
}

/** 签到状态 */
export interface SignInState {
  lastDate: string | null;
  continuousDays: number;
  totalDays: number;
  weekRecords: boolean[];
}

/** 成就解锁记录 */
export type AchievementMap = Record<
  string,
  { unlocked: boolean; unlockedAt: string } | undefined
>;

/** 成就统计 */
export interface AchievementStats {
  totalFocusMinutes: number;
  totalHarvestCount: number;
  totalPlantCount: number;
  totalCoinsEarned: number;
  cropTypesCollected: string[];
}

/** 菜园子完整数据（结构化视图） */
export interface GardenState {
  coins: number;
  seeds: SeedBag;
  crops: CropBag;
  plots: Plot[];
  warehouse: unknown[];
  signIn: SignInState;
  achievements: AchievementMap;
  achievementStats: AchievementStats;
  combo?: ComboState;
  languish?: LanguishState;
  tier?: TierState;
  dailyCap?: DailyCap;
  unlocks?: Record<string, string>;
}

/** 专注连击状态（v3） */
export interface ComboState {
  count: number;
  best: number;
  active: boolean;
}

/** 微黄/休眠状态（v3） */
export interface LanguishState {
  level: 0 | 1 | 2;
}

/** 段位状态（v3） */
export interface TierState {
  current: number;
  best: number;
}

/** 每日生长配额（v3） */
export interface DailyCap {
  date: string;
  growthMinutes: number;
}

/** 默认菜园子数据（参考 utils.js createDefaultData().garden） */
export const DEFAULT_GARDEN: GardenState = {
  coins: 0,
  seeds: { carrot: 5, tomato: 2, sunflower: 0, rose: 0, osmanthus: 0 },
  crops: {},
  plots: Array.from({ length: 12 }, (_, i) => ({
    id: i,
    crop: null,
    progress: 0,
    plantedAt: null,
    locked: i >= 6,
  })),
  warehouse: [],
  signIn: {
    lastDate: null,
    continuousDays: 0,
    totalDays: 0,
    weekRecords: [false, false, false, false, false, false, false],
  },
  achievements: {},
  achievementStats: {
    totalFocusMinutes: 0,
    totalHarvestCount: 0,
    totalPlantCount: 0,
    totalCoinsEarned: 0,
    cropTypesCollected: [],
  },
  combo: { count: 0, best: 0, active: false },
  languish: { level: 0 },
  tier: { current: 0, best: 0 },
  dailyCap: { date: "", growthMinutes: 0 },
  unlocks: {},
};

/**
 * 将后端返回的单块土地数据收敛为前端 Plot 结构。
 *
 * Rust 端写入 `state` 字段（"locked"/"empty"/"growing"/"ready"），
 * 前端期望 `locked`/`progress`/`plantedAt` 字段。
 * 此函数做字段映射，保证两种来源的数据都能正确转换为 Plot。
 */
function normalizePlot(raw: unknown, index: number): Plot {
  const p = (raw ?? {}) as Record<string, unknown>;
  const state = typeof p.state === "string" ? p.state : undefined;

  // 无 state 字段：说明是前端格式（已有 locked/progress/plantedAt），直接取值
  if (state === undefined) {
    return {
      id: typeof p.id === "number" ? p.id : index,
      crop: (p.crop as string | null) ?? null,
      progress: typeof p.progress === "number" ? p.progress : 0,
      plantedAt: (p.plantedAt as string | null) ?? null,
      locked: typeof p.locked === "boolean" ? p.locked : index >= 6,
    };
  }

  // 有 state 字段：从 Rust 格式映射
  const crop = (p.crop as string | null) ?? null;
  const progress = typeof p.progress === "number" ? p.progress : 0;
  const plantedAt =
    (p.plantedAt as string | null) ?? (p.planted_at as string | null) ?? null;

  switch (state) {
    case "locked":
      return { id: index, crop: null, progress: 0, plantedAt: null, locked: true };
    case "empty":
      return { id: index, crop: null, progress: 0, plantedAt: null, locked: false };
    case "growing":
      return { id: index, crop, progress, plantedAt, locked: false };
    case "ready":
      return { id: index, crop, progress: 100, plantedAt, locked: false };
    default:
      return { id: index, crop: null, progress: 0, plantedAt: null, locked: index >= 6 };
  }
}

/** 将后端返回的 GardenData 收敛为结构化 GardenState */
function toGardenState(raw: GardenData): GardenState {
  const g = raw as Partial<GardenState> & Record<string, unknown>;
  return {
    coins: typeof g.coins === "number" ? g.coins : DEFAULT_GARDEN.coins,
    seeds:
      g.seeds && typeof g.seeds === "object"
        ? (g.seeds as SeedBag)
        : { ...DEFAULT_GARDEN.seeds },
    crops:
      g.crops && typeof g.crops === "object"
        ? (g.crops as CropBag)
        : { ...DEFAULT_GARDEN.crops },
    plots: Array.isArray(g.plots)
      ? (g.plots as unknown[]).map((p, i) => normalizePlot(p, i))
      : DEFAULT_GARDEN.plots.map((p) => ({ ...p })),
    warehouse: Array.isArray(g.warehouse) ? g.warehouse : [],
    signIn:
      g.signIn && typeof g.signIn === "object"
        ? (g.signIn as SignInState)
        : { ...DEFAULT_GARDEN.signIn },
    achievements:
      g.achievements && typeof g.achievements === "object"
        ? (g.achievements as AchievementMap)
        : {},
    achievementStats:
      g.achievementStats && typeof g.achievementStats === "object"
        ? {
            totalFocusMinutes: 0,
            totalHarvestCount: 0,
            totalPlantCount: 0,
            totalCoinsEarned: 0,
            cropTypesCollected: [],
            ...((g.achievementStats as Partial<AchievementStats>) ?? {}),
          }
        : { ...DEFAULT_GARDEN.achievementStats },
    combo: g.combo && typeof g.combo === "object"
      ? {
          count: (g.combo as ComboState).count ?? 0,
          best: (g.combo as ComboState).best ?? 0,
          active: (g.combo as ComboState).active ?? false,
        }
      : { ...DEFAULT_GARDEN.combo! },
    languish: g.languish && typeof g.languish === "object"
      ? { level: ((g.languish as LanguishState).level ?? 0) as 0 | 1 | 2 }
      : { ...DEFAULT_GARDEN.languish! },
    tier: g.tier && typeof g.tier === "object"
      ? {
          current: (g.tier as TierState).current ?? 0,
          best: (g.tier as TierState).best ?? 0,
        }
      : { ...DEFAULT_GARDEN.tier! },
    dailyCap: g.dailyCap && typeof g.dailyCap === "object"
      ? {
          date: (g.dailyCap as DailyCap).date ?? "",
          growthMinutes: (g.dailyCap as DailyCap).growthMinutes ?? 0,
        }
      : { ...DEFAULT_GARDEN.dailyCap! },
    unlocks:
      g.unlocks && typeof g.unlocks === "object"
        ? (g.unlocks as Record<string, string>)
        : {},
  };
}

export const useGardenStore = defineStore("garden", () => {
  // ===== State =====
  const data = ref<GardenState>({ ...DEFAULT_GARDEN });
  const loaded = ref(false);
  const lastError = ref<string | null>(null);
  /** 当前选中的种子（传统模式） */
  const selectedSeed = ref<string | null>(null);
  /** 提示文字 */
  const tip = ref<string>("");
  /** 种植轮盘模式 */
  const plantWheelMode = ref<boolean>(true);

  // ===== Getters =====
  const coins = computed(() => data.value.coins);
  const seeds = computed(() => data.value.seeds);
  const crops = computed(() => data.value.crops);
  const plots = computed(() => data.value.plots);
  const signInState = computed(() => data.value.signIn);
  const achievements = computed(() => data.value.achievements);
  const achievementStats = computed(() => data.value.achievementStats);

  // ===== v3 新增 Getters（连击/微黄/段位/解锁）=====
  const combo = computed(() => data.value.combo ?? DEFAULT_GARDEN.combo!);
  const comboCount = computed(() => combo.value.count);
  const comboActive = computed(() => combo.value.active);
  const languishLevel = computed(() => data.value.languish?.level ?? 0);
  const tierCurrent = computed(() => data.value.tier?.current ?? 0);
  const tierBest = computed(() => data.value.tier?.best ?? 0);
  const unlocks = computed(() => data.value.unlocks ?? {});

  /** 系统是否已解锁（渐进引入） */
  function isUnlocked(key: "market" | "craft" | "merchant" | "giant" | "pet"): boolean {
    const map: Record<string, string> = {
      market: "marketAt",
      craft: "craftAt",
      merchant: "merchantAt",
      giant: "giantAt",
      pet: "petAt",
    };
    return !!unlocks.value[map[key]];
  }

  /** 已解锁成就数量 */
  const unlockedAchievementCount = computed(() => {
    return Object.values(data.value.achievements).filter(
      (a) => a?.unlocked,
    ).length;
  });

  /** 成就总数 */
  const totalAchievementCount = computed(() => Object.keys(ACHIEVEMENT_CONFIG).length);

  /** 今日是否可签到（本地时区日期，与 Rust today_date_string 本地时区对齐） */
  const canSignInToday = computed(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const localDate = `${y}-${m}-${d}`;
    return data.value.signIn.lastDate !== localDate;
  });

  // ===== Actions =====

  /** 从后端读取菜园子数据 */
  async function load(): Promise<void> {
    try {
      const raw = await gardenRead();
      data.value = toGardenState(raw);
      lastError.value = null;
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e);
      data.value = { ...DEFAULT_GARDEN };
    } finally {
      loaded.value = true;
    }
  }

  /** 处理后端操作结果，刷新本地数据 */
  function applyResult(result: GardenOperationResult): void {
    if (result.gardenData) {
      data.value = toGardenState(result.gardenData);
    }
    if (result.unlockedAchievements && result.unlockedAchievements.length > 0) {
      lastError.value = null;
    }
  }

  /**
   * 通用菜园子操作封装：消除 plant/harvest/buySeed 等 action 的重复 try/catch 模式。
   * 统一执行操作 → 应用结果 → 失败记录错误。
   */
  async function runGardenOp<T extends GardenOperationResult>(
    op: () => Promise<T>,
  ): Promise<boolean> {
    try {
      const result = await op();
      applyResult(result);
      return result.success;
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  /** 在指定土地种植种子 */
  function plant(plotIndex: number, seedId: string): Promise<boolean> {
    return runGardenOp(() => gardenPlant(plotIndex, seedId));
  }

  /**
   * 快捷种植：在空地直接种下"最优种子"（库存中价值最高，v3 设计）。
   * 无库存种子时失败，lastError 提示先到商店购买。
   */
  function plantQuick(plotIndex: number): Promise<boolean> {
    return runGardenOp(() => gardenPlantQuick(plotIndex));
  }

  /** 收获指定土地上的作物 */
  function harvest(plotIndex: number): Promise<boolean> {
    return runGardenOp(() => gardenHarvest(plotIndex));
  }

  /** 一键全收所有成熟作物，返回 {harvested, totalCoins} 或 null（失败/无成熟） */
  async function harvestAll(): Promise<{
    harvested: { crop: string; name: string; icon: string; count: number }[];
    totalCoins: number;
  } | null> {
    try {
      const result = await gardenHarvestAll();
      applyResult(result);
      if (result.success) {
        return {
          harvested: result.harvested ?? [],
          totalCoins: result.totalCoins ?? 0,
        };
      }
      return null;
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e);
      return null;
    }
  }

  /** 购买种子 */
  function buySeed(seedId: string, quantity: number): Promise<boolean> {
    return runGardenOp(() => gardenBuySeed(seedId, quantity));
  }

  /** 出售作物 */
  function sellCrop(cropId: string, quantity: number): Promise<boolean> {
    return runGardenOp(() => gardenSellCrop(cropId, quantity));
  }

  /** 一键出售所有作物，返回 {totalCoins, totalItems} 或 null */
  async function sellAll(): Promise<{ totalCoins: number; totalItems: number } | null> {
    try {
      const result = await gardenSellAll();
      applyResult(result);
      if (result.success) {
        return {
          totalCoins: result.totalCoins ?? 0,
          totalItems: result.totalItems ?? 0,
        };
      }
      return null;
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e);
      return null;
    }
  }

  /** 解锁土地 */
  function unlockPlot(plotIndex: number): Promise<boolean> {
    return runGardenOp(() => gardenUnlockPlot(plotIndex));
  }

  /** 每日签到 */
  function signIn(): Promise<boolean> {
    return runGardenOp(() => gardenSignin());
  }

  /** 累加专注时间（触发对应成就） */
  function addFocus(minutes: number): Promise<boolean> {
    return runGardenOp(() => gardenUpdateFocus(minutes));
  }

  /** 执行惩罚（前台检测到娱乐应用时调用） */
  async function punish(
    lossAmount: number,
  ): Promise<PunishmentResult | null> {
    try {
      const result = await gardenPunishment(lossAmount);
      // 惩罚后重新加载菜园子数据（作物被清空了）
      await load();
      return result;
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e);
      return null;
    }
  }

  /** 作物成长（计时器 tick 时调用，让所有种植中的作物 progress += minutes）
   *  v3 隔离架构：前端只在专注进行中调用，告诉菜园子"涨了几分钟"。 */
  async function grow(minutes: number): Promise<boolean> {
    try {
      const result = await gardenGrow(minutes);
      if (result.success) {
        applyResult(result);
        return true;
      }
      return false;
    } catch (e) {
      // 静默失败，不打断计时器
      console.warn("[garden] grow failed:", e);
      return false;
    }
  }

  /** 记录专注会话结果（v3 隔离架构核心信号）
   *  completed=true：完成（连击+1、救活枯萎、恢复微黄）
   *  completed=false：断了（关闭/手动/违规统一信号，连击清零） */
  async function recordFocus(completed: boolean): Promise<boolean> {
    try {
      const result = await gardenRecordFocus(completed);
      if (result.success) {
        applyResult(result);
        return true;
      }
      return false;
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  /** 检查并同步菜园状态（打开菜园窗口时调用：段位/微黄/解锁） */
  async function checkState(): Promise<boolean> {
    try {
      const result = await gardenCheckState();
      if (result.success && result.gardenData) {
        applyResult(result);
        return true;
      }
      return false;
    } catch (e) {
      lastError.value = e instanceof Error ? e.message : String(e);
      return false;
    }
  }

  /** 留种繁殖：1 作物 → 1 种子（HayDay 式） */
  function seedFromCrop(cropId: string, count?: number): Promise<boolean> {
    return runGardenOp(() => gardenSeedFromCrop(cropId, count));
  }

  /** 选中种子（传统模式） */
  function selectSeed(seedKey: string): void {
    selectedSeed.value = seedKey;
  }

  /** 获取成就进度值 */
  function getAchievementProgress(config: AchievementConfig): number {
    const stats = data.value.achievementStats;
    switch (config.category) {
      case "focus":
        return stats.totalFocusMinutes;
      case "harvest":
        return stats.totalHarvestCount;
      case "plant":
        return stats.totalPlantCount;
      case "wealth":
        return stats.totalCoinsEarned;
      case "persist":
        return data.value.signIn.continuousDays;
      case "collect":
        return (stats.cropTypesCollected ?? []).length;
      case "hidden":
        return data.value.achievements[config.id]?.unlocked ? 1 : 0;
      default:
        return 0;
    }
  }

  /** 获取下一个连续签到里程碑天数 */
  function getNextMilestone(): number | null {
    const current = data.value.signIn.continuousDays;
    const milestones = Object.keys(CONTINUOUS_REWARDS)
      .map(Number)
      .sort((a, b) => a - b);
    for (const m of milestones) {
      if (current < m) return m;
    }
    return null;
  }

  return {
    data,
    loaded,
    lastError,
    selectedSeed,
    tip,
    plantWheelMode,
    coins,
    seeds,
    crops,
    plots,
    signInState,
    achievements,
    achievementStats,
    unlockedAchievementCount,
    totalAchievementCount,
    canSignInToday,
    combo,
    comboCount,
    comboActive,
    languishLevel,
    tierCurrent,
    tierBest,
    unlocks,
    isUnlocked,
    load,
    plant,
    plantQuick,
    harvest,
    harvestAll,
    buySeed,
    sellCrop,
    sellAll,
    unlockPlot,
    signIn,
    addFocus,
    punish,
    grow,
    recordFocus,
    checkState,
    seedFromCrop,
    selectSeed,
    getAchievementProgress,
    getNextMilestone,
  };
});

// HMR: 支持 Vite 热更新，避免 HMR 后丢失 Pinia 上下文
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useGardenStore, import.meta.hot));
}
