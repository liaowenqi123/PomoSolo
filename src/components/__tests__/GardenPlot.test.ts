import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

// Mock garden store
const storeMocks = {
  plots: [] as Array<{
    id: number;
    crop: string | null;
    progress: number;
    plantedAt: string | null;
    locked?: boolean;
  }>,
  coins: 0,
  tip: "",
  data: { achievements: {} as Record<string, { unlocked: boolean; unlockedAt: string }> },
  selectSeed: vi.fn(),
};

vi.mock("@/stores/garden", () => ({
  useGardenStore: () => storeMocks,
  CROP_CONFIG: {
    carrot: { name: "胡萝卜", growTime: 25, icon: "🥕", seedType: "carrot", rarity: "common", value: 10, seedPrice: 8, sellPrice: 10 },
    tomato: { name: "番茄", growTime: 50, icon: "🍅", seedType: "tomato", rarity: "common", value: 20, seedPrice: 16, sellPrice: 20 },
  },
  CROP_ORDER: ["carrot", "tomato"],
  PLOT_UNLOCK_CONFIG: {
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
  },
}));

import GardenPlot from "../garden/GardenPlot.vue";

function makePlot(overrides: Partial<{
  id: number;
  crop: string | null;
  progress: number;
  plantedAt: string | null;
  locked?: boolean;
}>) {
  return {
    id: 0,
    crop: null,
    progress: 0,
    plantedAt: null,
    locked: false,
    ...overrides,
  };
}

