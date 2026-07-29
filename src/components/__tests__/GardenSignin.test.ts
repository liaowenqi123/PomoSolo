import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

// Mock garden store
const storeMocks = {
  data: {
    signIn: {
      lastDate: null as string | null,
      continuousDays: 0,
      totalDays: 0,
      weekRecords: [false, false, false, false, false, false, false],
    },
  },
  canSignInToday: true,
  signIn: vi.fn(),
  getNextMilestone: vi.fn((): number | null => null),
};

vi.mock("@/stores/garden", () => ({
  useGardenStore: () => storeMocks,
  CROP_CONFIG: {
    carrot: { name: "胡萝卜", growTime: 25, icon: "🥕", seedType: "carrot", rarity: "common", value: 10, seedPrice: 8, sellPrice: 10 },
    tomato: { name: "番茄", growTime: 50, icon: "🍅", seedType: "tomato", rarity: "common", value: 20, seedPrice: 16, sellPrice: 20 },
    sunflower: { name: "向日葵", growTime: 90, icon: "🌻", seedType: "sunflower", rarity: "rare", value: 50, seedPrice: 40, sellPrice: 50 },
    rose: { name: "玫瑰", growTime: 120, icon: "🌹", seedType: "rose", rarity: "rare", value: 80, seedPrice: 64, sellPrice: 80 },
    osmanthus: { name: "金桂树", growTime: 180, icon: "🌳", seedType: "osmanthus", rarity: "legend", value: 150, seedPrice: 120, sellPrice: 150 },
  },
  DAILY_REWARD: { seeds: { carrot: 1 }, coins: 5 },
  WEEKLY_REWARDS: {
    1: { seeds: { carrot: 2 }, coins: 0, message: "周一奖励" },
    2: { seeds: {}, coins: 10, message: "周二奖励" },
    3: { seeds: { tomato: 1 }, coins: 0, message: "周三奖励" },
    4: { seeds: {}, coins: 10, message: "周四奖励" },
    5: { seeds: { sunflower: 1 }, coins: 0, message: "周五奖励" },
    6: { seeds: {}, coins: 0, randomSeed: true, message: "周六随机奖励" },
    0: { seeds: {}, coins: 20, message: "周日奖励" },
  },
  CONTINUOUS_REWARDS: {
    3: { seeds: { tomato: 1 }, coins: 0, message: "连续签到3天！" },
    7: { seeds: { sunflower: 1 }, coins: 0, message: "连续签到7天！" },
    14: { seeds: { rose: 1 }, coins: 0, message: "连续签到14天！" },
    30: { seeds: { osmanthus: 1 }, coins: 0, message: "连续签到30天！" },
  },
}));

import GardenSignin from "../garden/GardenSignin.vue";

