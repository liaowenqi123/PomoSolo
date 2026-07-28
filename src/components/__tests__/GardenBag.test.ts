import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

// Mock garden store
const storeMocks = {
  seeds: {} as Record<string, number>,
  crops: {} as Record<string, number>,
  selectedSeed: null as string | null,
  selectSeed: vi.fn(),
};

vi.mock("@/stores/garden", () => ({
  useGardenStore: () => storeMocks,
  CROP_CONFIG: {
    carrot: { name: "胡萝卜", growTime: 25, icon: "🥕", seedType: "carrot", rarity: "common", value: 10, seedPrice: 8, sellPrice: 10 },
    tomato: { name: "番茄", growTime: 50, icon: "🍅", seedType: "tomato", rarity: "common", value: 20, seedPrice: 16, sellPrice: 20 },
    sunflower: { name: "向日葵", growTime: 90, icon: "🌻", seedType: "sunflower", rarity: "rare", value: 50, seedPrice: 40, sellPrice: 50 },
  },
  CROP_ORDER: ["carrot", "tomato", "sunflower"],
}));

import GardenBag from "../garden/GardenBag.vue";

describe("GardenBag.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    storeMocks.seeds = { carrot: 5, tomato: 0, sunflower: 2 };
    storeMocks.crops = {};
    storeMocks.selectedSeed = null;
    storeMocks.selectSeed.mockReset();
  });

  const mountComponent = (props: { showSeedSelection?: boolean } = {}) => {
    return mount(GardenBag, { props });
  };

  it("showSeedSelection=true 时应渲染种子区域", () => {
    const wrapper = mountComponent({ showSeedSelection: true });
    // 有两个 bag-section：种子 + 作物
    const sections = wrapper.findAll(".bag-section");
    expect(sections.length).toBeGreaterThanOrEqual(2);
    // 第一个 section 标题是『🌱 种子』
    expect(sections[0].find(".bag-section__title").text()).toBe("🌱 种子");
  });

  it("showSeedSelection=false 时不应渲染种子区域", () => {
    const wrapper = mountComponent({ showSeedSelection: false });
    const sections = wrapper.findAll(".bag-section");
    // 只剩作物 section
    expect(sections.length).toBe(1);
    expect(sections[0].find(".bag-section__title").text()).toBe("🌾 作物");
  });

  it("不传 showSeedSelection 时默认不显示种子区域", () => {
    const wrapper = mountComponent();
    const sections = wrapper.findAll(".bag-section");
    expect(sections.length).toBe(1);
  });

  it("种子按 CROP_ORDER 顺序渲染", () => {
    const wrapper = mountComponent({ showSeedSelection: true });
    const seedItems = wrapper.findAll(".seed-item");
    expect(seedItems).toHaveLength(3);
    // 第一个是胡萝卜
    expect(seedItems[0].find(".seed-item__name").text()).toBe("胡萝卜种子");
    // 第二个是番茄
    expect(seedItems[1].find(".seed-item__name").text()).toBe("番茄种子");
    // 第三个是向日葵
    expect(seedItems[2].find(".seed-item__name").text()).toBe("向日葵种子");
  });

  it("种子应显示 x{count}", () => {
    const wrapper = mountComponent({ showSeedSelection: true });
    const seedItems = wrapper.findAll(".seed-item");
    expect(seedItems[0].find(".seed-item__count").text()).toBe("x5");
    expect(seedItems[1].find(".seed-item__count").text()).toBe("x0");
    expect(seedItems[2].find(".seed-item__count").text()).toBe("x2");
  });

  it("count=0 的种子应有 .disabled class", () => {
    const wrapper = mountComponent({ showSeedSelection: true });
    const seedItems = wrapper.findAll(".seed-item");
    expect(seedItems[1].classes()).toContain("disabled");
    expect(seedItems[0].classes()).not.toContain("disabled");
  });

  it("点击 count>0 的种子应调用 store.selectSeed", async () => {
    const wrapper = mountComponent({ showSeedSelection: true });
    const seedItems = wrapper.findAll(".seed-item");
    await seedItems[0].trigger("click"); // carrot, count=5
    expect(storeMocks.selectSeed).toHaveBeenCalledTimes(1);
    expect(storeMocks.selectSeed).toHaveBeenCalledWith("carrot");
  });

  it("点击 count=0 的种子不应调用 store.selectSeed", async () => {
    const wrapper = mountComponent({ showSeedSelection: true });
    const seedItems = wrapper.findAll(".seed-item");
    await seedItems[1].trigger("click"); // tomato, count=0
    expect(storeMocks.selectSeed).not.toHaveBeenCalled();
  });

  it("selectedSeed 对应的种子应有 .selected class", () => {
    storeMocks.selectedSeed = "carrot";
    const wrapper = mountComponent({ showSeedSelection: true });
    const seedItems = wrapper.findAll(".seed-item");
    expect(seedItems[0].classes()).toContain("selected");
    expect(seedItems[1].classes()).not.toContain("selected");
  });

  it("作物背包空时应显示『暂无收获的作物』", () => {
    storeMocks.crops = {};
    const wrapper = mountComponent();
    expect(wrapper.find(".bag-empty").text()).toBe("暂无收获的作物");
  });

  it("作物背包有作物时应渲染作物列表", () => {
    storeMocks.crops = { carrot: 3, tomato: 1 };
    const wrapper = mountComponent();
    const cropItems = wrapper.findAll(".crop-item");
    expect(cropItems).toHaveLength(2);
    // 检查胡萝卜
    const carrotItem = cropItems.find((c) => c.find(".crop-item__name").text() === "胡萝卜");
    expect(carrotItem).toBeDefined();
    expect(carrotItem!.find(".crop-item__count").text()).toBe("x3");
  });

  it("作物列表只显示 count>0 的作物", () => {
    storeMocks.crops = { carrot: 0, tomato: 2, sunflower: 5 };
    const wrapper = mountComponent();
    const cropItems = wrapper.findAll(".crop-item");
    expect(cropItems).toHaveLength(2); // tomato + sunflower
    // carrot (count=0) 不应出现
    const names = cropItems.map((c) => c.find(".crop-item__name").text());
    expect(names).not.toContain("胡萝卜");
    expect(names).toContain("番茄");
    expect(names).toContain("向日葵");
  });

  it("作物图标应正确显示", () => {
    storeMocks.crops = { carrot: 1 };
    const wrapper = mountComponent();
    const cropItem = wrapper.find(".crop-item");
    expect(cropItem.find(".crop-item__icon").text()).toBe("🥕");
  });
});
