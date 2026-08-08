import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

// Mock garden api 模块
const apiMocks = {
  gardenRead: vi.fn(),
  gardenPlant: vi.fn(),
  gardenHarvest: vi.fn(),
  gardenBuySeed: vi.fn(),
  gardenSellCrop: vi.fn(),
  gardenUnlockPlot: vi.fn(),
  gardenSignin: vi.fn(),
  gardenUpdateFocus: vi.fn(),
  gardenPunishment: vi.fn(),
  gardenGrow: vi.fn(),
  gardenRecordFocus: vi.fn(),
  gardenCheckState: vi.fn(),
  gardenSeedFromCrop: vi.fn(),
};

vi.mock("../../api/garden", () => ({
  gardenRead: (...args: unknown[]) => apiMocks.gardenRead(...args),
  gardenPlant: (...args: unknown[]) => apiMocks.gardenPlant(...args),
  gardenHarvest: (...args: unknown[]) => apiMocks.gardenHarvest(...args),
  gardenBuySeed: (...args: unknown[]) => apiMocks.gardenBuySeed(...args),
  gardenSellCrop: (...args: unknown[]) => apiMocks.gardenSellCrop(...args),
  gardenUnlockPlot: (...args: unknown[]) => apiMocks.gardenUnlockPlot(...args),
  gardenSignin: (...args: unknown[]) => apiMocks.gardenSignin(...args),
  gardenUpdateFocus: (...args: unknown[]) => apiMocks.gardenUpdateFocus(...args),
  gardenPunishment: (...args: unknown[]) => apiMocks.gardenPunishment(...args),
  gardenGrow: (...args: unknown[]) => apiMocks.gardenGrow(...args),
  gardenRecordFocus: (...args: unknown[]) => apiMocks.gardenRecordFocus(...args),
  gardenCheckState: (...args: unknown[]) => apiMocks.gardenCheckState(...args),
  gardenSeedFromCrop: (...args: unknown[]) => apiMocks.gardenSeedFromCrop(...args),
}));

import {
  useGardenStore,
  DEFAULT_GARDEN,
  ACHIEVEMENT_CONFIG,
  CROP_CONFIG,
  CROP_ORDER,
  CONTINUOUS_REWARDS,
  type GardenState,
} from "../garden";

