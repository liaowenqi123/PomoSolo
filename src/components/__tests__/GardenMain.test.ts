import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

// Mock garden store
const storeMocks = {
  coins: 100,
  tip: "",
  plantWheelMode: true,
  selectedSeed: null as string | null,
  seeds: { carrot: 5 },
  canSignInToday: true,
  load: vi.fn().mockResolvedValue(undefined),
  checkState: vi.fn().mockResolvedValue(true),
  plant: vi.fn().mockResolvedValue(true),
  harvest: vi.fn().mockResolvedValue(true),
  harvestAll: vi.fn().mockResolvedValue({ harvested: [], totalCoins: 0 }),
  unlockPlot: vi.fn().mockResolvedValue(true),
  signIn: vi.fn().mockResolvedValue(true),
  lastError: "",
  // v3 状态条 getters
  comboCount: 0,
  comboActive: false,
  languishLevel: 0,
  tierCurrent: 0,
  tierBest: 0,
};

vi.mock("@/stores/garden", () => ({
  useGardenStore: () => storeMocks,
}));

// Mock window API 以避免加载 @tauri-apps/api/core
vi.mock("@/api/window", () => ({
  showGardenWindow: vi.fn(),
  hideGardenWindow: vi.fn(),
}));

// Mock 子组件，仅暴露 props 和事件，避免级联渲染
vi.mock("../garden/GardenPlot.vue", () => ({
  default: {
    name: "GardenPlotStub",
    emits: ["plant", "harvest", "unlock"],
    template: '<div class="garden-plot-stub"></div>',
  },
}));
vi.mock("../garden/GardenShop.vue", () => ({
  default: {
    name: "GardenShopStub",
    props: ["visible"],
    emits: ["close"],
    template: '<div class="garden-shop-stub" v-if="visible"></div>',
  },
}));
vi.mock("../garden/GardenBag.vue", () => ({
  default: {
    name: "GardenBagStub",
    props: ["showSeedSelection"],
    template: '<div class="garden-bag-stub"></div>',
  },
}));
vi.mock("../garden/GardenSignin.vue", () => ({
  default: {
    name: "GardenSigninStub",
    props: ["visible"],
    emits: ["close"],
    template: '<div class="garden-signin-stub" v-if="visible"></div>',
  },
}));
vi.mock("../garden/GardenAchievement.vue", () => ({
  default: {
    name: "GardenAchievementStub",
    props: ["visible"],
    emits: ["close"],
    template: '<div class="garden-achievement-stub" v-if="visible"></div>',
  },
}));
vi.mock("../garden/GardenPlantWheel.vue", () => ({
  default: {
    name: "GardenPlantWheelStub",
    props: ["visible", "x", "y", "seeds"],
    emits: ["select", "close"],
    template: '<div class="garden-plantwheel-stub" v-if="visible"></div>',
  },
}));

import GardenMain from "../garden/GardenMain.vue";