describe("GardenPlot.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    storeMocks.plots = Array.from({ length: 12 }, (_, i) => makePlot({ id: i, locked: i >= 6 }));
    storeMocks.coins = 0;
    storeMocks.tip = "";
    storeMocks.data.achievements = {};
  });

  const mountComponent = (props: { selectedPlotIndex?: number | null } = {}) => {
    return mount(GardenPlot, {
      props,
    });
  };

  it("应渲染 12 个 .garden-plot", () => {
    const wrapper = mountComponent();
    expect(wrapper.findAll(".garden-plot")).toHaveLength(12);
  });

  it("默认 0-5 解锁，6-11 锁定", () => {
    const wrapper = mountComponent();
    const plots = wrapper.findAll(".garden-plot");
    for (let i = 0; i <= 5; i++) {
      expect(plots[i].classes()).not.toContain("locked");
      expect(plots[i].classes()).toContain("empty");
    }
    for (let i = 6; i <= 11; i++) {
      expect(plots[i].classes()).toContain("locked");
    }
  });

  it("锁定土地应显示 🔒 图标", () => {
    const wrapper = mountComponent();
    const lockedPlot = wrapper.findAll(".garden-plot")[6];
    expect(lockedPlot.find(".lock-icon").text()).toBe("🔒");
  });

  it("空地应显示 + 图标", () => {
    const wrapper = mountComponent();
    const emptyPlot = wrapper.findAll(".garden-plot")[0];
    expect(emptyPlot.find(".plot-empty-icon").text()).toBe("+");
  });

  it("锁定金币土地应显示价格 💰{price}", () => {
    const wrapper = mountComponent();
    const coinLockedPlot = wrapper.findAll(".garden-plot")[6]; // 100 coins
    expect(coinLockedPlot.find(".lock-price").text()).toBe("💰100");
  });

  it("锁定成就土地应显示描述", () => {
    const wrapper = mountComponent();
    const achLockedPlot = wrapper.findAll(".garden-plot")[8]; // 连续签到100天
    expect(achLockedPlot.find(".lock-condition").text()).toBe("连续签到100天");
  });

  it("金币锁定土地 - 金币不足时显示『金币不足』按钮且 disabled", () => {
    storeMocks.coins = 50; // < 100
    const wrapper = mountComponent();
    const lockedPlot = wrapper.findAll(".garden-plot")[6];
    const btn = lockedPlot.find(".unlock-btn");
    expect(btn.text()).toBe("金币不足");
    expect(btn.attributes("disabled")).toBeDefined();
    expect(btn.classes()).toContain("disabled");
  });

  it("金币锁定土地 - 金币足够时显示『解锁』按钮且可点击", () => {
    storeMocks.coins = 200; // > 100
    const wrapper = mountComponent();
    const lockedPlot = wrapper.findAll(".garden-plot")[6];
    const btn = lockedPlot.find(".unlock-btn");
    expect(btn.text()).toBe("解锁");
    expect(btn.attributes("disabled")).toBeUndefined();
  });

  it("成就锁定土地 - 未解锁时显示『未达成』按钮且 disabled", () => {
    storeMocks.data.achievements = {};
    const wrapper = mountComponent();
    const lockedPlot = wrapper.findAll(".garden-plot")[8];
    const btn = lockedPlot.find(".unlock-btn");
    expect(btn.text()).toBe("未达成");
    expect(btn.attributes("disabled")).toBeDefined();
  });

  it("成就锁定土地 - 已解锁时显示『解锁』按钮", () => {
    storeMocks.data.achievements = { signin100: { unlocked: true, unlockedAt: "2025-01-01" } };
    const wrapper = mountComponent();
    const lockedPlot = wrapper.findAll(".garden-plot")[8];
    const btn = lockedPlot.find(".unlock-btn");
    expect(btn.text()).toBe("解锁");
    expect(btn.attributes("disabled")).toBeUndefined();
  });

  it("解锁按钮点击应 emit unlock 事件带索引", async () => {
    storeMocks.coins = 200;
    const wrapper = mountComponent();
    const lockedPlot = wrapper.findAll(".garden-plot")[6];
    const btn = lockedPlot.find(".unlock-btn");
    await btn.trigger("click");
    expect(wrapper.emitted("unlock")).toBeTruthy();
    expect(wrapper.emitted("unlock")![0]).toEqual([6]);
  });

  it("解锁按钮点击不应触发 plot 点击事件 (stopPropagation)", async () => {
    storeMocks.coins = 200;
    const wrapper = mountComponent();
    const lockedPlot = wrapper.findAll(".garden-plot")[6];
    const btn = lockedPlot.find(".unlock-btn");
    await btn.trigger("click");
    // 不应触发 plant / harvest 事件
    expect(wrapper.emitted("plant")).toBeFalsy();
    expect(wrapper.emitted("harvest")).toBeFalsy();
  });

  it("空地点击应 emit plant 事件带索引和鼠标坐标", async () => {
    const wrapper = mountComponent();
    const emptyPlot = wrapper.findAll(".garden-plot")[0];
    await emptyPlot.trigger("click", { clientX: 100, clientY: 200 });
    expect(wrapper.emitted("plant")).toBeTruthy();
    expect(wrapper.emitted("plant")![0]).toEqual([0, 100, 200]);
  });

  it("有作物未成熟点击应设置 store.tip 为提示文字", async () => {
    storeMocks.plots[0] = makePlot({
      id: 0,
      crop: "carrot",
      progress: 5, // 5/25 = 20% < 100%
      plantedAt: "2025-01-01",
    });
    const wrapper = mountComponent();
    const cropPlot = wrapper.findAll(".garden-plot")[0];
    await cropPlot.trigger("click", { clientX: 0, clientY: 0 });
    expect(storeMocks.tip).toBe("作物还未成熟，无法收获");
    expect(wrapper.emitted("harvest")).toBeFalsy();
  });

  it("有作物成熟点击应 emit harvest 事件", async () => {
    storeMocks.plots[0] = makePlot({
      id: 0,
      crop: "carrot",
      progress: 25, // 25/25 = 100%
      plantedAt: "2025-01-01",
    });
    const wrapper = mountComponent();
    const cropPlot = wrapper.findAll(".garden-plot")[0];
    await cropPlot.trigger("click");
    expect(wrapper.emitted("harvest")).toBeTruthy();
    expect(wrapper.emitted("harvest")![0]).toEqual([0]);
  });

  it("进度显示应使用 Math.min(100, progress/growTime*100)", () => {
    storeMocks.plots[0] = makePlot({
      id: 0,
      crop: "carrot",
      progress: 50, // 50/25 = 200% -> capped to 100%
      plantedAt: "2025-01-01",
    });
    const wrapper = mountComponent();
    const cropPlot = wrapper.findAll(".garden-plot")[0];
    const fill = cropPlot.find(".plot-progress-fill");
    expect(fill.attributes("style")).toContain("width: 100%");
  });

  it("进度小于 100% 时显示实际百分比", () => {
    storeMocks.plots[0] = makePlot({
      id: 0,
      crop: "carrot", // growTime=25
      progress: 10, // 10/25 = 40%
      plantedAt: "2025-01-01",
    });
    const wrapper = mountComponent();
    const cropPlot = wrapper.findAll(".garden-plot")[0];
    const fill = cropPlot.find(".plot-progress-fill");
    expect(fill.attributes("style")).toContain("width: 40%");
  });

  it("成熟作物应添加 .mature class", () => {
    storeMocks.plots[0] = makePlot({
      id: 0,
      crop: "carrot",
      progress: 25, // 100%
      plantedAt: "2025-01-01",
    });
    const wrapper = mountComponent();
    const cropPlot = wrapper.findAll(".garden-plot")[0];
    expect(cropPlot.classes()).toContain("mature");
    expect(cropPlot.classes()).toContain("has-crop");
  });

  it("有作物的格子应显示作物图标", () => {
    storeMocks.plots[0] = makePlot({
      id: 0,
      crop: "carrot",
      progress: 5,
      plantedAt: "2025-01-01",
    });
    const wrapper = mountComponent();
    const cropPlot = wrapper.findAll(".garden-plot")[0];
    expect(cropPlot.find(".plot-crop-icon").text()).toBe("🥕");
  });

  it("有作物的格子应显示 progress 文本 {progress}/{growTime}分钟", () => {
    storeMocks.plots[0] = makePlot({
      id: 0,
      crop: "carrot",
      progress: 10,
      plantedAt: "2025-01-01",
    });
    const wrapper = mountComponent();
    const cropPlot = wrapper.findAll(".garden-plot")[0];
    expect(cropPlot.find(".plot-progress-text").text()).toBe("10/25分钟");
  });

  it("selectedPlotIndex prop 应给对应格子加 .selected class", () => {
    const wrapper = mountComponent({ selectedPlotIndex: 3 });
    const plots = wrapper.findAll(".garden-plot");
    expect(plots[3].classes()).toContain("selected");
    expect(plots[0].classes()).not.toContain("selected");
  });

  it("selectedPlotIndex=null 时所有格子都不应有 .selected", () => {
    const wrapper = mountComponent({ selectedPlotIndex: null });
    const plots = wrapper.findAll(".garden-plot");
    for (const p of plots) {
      expect(p.classes()).not.toContain("selected");
    }
  });

  it("Plot 0-5 默认解锁；6、7、10、11 是金币锁定；8、9 是成就锁定", () => {
    const wrapper = mountComponent();
    const plots = wrapper.findAll(".garden-plot");
    // 0-5 默认解锁
    for (let i = 0; i <= 5; i++) {
      expect(plots[i].classes()).not.toContain("locked");
    }
    // 6, 7, 10, 11 是金币锁定 (有 .lock-price)
    expect(plots[6].find(".lock-price").exists()).toBe(true);
    expect(plots[7].find(".lock-price").exists()).toBe(true);
    expect(plots[10].find(".lock-price").exists()).toBe(true);
    expect(plots[11].find(".lock-price").exists()).toBe(true);
    // 8, 9 是成就锁定 (有 .lock-condition)
    expect(plots[8].find(".lock-condition").exists()).toBe(true);
    expect(plots[9].find(".lock-condition").exists()).toBe(true);
  });

  it("锁定格子点击不应触发 plant/harvest/unlock（仅按钮触发 unlock）", async () => {
    storeMocks.coins = 50; // 不够解锁
    const wrapper = mountComponent();
    const lockedPlot = wrapper.findAll(".garden-plot")[6];
    await lockedPlot.trigger("click", { clientX: 0, clientY: 0 });
    expect(wrapper.emitted("plant")).toBeFalsy();
    expect(wrapper.emitted("harvest")).toBeFalsy();
    expect(wrapper.emitted("unlock")).toBeFalsy();
  });
});