describe("useGardenStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    Object.values(apiMocks).forEach((m) => m.mockReset());
  });

  /** 辅助函数：直接替换 store.data，避免 $patch 深合并污染 DEFAULT_GARDEN */
  function setData(store: ReturnType<typeof useGardenStore>, patch: Partial<GardenState>) {
    store.data = { ...store.data, ...patch };
  }

  // ===== 初始状态 =====
  it("初始状态应为 DEFAULT_GARDEN，loaded=false, lastError=null", () => {
    const store = useGardenStore();
    expect(store.data).toEqual(DEFAULT_GARDEN);
    expect(store.loaded).toBe(false);
    expect(store.lastError).toBe(null);
    expect(store.tip).toBe("");
    expect(store.selectedSeed).toBe(null);
    expect(store.plantWheelMode).toBe(true);
  });

  it("初始 getters 应反映 DEFAULT_GARDEN", () => {
    const store = useGardenStore();
    expect(store.coins).toBe(DEFAULT_GARDEN.coins);
    expect(store.seeds).toEqual(DEFAULT_GARDEN.seeds);
    expect(store.crops).toEqual(DEFAULT_GARDEN.crops);
    expect(store.plots).toHaveLength(12);
    expect(store.plots[0].locked).toBe(false);
    expect(store.plots[6].locked).toBe(true);
  });

  // ===== load =====
  it("load 成功时应更新 data、清空 lastError、置 loaded=true", async () => {
    const fakeRaw = {
      coins: 200,
      seeds: { carrot: 10 },
      crops: { tomato: 3 },
      plots: [],
      warehouse: [],
      signIn: {
        lastDate: null,
        continuousDays: 5,
        totalDays: 10,
        weekRecords: [false, false, false, false, false, false, false],
      },
      achievements: { focus1h: { unlocked: true, unlockedAt: "2025-01-01" } },
      achievementStats: {
        totalFocusMinutes: 60,
        totalHarvestCount: 5,
        totalPlantCount: 8,
        totalCoinsEarned: 100,
        cropTypesCollected: ["carrot"],
      },
    };
    apiMocks.gardenRead.mockResolvedValue(fakeRaw);

    const store = useGardenStore();
    await store.load();

    expect(apiMocks.gardenRead).toHaveBeenCalledTimes(1);
    expect(store.loaded).toBe(true);
    expect(store.lastError).toBe(null);
    expect(store.coins).toBe(200);
    expect(store.seeds).toEqual({ carrot: 10 });
    expect(store.signInState.continuousDays).toBe(5);
    expect(store.achievements.focus1h?.unlocked).toBe(true);
    expect(store.achievementStats.totalFocusMinutes).toBe(60);
  });

  it("load 失败时应回退到 DEFAULT_GARDEN，设置 lastError、loaded=true", async () => {
    apiMocks.gardenRead.mockRejectedValue(new Error("network down"));

    const store = useGardenStore();
    await store.load();

    expect(store.loaded).toBe(true);
    expect(store.lastError).toBe("network down");
    expect(store.data).toEqual(DEFAULT_GARDEN);
    expect(store.coins).toBe(DEFAULT_GARDEN.coins);
  });

  it("load 失败时若错误非 Error 实例应 String() 处理", async () => {
    apiMocks.gardenRead.mockRejectedValue("string error");

    const store = useGardenStore();
    await store.load();

    expect(store.lastError).toBe("string error");
  });

  // ===== applyResult (通过 plant 间接测试) =====
  it("applyResult 在 plant 成功时使用 result.gardenData 替换 data", async () => {
    const newGarden = {
      ...DEFAULT_GARDEN,
      coins: 999,
      seeds: { carrot: 1 },
    };
    apiMocks.gardenPlant.mockResolvedValue({ success: true, gardenData: newGarden });

    const store = useGardenStore();
    const ok = await store.plant(0, "carrot");

    expect(ok).toBe(true);
    expect(store.coins).toBe(999);
    expect(store.seeds).toEqual({ carrot: 1 });
  });

  it("applyResult 在没有 gardenData 时不应修改 data (plant 失败)", async () => {
    apiMocks.gardenPlant.mockResolvedValue({ success: false });

    const store = useGardenStore();
    const original = store.data;
    const ok = await store.plant(0, "carrot");

    expect(ok).toBe(false);
    expect(store.data).toBe(original);
  });

  it("applyResult 在解锁新成就时应清空 lastError", async () => {
    apiMocks.gardenPlant.mockResolvedValue({
      success: true,
      unlockedAchievements: [{ id: "focus1h", name: "初心者" }],
    });
    const store = useGardenStore();
    store.lastError = "previous error";

    await store.plant(0, "carrot");

    expect(store.lastError).toBe(null);
  });

  it("applyResult 在未解锁成就时不应清空 lastError", async () => {
    apiMocks.gardenPlant.mockResolvedValue({
      success: true,
      unlockedAchievements: [],
    });
    const store = useGardenStore();
    store.lastError = "previous error";

    await store.plant(0, "carrot");

    expect(store.lastError).toBe("previous error");
  });

  // ===== plant =====
  it("plant 成功时调用 gardenPlant、返回 true", async () => {
    apiMocks.gardenPlant.mockResolvedValue({ success: true });

    const store = useGardenStore();
    const ok = await store.plant(2, "carrot");

    expect(apiMocks.gardenPlant).toHaveBeenCalledWith(2, "carrot");
    expect(ok).toBe(true);
  });

  it("plant 失败时（success=false）返回 false", async () => {
    apiMocks.gardenPlant.mockResolvedValue({ success: false });

    const store = useGardenStore();
    const ok = await store.plant(2, "carrot");

    expect(ok).toBe(false);
  });

  it("plant 异常时设置 lastError、返回 false", async () => {
    apiMocks.gardenPlant.mockRejectedValue(new Error("plant err"));

    const store = useGardenStore();
    const ok = await store.plant(2, "carrot");

    expect(ok).toBe(false);
    expect(store.lastError).toBe("plant err");
  });

  // ===== harvest =====
  it("harvest 成功时调用 gardenHarvest、返回 true", async () => {
    apiMocks.gardenHarvest.mockResolvedValue({ success: true });

    const store = useGardenStore();
    const ok = await store.harvest(3);

    expect(apiMocks.gardenHarvest).toHaveBeenCalledWith(3);
    expect(ok).toBe(true);
  });

  it("harvest 异常时返回 false 并设置 lastError", async () => {
    apiMocks.gardenHarvest.mockRejectedValue(new Error("harvest err"));

    const store = useGardenStore();
    const ok = await store.harvest(3);

    expect(ok).toBe(false);
    expect(store.lastError).toBe("harvest err");
  });

  // ===== buySeed =====
  it("buySeed 成功时调用 gardenBuySeed、返回 true", async () => {
    apiMocks.gardenBuySeed.mockResolvedValue({ success: true });

    const store = useGardenStore();
    const ok = await store.buySeed("carrot", 1);

    expect(apiMocks.gardenBuySeed).toHaveBeenCalledWith("carrot", 1);
    expect(ok).toBe(true);
  });

  it("buySeed 异常时返回 false", async () => {
    apiMocks.gardenBuySeed.mockRejectedValue(new Error("buy err"));

    const store = useGardenStore();
    const ok = await store.buySeed("carrot", 1);

    expect(ok).toBe(false);
    expect(store.lastError).toBe("buy err");
  });

  // ===== sellCrop =====
  it("sellCrop 成功时调用 gardenSellCrop、返回 true", async () => {
    apiMocks.gardenSellCrop.mockResolvedValue({ success: true });

    const store = useGardenStore();
    const ok = await store.sellCrop("tomato", 2);

    expect(apiMocks.gardenSellCrop).toHaveBeenCalledWith("tomato", 2);
    expect(ok).toBe(true);
  });

  it("sellCrop 异常时返回 false", async () => {
    apiMocks.gardenSellCrop.mockRejectedValue(new Error("sell err"));

    const store = useGardenStore();
    const ok = await store.sellCrop("tomato", 2);

    expect(ok).toBe(false);
  });

  // ===== unlockPlot =====
  it("unlockPlot 成功时调用 gardenUnlockPlot、返回 true", async () => {
    apiMocks.gardenUnlockPlot.mockResolvedValue({ success: true });

    const store = useGardenStore();
    const ok = await store.unlockPlot(6);

    expect(apiMocks.gardenUnlockPlot).toHaveBeenCalledWith(6);
    expect(ok).toBe(true);
  });

  it("unlockPlot 异常时返回 false", async () => {
    apiMocks.gardenUnlockPlot.mockRejectedValue(new Error("unlock err"));

    const store = useGardenStore();
    const ok = await store.unlockPlot(6);

    expect(ok).toBe(false);
  });

  // ===== signIn =====
  it("signIn 成功时调用 gardenSignin、返回 true", async () => {
    apiMocks.gardenSignin.mockResolvedValue({ success: true });

    const store = useGardenStore();
    const ok = await store.signIn();

    expect(apiMocks.gardenSignin).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });

  it("signIn 异常时返回 false", async () => {
    apiMocks.gardenSignin.mockRejectedValue(new Error("signin err"));

    const store = useGardenStore();
    const ok = await store.signIn();

    expect(ok).toBe(false);
  });

  // ===== addFocus =====
  it("addFocus 成功时调用 gardenUpdateFocus、返回 true", async () => {
    apiMocks.gardenUpdateFocus.mockResolvedValue({ success: true });

    const store = useGardenStore();
    const ok = await store.addFocus(25);

    expect(apiMocks.gardenUpdateFocus).toHaveBeenCalledWith(25);
    expect(ok).toBe(true);
  });

  it("addFocus 异常时返回 false", async () => {
    apiMocks.gardenUpdateFocus.mockRejectedValue(new Error("focus err"));

    const store = useGardenStore();
    const ok = await store.addFocus(25);

    expect(ok).toBe(false);
  });

  // ===== punish =====
  it("punish 成功时返回 PunishmentResult", async () => {
    const fakePunishment = {
      hasLoss: true,
      losses: [{ type: "coins", amount: 5 }],
      totalMinutes: 30,
    };
    apiMocks.gardenPunishment.mockResolvedValue(fakePunishment);

    const store = useGardenStore();
    const result = await store.punish(30);

    expect(apiMocks.gardenPunishment).toHaveBeenCalledWith(30);
    expect(result).toEqual(fakePunishment);
  });

  it("punish 异常时返回 null 并设置 lastError", async () => {
    apiMocks.gardenPunishment.mockRejectedValue(new Error("punish err"));

    const store = useGardenStore();
    const result = await store.punish(30);

    expect(result).toBe(null);
    expect(store.lastError).toBe("punish err");
  });

  // ===== selectSeed =====
  it("selectSeed 应设置 selectedSeed", () => {
    const store = useGardenStore();
    expect(store.selectedSeed).toBe(null);
    store.selectSeed("carrot");
    expect(store.selectedSeed).toBe("carrot");
    store.selectSeed("tomato");
    expect(store.selectedSeed).toBe("tomato");
  });

  // ===== getAchievementProgress =====
  it("getAchievementProgress 按 category 返回对应统计值 - focus", () => {
    const store = useGardenStore();
    setData(store, {
      achievementStats: {
        totalFocusMinutes: 120,
        totalHarvestCount: 0,
        totalPlantCount: 0,
        totalCoinsEarned: 0,
        cropTypesCollected: [],
      },
    });

    const focusConfig = ACHIEVEMENT_CONFIG.focus1h;
    expect(store.getAchievementProgress(focusConfig)).toBe(120);
  });

  it("getAchievementProgress - harvest", () => {
    const store = useGardenStore();
    setData(store, {
      achievementStats: {
        totalFocusMinutes: 0,
        totalHarvestCount: 7,
        totalPlantCount: 0,
        totalCoinsEarned: 0,
        cropTypesCollected: [],
      },
    });

    expect(store.getAchievementProgress(ACHIEVEMENT_CONFIG.harvest10)).toBe(7);
  });

  it("getAchievementProgress - plant", () => {
    const store = useGardenStore();
    setData(store, {
      achievementStats: {
        totalFocusMinutes: 0,
        totalHarvestCount: 0,
        totalPlantCount: 25,
        totalCoinsEarned: 0,
        cropTypesCollected: [],
      },
    });

    expect(store.getAchievementProgress(ACHIEVEMENT_CONFIG.plant50)).toBe(25);
  });

  it("getAchievementProgress - wealth", () => {
    const store = useGardenStore();
    setData(store, {
      achievementStats: {
        totalFocusMinutes: 0,
        totalHarvestCount: 0,
        totalPlantCount: 0,
        totalCoinsEarned: 250,
        cropTypesCollected: [],
      },
    });

    expect(store.getAchievementProgress(ACHIEVEMENT_CONFIG.coins500)).toBe(250);
  });

  it("getAchievementProgress - persist 返回 continuousDays", () => {
    const store = useGardenStore();
    setData(store, {
      signIn: { ...DEFAULT_GARDEN.signIn, continuousDays: 8 },
    });

    expect(store.getAchievementProgress(ACHIEVEMENT_CONFIG.signin30)).toBe(8);
  });

  it("getAchievementProgress - collect 返回 cropTypesCollected.length", () => {
    const store = useGardenStore();
    setData(store, {
      achievementStats: {
        totalFocusMinutes: 0,
        totalHarvestCount: 0,
        totalPlantCount: 0,
        totalCoinsEarned: 0,
        cropTypesCollected: ["carrot", "tomato", "sunflower"],
      },
    });

    expect(store.getAchievementProgress(ACHIEVEMENT_CONFIG.collect3)).toBe(3);
  });

  it("getAchievementProgress - hidden 返回 1 if 已解锁 else 0", () => {
    const store = useGardenStore();

    // 初始未解锁
    expect(store.getAchievementProgress(ACHIEVEMENT_CONFIG.easteregg)).toBe(0);

    // 解锁后
    setData(store, {
      achievements: { easteregg: { unlocked: true, unlockedAt: "2025-01-01" } },
    });
    expect(store.getAchievementProgress(ACHIEVEMENT_CONFIG.easteregg)).toBe(1);
  });

  // ===== getNextMilestone =====
  it("getNextMilestone 在 0 天时返回 3", () => {
    const store = useGardenStore();
    expect(store.getNextMilestone()).toBe(3);
  });

  it("getNextMilestone 在 5 天时返回 7", () => {
    const store = useGardenStore();
    setData(store, {
      signIn: { ...DEFAULT_GARDEN.signIn, continuousDays: 5 },
    });
    expect(store.getNextMilestone()).toBe(7);
  });

  it("getNextMilestone 在 14 天时返回 30", () => {
    const store = useGardenStore();
    setData(store, {
      signIn: { ...DEFAULT_GARDEN.signIn, continuousDays: 14 },
    });
    expect(store.getNextMilestone()).toBe(30);
  });

  it("getNextMilestone 超过所有里程碑时返回 null", () => {
    const store = useGardenStore();
    setData(store, {
      signIn: { ...DEFAULT_GARDEN.signIn, continuousDays: 100 },
    });
    expect(store.getNextMilestone()).toBe(null);
  });

  it("getNextMilestone 在等于里程碑值时返回下一个", () => {
    const store = useGardenStore();
    setData(store, {
      signIn: { ...DEFAULT_GARDEN.signIn, continuousDays: 3 },
    });
    expect(store.getNextMilestone()).toBe(7);
  });

  // ===== canSignInToday =====
  it("canSignInToday 在 lastDate !== today 时返回 true", () => {
    const store = useGardenStore();
    const today = new Date().toISOString().split("T")[0];
    setData(store, {
      signIn: { ...DEFAULT_GARDEN.signIn, lastDate: "2020-01-01" },
    });
    expect(store.canSignInToday).toBe(true);
    expect(DEFAULT_GARDEN.signIn.lastDate).not.toBe(today);
  });

  it("canSignInToday 在 lastDate === today 时返回 false", () => {
    const store = useGardenStore();
    const today = new Date().toISOString().split("T")[0];
    setData(store, {
      signIn: { ...DEFAULT_GARDEN.signIn, lastDate: today },
    });
    expect(store.canSignInToday).toBe(false);
  });

  // ===== unlockedAchievementCount / totalAchievementCount =====
  it("unlockedAchievementCount 应统计已解锁数量", () => {
    const store = useGardenStore();
    expect(store.unlockedAchievementCount).toBe(0);

    setData(store, {
      achievements: {
        focus1h: { unlocked: true, unlockedAt: "2025-01-01" },
        harvest1: { unlocked: true, unlockedAt: "2025-01-02" },
        focus5h: { unlocked: false, unlockedAt: "" },
      },
    });

    expect(store.unlockedAchievementCount).toBe(2);
  });

  it("totalAchievementCount 等于 ACHIEVEMENT_CONFIG 的长度", () => {
    const store = useGardenStore();
    expect(store.totalAchievementCount).toBe(
      Object.keys(ACHIEVEMENT_CONFIG).length,
    );
  });

  // ===== 静态配置 =====
  it("CROP_CONFIG 应包含 5 种作物", () => {
    expect(Object.keys(CROP_CONFIG).length).toBe(5);
    expect(CROP_CONFIG.carrot).toBeDefined();
    expect(CROP_CONFIG.osmanthus).toBeDefined();
  });

  it("CROP_ORDER 应为 5 项", () => {
    expect(CROP_ORDER.length).toBe(5);
  });

  it("CONTINUOUS_REWARDS 应包含 3、7、14、30 四个里程碑", () => {
    const keys = Object.keys(CONTINUOUS_REWARDS).map(Number).sort((a, b) => a - b);
    expect(keys).toEqual([3, 7, 14, 30]);
  });

  it("DEFAULT_GARDEN 应有 12 块土地，0-5 解锁，6-11 锁定", () => {
    expect(DEFAULT_GARDEN.plots.length).toBe(12);
    for (let i = 0; i <= 5; i++) {
      expect(DEFAULT_GARDEN.plots[i].locked).toBe(false);
    }
    for (let i = 6; i <= 11; i++) {
      expect(DEFAULT_GARDEN.plots[i].locked).toBe(true);
    }
  });

  // ===== v3 初始状态 =====
  it("v3 初始状态：combo/languish/tier 默认值", () => {
    const store = useGardenStore();
    expect(store.comboCount).toBe(0);
    expect(store.comboActive).toBe(false);
    expect(store.languishLevel).toBe(0);
    expect(store.tierCurrent).toBe(0);
    expect(store.tierBest).toBe(0);
    expect(store.isUnlocked("market")).toBe(false);
  });

  it("isUnlocked 按 unlocks 字段判断", () => {
    const store = useGardenStore();
    setData(store, {
      unlocks: { marketAt: "2026-08-08T00:00:00Z" },
    });
    expect(store.isUnlocked("market")).toBe(true);
    expect(store.isUnlocked("craft")).toBe(false);
  });

  // ===== recordFocus =====
  it("recordFocus(true) 调用 gardenRecordFocus(true) 并应用结果", async () => {
    const newGarden = {
      ...DEFAULT_GARDEN,
      combo: { count: 2, best: 2, active: true },
    };
    apiMocks.gardenRecordFocus = vi.fn().mockResolvedValue({
      success: true,
      gardenData: newGarden,
    });

    const store = useGardenStore();
    const ok = await store.recordFocus(true);

    expect(apiMocks.gardenRecordFocus).toHaveBeenCalledWith(true);
    expect(ok).toBe(true);
    expect(store.comboCount).toBe(2);
    expect(store.comboActive).toBe(true);
  });

  it("recordFocus(false) 调用 gardenRecordFocus(false)，失败时返回 false", async () => {
    apiMocks.gardenRecordFocus = vi.fn().mockResolvedValue({ success: false });

    const store = useGardenStore();
    const ok = await store.recordFocus(false);

    expect(apiMocks.gardenRecordFocus).toHaveBeenCalledWith(false);
    expect(ok).toBe(false);
  });

  it("recordFocus 异常时设置 lastError 并返回 false", async () => {
    apiMocks.gardenRecordFocus = vi.fn().mockRejectedValue(new Error("focus err"));

    const store = useGardenStore();
    const ok = await store.recordFocus(true);

    expect(ok).toBe(false);
    expect(store.lastError).toBe("focus err");
  });

  // ===== checkState =====
  it("checkState 调用 gardenCheckState 并应用 tier/languish/unlocks", async () => {
    const newGarden = {
      ...DEFAULT_GARDEN,
      tier: { current: 1, best: 1 },
      languish: { level: 0 },
      unlocks: { marketAt: "x", craftAt: "x" },
    };
    apiMocks.gardenCheckState = vi.fn().mockResolvedValue({
      success: true,
      gardenData: newGarden,
    });

    const store = useGardenStore();
    const ok = await store.checkState();

    expect(ok).toBe(true);
    expect(store.tierCurrent).toBe(1);
    expect(store.tierBest).toBe(1);
    expect(store.isUnlocked("market")).toBe(true);
    expect(store.isUnlocked("craft")).toBe(true);
  });

  it("checkState 失败时返回 false", async () => {
    apiMocks.gardenCheckState = vi.fn().mockRejectedValue(new Error("state err"));

    const store = useGardenStore();
    const ok = await store.checkState();

    expect(ok).toBe(false);
  });

  // ===== seedFromCrop =====
  it("seedFromCrop 调用 gardenSeedFromCrop(crop, count)", async () => {
    apiMocks.gardenSeedFromCrop = vi.fn().mockResolvedValue({ success: true });

    const store = useGardenStore();
    const ok = await store.seedFromCrop("carrot", 2);

    expect(apiMocks.gardenSeedFromCrop).toHaveBeenCalledWith("carrot", 2);
    expect(ok).toBe(true);
  });

  it("seedFromCrop 异常时返回 false", async () => {
    apiMocks.gardenSeedFromCrop = vi.fn().mockRejectedValue(new Error("seed err"));

    const store = useGardenStore();
    const ok = await store.seedFromCrop("carrot");

    expect(ok).toBe(false);
    expect(store.lastError).toBe("seed err");
  });
});