describe("GardenMain.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    storeMocks.coins = 100;
    storeMocks.tip = "";
    storeMocks.plantWheelMode = true;
    storeMocks.selectedSeed = null;
    storeMocks.seeds = { carrot: 5 };
    storeMocks.canSignInToday = true;
    storeMocks.load.mockReset();
    storeMocks.load.mockResolvedValue(undefined);
    storeMocks.checkState.mockReset();
    storeMocks.checkState.mockResolvedValue(true);
    storeMocks.plant.mockReset();
    storeMocks.plant.mockResolvedValue(true);
    storeMocks.harvest.mockReset();
    storeMocks.harvest.mockResolvedValue(true);
    storeMocks.harvestAll.mockReset();
    storeMocks.harvestAll.mockResolvedValue({ harvested: [], totalCoins: 0 });
    storeMocks.unlockPlot.mockReset();
    storeMocks.unlockPlot.mockResolvedValue(true);
    storeMocks.signIn.mockReset();
    storeMocks.signIn.mockResolvedValue(true);
    storeMocks.comboCount = 0;
    storeMocks.comboActive = false;
    storeMocks.languishLevel = 0;
    storeMocks.tierCurrent = 0;
    storeMocks.tierBest = 0;
  });

  const mountComponent = () => {
    return mount(GardenMain);
  };

  it("应渲染金币显示，且数值来自 store.coins", () => {
    storeMocks.coins = 250;
    const wrapper = mountComponent();
    expect(wrapper.find(".garden-header__coins").text()).toContain("250");
  });

  it("应渲染标题『🌱 菜园子』", () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".garden-header__title").text()).toBe("🌱 菜园子");
  });

  it("应渲染四个导航按钮", () => {
    const wrapper = mountComponent();
    const navBtns = wrapper.findAll(".garden-nav-btn");
    expect(navBtns).toHaveLength(4);
    // 一键全收 / 签到 / 商店 / 成就墙
    expect(navBtns[0].attributes("title")).toBe("一键全收成熟作物");
    expect(navBtns[1].attributes("title")).toBe("每日签到");
    expect(navBtns[2].attributes("title")).toBe("商店");
    expect(navBtns[3].attributes("title")).toBe("成就墙");
  });

  it("点击一键全收按钮应调用 harvestAll 并提示收获汇总", async () => {
    storeMocks.harvestAll = vi.fn().mockResolvedValue({
      harvested: [{ crop: "carrot", name: "胡萝卜", icon: "🥕", count: 2 }],
      totalCoins: 10,
    });
    const wrapper = mountComponent();
    const harvestAllBtn = wrapper.findAll(".garden-nav-btn")[0];
    await harvestAllBtn.trigger("click");
    await flushPromises();
    await wrapper.vm.$nextTick();
    expect(storeMocks.harvestAll).toHaveBeenCalledTimes(1);
    expect(storeMocks.tip).toContain("收获 2 株");
  });

  it("一键全收无成熟作物时应提示", async () => {
    storeMocks.harvestAll = vi.fn().mockResolvedValue({ harvested: [], totalCoins: 0 });
    const wrapper = mountComponent();
    await wrapper.findAll(".garden-nav-btn")[0].trigger("click");
    await flushPromises();
    await wrapper.vm.$nextTick();
    expect(storeMocks.tip).toContain("没有成熟作物可收获");
  });

  it("应渲染 GardenPlot 子组件", () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".garden-plot-stub").exists()).toBe(true);
  });

  it("应渲染 GardenBag 子组件", () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".garden-bag-stub").exists()).toBe(true);
  });

  it("GardenBag 应传 show-seed-selection=!plantWheelMode", () => {
    storeMocks.plantWheelMode = true;
    const wrapper = mountComponent();
    const bagStub = wrapper.findComponent({ name: "GardenBagStub" });
    expect(bagStub.props("showSeedSelection")).toBe(false);
  });

  it("plantWheelMode=false 时 GardenBag 应传 showSeedSelection=true", async () => {
    storeMocks.plantWheelMode = false;
    const wrapper = mountComponent();
    const bagStub = wrapper.findComponent({ name: "GardenBagStub" });
    expect(bagStub.props("showSeedSelection")).toBe(true);
  });

  it("应渲染 tip 文本（来自 store.tip）", () => {
    storeMocks.tip = "测试提示文本";
    const wrapper = mountComponent();
    expect(wrapper.find(".garden-tip").text()).toBe("测试提示文本");
  });

  it("tip 为空时 .garden-tip 也应渲染", () => {
    storeMocks.tip = "";
    const wrapper = mountComponent();
    expect(wrapper.find(".garden-tip").exists()).toBe(true);
  });

  it("点击签到按钮应显示 GardenSignin 弹窗", async () => {
    const wrapper = mountComponent();
    // 初始不显示
    expect(wrapper.find(".garden-signin-stub").exists()).toBe(false);

    // 点击签到按钮
    const signinBtn = wrapper.findAll(".garden-nav-btn")[1];
    await signinBtn.trigger("click");
    expect(wrapper.find(".garden-signin-stub").exists()).toBe(true);
  });

  it("点击商店按钮应显示 GardenShop 弹窗", async () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".garden-shop-stub").exists()).toBe(false);

    const shopBtn = wrapper.findAll(".garden-nav-btn")[2];
    await shopBtn.trigger("click");
    expect(wrapper.find(".garden-shop-stub").exists()).toBe(true);
  });

  it("点击成就墙按钮应显示 GardenAchievement 弹窗", async () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".garden-achievement-stub").exists()).toBe(false);

    const achBtn = wrapper.findAll(".garden-nav-btn")[3];
    await achBtn.trigger("click");
    expect(wrapper.find(".garden-achievement-stub").exists()).toBe(true);
  });

  it("GardenSignin 弹窗 emit close 时应关闭", async () => {
    const wrapper = mountComponent();
    const signinBtn = wrapper.findAll(".garden-nav-btn")[1];
    await signinBtn.trigger("click");
    const signinStub = wrapper.findComponent({ name: "GardenSigninStub" });
    await signinStub.vm.$emit("close");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".garden-signin-stub").exists()).toBe(false);
  });

  it("GardenShop 弹窗 emit close 时应关闭", async () => {
    const wrapper = mountComponent();
    const shopBtn = wrapper.findAll(".garden-nav-btn")[2];
    await shopBtn.trigger("click");
    const shopStub = wrapper.findComponent({ name: "GardenShopStub" });
    await shopStub.vm.$emit("close");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".garden-shop-stub").exists()).toBe(false);
  });

  it("GardenAchievement 弹窗 emit close 时应关闭", async () => {
    const wrapper = mountComponent();
    const achBtn = wrapper.findAll(".garden-nav-btn")[3];
    await achBtn.trigger("click");
    const achStub = wrapper.findComponent({ name: "GardenAchievementStub" });
    await achStub.vm.$emit("close");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".garden-achievement-stub").exists()).toBe(false);
  });

  it("plantWheelMode=true 时 GardenPlot emit plant 应显示种植轮盘", async () => {
    storeMocks.plantWheelMode = true;
    const wrapper = mountComponent();
    const plotStub = wrapper.findComponent({ name: "GardenPlotStub" });

    expect(wrapper.find(".garden-plantwheel-stub").exists()).toBe(false);
    await plotStub.vm.$emit("plant", 0, 100, 200);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".garden-plantwheel-stub").exists()).toBe(true);
  });

  it("plantWheelMode=true 时 plant 事件不应直接调用 store.plant", async () => {
    storeMocks.plantWheelMode = true;
    const wrapper = mountComponent();
    const plotStub = wrapper.findComponent({ name: "GardenPlotStub" });
    await plotStub.vm.$emit("plant", 2, 100, 200);
    await wrapper.vm.$nextTick();
    expect(storeMocks.plant).not.toHaveBeenCalled();
  });

  it("plantWheelMode=false 且 selectedSeed 不为空 时应调用 store.plant", async () => {
    storeMocks.plantWheelMode = false;
    storeMocks.selectedSeed = "carrot";
    const wrapper = mountComponent();
    const plotStub = wrapper.findComponent({ name: "GardenPlotStub" });
    await plotStub.vm.$emit("plant", 2, 100, 200);
    await wrapper.vm.$nextTick();
    expect(storeMocks.plant).toHaveBeenCalledWith(2, "carrot");
  });

  it("plantWheelMode=false 且 selectedSeed=null 时应设置 tip 提示", async () => {
    storeMocks.plantWheelMode = false;
    storeMocks.selectedSeed = null;
    const wrapper = mountComponent();
    const plotStub = wrapper.findComponent({ name: "GardenPlotStub" });
    await plotStub.vm.$emit("plant", 2, 100, 200);
    await wrapper.vm.$nextTick();
    expect(storeMocks.tip).toBe("请先选择一个种子");
    expect(storeMocks.plant).not.toHaveBeenCalled();
  });

  it("种植轮盘选中种子应关闭轮盘并调用 store.plant(plotIndex, seedKey)", async () => {
    storeMocks.plantWheelMode = true;
    const wrapper = mountComponent();
    const plotStub = wrapper.findComponent({ name: "GardenPlotStub" });
    await plotStub.vm.$emit("plant", 3, 100, 200);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".garden-plantwheel-stub").exists()).toBe(true);

    const wheelStub = wrapper.findComponent({ name: "GardenPlantWheelStub" });
    await wheelStub.vm.$emit("select", "carrot");
    await wrapper.vm.$nextTick();
    expect(storeMocks.plant).toHaveBeenCalledWith(3, "carrot");
    // 轮盘应关闭
    expect(wrapper.find(".garden-plantwheel-stub").exists()).toBe(false);
  });

  it("种植轮盘 emit close 应关闭轮盘", async () => {
    storeMocks.plantWheelMode = true;
    const wrapper = mountComponent();
    const plotStub = wrapper.findComponent({ name: "GardenPlotStub" });
    await plotStub.vm.$emit("plant", 5, 100, 200);
    await wrapper.vm.$nextTick();

    const wheelStub = wrapper.findComponent({ name: "GardenPlantWheelStub" });
    await wheelStub.vm.$emit("close");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".garden-plantwheel-stub").exists()).toBe(false);
  });

  it("GardenPlot emit harvest 应调用 store.harvest(plotIndex)", async () => {
    const wrapper = mountComponent();
    const plotStub = wrapper.findComponent({ name: "GardenPlotStub" });
    await plotStub.vm.$emit("harvest", 4);
    await wrapper.vm.$nextTick();
    expect(storeMocks.harvest).toHaveBeenCalledWith(4);
  });

  it("GardenPlot emit unlock 应调用 store.unlockPlot(plotIndex)", async () => {
    const wrapper = mountComponent();
    const plotStub = wrapper.findComponent({ name: "GardenPlotStub" });
    await plotStub.vm.$emit("unlock", 7);
    await wrapper.vm.$nextTick();
    expect(storeMocks.unlockPlot).toHaveBeenCalledWith(7);
  });

  it("canSignInToday=false 时签到按钮应有 .signed class", () => {
    storeMocks.canSignInToday = false;
    const wrapper = mountComponent();
    const signinBtn = wrapper.findAll(".garden-nav-btn")[1];
    expect(signinBtn.classes()).toContain("signed");
  });

  it("canSignInToday=true 时签到按钮不应有 .signed class", () => {
    storeMocks.canSignInToday = true;
    const wrapper = mountComponent();
    const signinBtn = wrapper.findAll(".garden-nav-btn")[1];
    expect(signinBtn.classes()).not.toContain("signed");
  });

  it("挂载时应调用 store.load()", async () => {
    const wrapper = mountComponent();
    await wrapper.vm.$nextTick();
    expect(storeMocks.load).toHaveBeenCalledTimes(1);
  });

  it("plantWheelMode=true 时根容器应有 .wheel-mode class", () => {
    storeMocks.plantWheelMode = true;
    const wrapper = mountComponent();
    expect(wrapper.find(".garden-frame").classes()).toContain("wheel-mode");
  });

  it("plantWheelMode=false 时根容器不应有 .wheel-mode class", () => {
    storeMocks.plantWheelMode = false;
    const wrapper = mountComponent();
    expect(wrapper.find(".garden-frame").classes()).not.toContain("wheel-mode");
  });

  it("应渲染 .garden-frame 根容器", () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".garden-frame").exists()).toBe(true);
  });
});
