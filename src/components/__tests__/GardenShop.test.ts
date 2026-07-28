import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

// Mock garden store
const storeMocks = {
  coins: 0,
  crops: {} as Record<string, number>,
  buySeed: vi.fn(),
  sellCrop: vi.fn(),
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

import GardenShop from "../garden/GardenShop.vue";

describe("GardenShop.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    storeMocks.coins = 0;
    storeMocks.crops = {};
    storeMocks.buySeed.mockReset();
    storeMocks.buySeed.mockResolvedValue(true);
    storeMocks.sellCrop.mockReset();
    storeMocks.sellCrop.mockResolvedValue(true);
  });

  const mountComponent = (props: { visible: boolean }) => {
    return mount(GardenShop, { props });
  };

  it("visible=false 时不应渲染任何内容", () => {
    const wrapper = mountComponent({ visible: false });
    expect(wrapper.find(".shop-modal").exists()).toBe(false);
  });

  it("visible=true 时应渲染商店弹窗", () => {
    const wrapper = mountComponent({ visible: true });
    expect(wrapper.find(".shop-modal").exists()).toBe(true);
  });

  it("header 应显示当前金币", () => {
    storeMocks.coins = 250;
    const wrapper = mountComponent({ visible: true });
    expect(wrapper.find(".shop-modal__coins").text()).toContain("250");
  });

  it("应有『购买种子』和『出售作物』两个 tab", () => {
    const wrapper = mountComponent({ visible: true });
    const tabs = wrapper.findAll(".shop-tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0].text()).toBe("购买种子");
    expect(tabs[1].text()).toBe("出售作物");
  });

  it("默认应激活购买 tab", () => {
    const wrapper = mountComponent({ visible: true });
    const tabs = wrapper.findAll(".shop-tab");
    expect(tabs[0].classes()).toContain("active");
    expect(tabs[1].classes()).not.toContain("active");
  });

  it("点击 tab 应切换激活状态", async () => {
    const wrapper = mountComponent({ visible: true });
    const tabs = wrapper.findAll(".shop-tab");
    await tabs[1].trigger("click");
    expect(tabs[1].classes()).toContain("active");
    expect(tabs[0].classes()).not.toContain("active");
  });

  it("购买 tab 应列出所有 CROP_CONFIG 的作物", () => {
    const wrapper = mountComponent({ visible: true });
    const shopItems = wrapper.findAll(".shop-panel .shop-item");
    expect(shopItems).toHaveLength(3);
  });

  it("购买 tab 应显示种子价格", () => {
    const wrapper = mountComponent({ visible: true });
    const shopItems = wrapper.findAll(".shop-panel .shop-item");
    // carrot seedPrice=8
    expect(shopItems[0].find(".shop-item__price").text()).toBe("💰 8");
  });

  it("金币不足时按钮应显示『金币不足』且 disabled", () => {
    storeMocks.coins = 5; // < carrot seedPrice=8
    const wrapper = mountComponent({ visible: true });
    const btn = wrapper.findAll(".shop-panel .shop-item")[0].find(".shop-item__btn");
    expect(btn.text()).toBe("金币不足");
    expect(btn.attributes("disabled")).toBeDefined();
  });

  it("金币足够时按钮应显示『购买』且可点击", () => {
    storeMocks.coins = 100;
    const wrapper = mountComponent({ visible: true });
    const btn = wrapper.findAll(".shop-panel .shop-item")[0].find(".shop-item__btn");
    expect(btn.text()).toBe("购买");
    expect(btn.attributes("disabled")).toBeUndefined();
  });

  it("点击购买按钮应调用 store.buySeed(key, 1)", async () => {
    storeMocks.coins = 100;
    const wrapper = mountComponent({ visible: true });
    const btn = wrapper.findAll(".shop-panel .shop-item")[0].find(".shop-item__btn");
    await btn.trigger("click");
    expect(storeMocks.buySeed).toHaveBeenCalledWith("carrot", 1);
  });

  it("出售 tab 在背包空时应显示『暂无可出售的作物』", async () => {
    storeMocks.crops = {};
    const wrapper = mountComponent({ visible: true });
    const tabs = wrapper.findAll(".shop-tab");
    await tabs[1].trigger("click");

    // 第二个 .shop-panel 是出售 tab
    const sellPanel = wrapper.findAll(".shop-panel")[1];
    expect(sellPanel.find(".shop-empty").text()).toBe("暂无可出售的作物");
  });

  it("出售 tab 应列出拥有的作物", async () => {
    storeMocks.crops = { carrot: 2, tomato: 1 };
    const wrapper = mountComponent({ visible: true });
    const tabs = wrapper.findAll(".shop-tab");
    await tabs[1].trigger("click");

    // 第二个 .shop-panel 是出售 tab
    const sellPanel = wrapper.findAll(".shop-panel")[1];
    const sellItems = sellPanel.findAll(".shop-item");
    expect(sellItems).toHaveLength(2);
    // carrot 显示 拥有: x2
    const carrotItem = sellItems.find((s) => s.find(".shop-item__name").text() === "胡萝卜");
    expect(carrotItem).toBeDefined();
    expect(carrotItem!.find(".shop-item__info").text()).toContain("x2");
  });

  it("出售 tab 只显示 count>0 的作物", async () => {
    storeMocks.crops = { carrot: 0, tomato: 1 };
    const wrapper = mountComponent({ visible: true });
    const tabs = wrapper.findAll(".shop-tab");
    await tabs[1].trigger("click");

    const sellPanel = wrapper.findAll(".shop-panel")[1];
    const sellItems = sellPanel.findAll(".shop-item");
    expect(sellItems).toHaveLength(1);
    expect(sellItems[0].find(".shop-item__name").text()).toBe("番茄");
  });

  it("点击出售按钮应调用 store.sellCrop(key, 1)", async () => {
    storeMocks.crops = { carrot: 2 };
    const wrapper = mountComponent({ visible: true });
    const tabs = wrapper.findAll(".shop-tab");
    await tabs[1].trigger("click");

    const sellPanel = wrapper.findAll(".shop-panel")[1];
    const btn = sellPanel.find(".shop-item__btn");
    await btn.trigger("click");
    expect(storeMocks.sellCrop).toHaveBeenCalledWith("carrot", 1);
  });

  it("点击遮罩 (target===currentTarget) 应 emit close", async () => {
    const wrapper = mountComponent({ visible: true });
    const modal = wrapper.find(".shop-modal");
    await modal.trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("点击 close 按钮应 emit close", async () => {
    const wrapper = mountComponent({ visible: true });
    const closeBtn = wrapper.find(".shop-modal__close");
    await closeBtn.trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("点击 panel 内部不应 emit close", async () => {
    const wrapper = mountComponent({ visible: true });
    const panel = wrapper.find(".shop-modal__panel");
    await panel.trigger("click");
    expect(wrapper.emitted("close")).toBeFalsy();
  });
});