describe("GardenSignin.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    storeMocks.data.signIn = {
      lastDate: null,
      continuousDays: 0,
      totalDays: 0,
      weekRecords: [false, false, false, false, false, false, false],
    };
    storeMocks.canSignInToday = true;
    storeMocks.signIn.mockReset();
    storeMocks.signIn.mockResolvedValue(true);
    storeMocks.getNextMilestone.mockReset();
    storeMocks.getNextMilestone.mockReturnValue(null);
  });

  const mountComponent = (props: { visible: boolean }) => {
    return mount(GardenSignin, { props });
  };

  it("visible=false 时不应渲染任何内容", () => {
    const wrapper = mountComponent({ visible: false });
    expect(wrapper.find(".signin-modal").exists()).toBe(false);
  });

  it("visible=true 时应渲染签到弹窗", () => {
    const wrapper = mountComponent({ visible: true });
    expect(wrapper.find(".signin-modal").exists()).toBe(true);
  });

  it("应显示连续签到天数", () => {
    storeMocks.data.signIn.continuousDays = 5;
    const wrapper = mountComponent({ visible: true });
    const stats = wrapper.findAll(".signin-stat");
    expect(stats[0].find(".signin-stat__value").text()).toBe("5");
    expect(stats[0].find(".signin-stat__label").text()).toBe("连续签到");
  });

  it("应显示累计签到天数", () => {
    storeMocks.data.signIn.totalDays = 12;
    const wrapper = mountComponent({ visible: true });
    const stats = wrapper.findAll(".signin-stat");
    expect(stats[1].find(".signin-stat__value").text()).toBe("12");
    expect(stats[1].find(".signin-stat__label").text()).toBe("累计签到");
  });

  it("应渲染 7 个签到圆点", () => {
    const wrapper = mountComponent({ visible: true });
    expect(wrapper.findAll(".signin-dot")).toHaveLength(7);
  });

  it("今天对应的圆点应有 .today class", () => {
    const wrapper = mountComponent({ visible: true });
    const dots = wrapper.findAll(".signin-dot");
    const todayIdx = new Date().getDay();
    // weekDots 重排序: [一, 二, 三, 四, 五, 六, 日] 对应索引 [1,2,3,4,5,6,0]
    const order = [1, 2, 3, 4, 5, 6, 0];
    const todayIdxInOrder = order.indexOf(todayIdx);
    expect(dots[todayIdxInOrder].classes()).toContain("today");
  });

  it("已签到的圆点应有 .signed class", () => {
    // 第 1 天 (周一) 已签到
    storeMocks.data.signIn.weekRecords = [false, true, false, false, false, false, false];
    const wrapper = mountComponent({ visible: true });
    const dots = wrapper.findAll(".signin-dot");
    // weekDots 重排序: [一, 二, 三, 四, 五, 六, 日] 对应索引 [1,2,3,4,5,6,0]
    // 周一在第一位（order[0]=1）
    expect(dots[0].classes()).toContain("signed");
    expect(dots[1].classes()).not.toContain("signed");
  });

  it("已签到的圆点应显示 ✓", () => {
    storeMocks.data.signIn.weekRecords = [false, true, false, false, false, false, false];
    const wrapper = mountComponent({ visible: true });
    const dots = wrapper.findAll(".signin-dot");
    expect(dots[0].find(".signin-dot__mark").text()).toBe("✓");
  });

  it("未签到的圆点应显示 ·", () => {
    const wrapper = mountComponent({ visible: true });
    const dots = wrapper.findAll(".signin-dot");
    expect(dots[0].find(".signin-dot__mark").text()).toBe("·");
  });

  it("今日奖励列表应包含 DAILY_REWARD 中的种子和金币", () => {
    const wrapper = mountComponent({ visible: true });
    const rewardItems = wrapper.findAll(".signin-reward-item");
    // DAILY_REWARD: carrot x1 + coins x5
    const texts = rewardItems.map((r) => r.find(".signin-reward-item__text").text());
    expect(texts).toContain("胡萝卜种子 x1");
    expect(texts.some((t) => t.includes("金币 x5"))).toBe(true);
  });

  it("今日奖励列表应包含 WEEKLY_REWARDS[today]", () => {
    const wrapper = mountComponent({ visible: true });
    const rewardItems = wrapper.findAll(".signin-reward-item");
    const today = new Date().getDay();
    const todayReward = ({
      1: "胡萝卜种子 x2",
      2: "金币 x10",
      3: "番茄种子 x1",
      4: "金币 x10",
      5: "向日葵种子 x1",
      6: "随机种子礼包 x1",
      0: "金币 x20",
    } as const)[today];
    const texts = rewardItems.map((r) => r.find(".signin-reward-item__text").text());
    expect(texts).toContain(todayReward);
  });

  it("当 getNextMilestone 返回非空时奖励列表应包含里程碑奖励", () => {
    storeMocks.getNextMilestone.mockReturnValue(3);
    // CONTINUOUS_REWARDS[3] = { seeds: { tomato: 1 } }
    const wrapper = mountComponent({ visible: true });
    const rewardItems = wrapper.findAll(".signin-reward-item");
    const texts = rewardItems.map((r) => r.find(".signin-reward-item__text").text());
    expect(texts.some((t) => t.includes("连续3天") && t.includes("番茄种子 x1"))).toBe(true);
  });

  it("当 canSign=true 时按钮显示『✅ 立即签到』且可点击", () => {
    storeMocks.canSignInToday = true;
    const wrapper = mountComponent({ visible: true });
    const btn = wrapper.find(".signin-confirm-btn");
    expect(btn.text()).toBe("✅ 立即签到");
    expect(btn.attributes("disabled")).toBeUndefined();
  });

  it("当 canSign=false 时按钮显示『今日已签到』且 disabled", () => {
    storeMocks.canSignInToday = false;
    const wrapper = mountComponent({ visible: true });
    const btn = wrapper.find(".signin-confirm-btn");
    expect(btn.text()).toBe("今日已签到");
    expect(btn.attributes("disabled")).toBeDefined();
  });

  it("点击签到按钮（canSign=true）应调用 store.signIn", async () => {
    storeMocks.canSignInToday = true;
    const wrapper = mountComponent({ visible: true });
    const btn = wrapper.find(".signin-confirm-btn");
    await btn.trigger("click");
    expect(storeMocks.signIn).toHaveBeenCalledTimes(1);
  });

  it("canSign=false 时点击按钮不应调用 store.signIn", async () => {
    storeMocks.canSignInToday = false;
    const wrapper = mountComponent({ visible: true });
    const btn = wrapper.find(".signin-confirm-btn");
    await btn.trigger("click");
    expect(storeMocks.signIn).not.toHaveBeenCalled();
  });

  it("点击遮罩 (target===currentTarget) 应 emit close", async () => {
    const wrapper = mountComponent({ visible: true });
    const modal = wrapper.find(".signin-modal");
    await modal.trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("点击 close 按钮应 emit close", async () => {
    const wrapper = mountComponent({ visible: true });
    const closeBtn = wrapper.find(".signin-modal__close");
    await closeBtn.trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("点击 panel 内部不应 emit close", async () => {
    const wrapper = mountComponent({ visible: true });
    const panel = wrapper.find(".signin-modal__panel");
    await panel.trigger("click");
    expect(wrapper.emitted("close")).toBeFalsy();
  });

  it("标题应显示『📅 每日签到』", () => {
    const wrapper = mountComponent({ visible: true });
    expect(wrapper.find(".signin-modal__title").text()).toBe("📅 每日签到");
  });
});
