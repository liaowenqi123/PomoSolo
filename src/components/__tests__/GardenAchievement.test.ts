import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

// Mock garden store
const storeMocks = {
  data: {
    achievements: {} as Record<string, { unlocked: boolean; unlockedAt: string }>,
  },
  unlockedAchievementCount: 0,
  totalAchievementCount: 25,
  getAchievementProgress: vi.fn(() => 0),
};

vi.mock("@/stores/garden", () => ({
  useGardenStore: () => storeMocks,
  ACHIEVEMENT_CATEGORIES: [
    { key: "all", label: "全部" },
    { key: "focus", label: "专注" },
    { key: "harvest", label: "收获" },
    { key: "hidden", label: "隐藏" },
  ],
  ACHIEVEMENT_CONFIG: {
    focus1h: {
      id: "focus1h",
      category: "focus",
      name: "初心者",
      description: "累计专注 1 小时",
      target: 60,
      icon: "⏱️",
      rewards: { seeds: { carrot: 3 }, coins: 10 },
    },
    harvest1: {
      id: "harvest1",
      category: "harvest",
      name: "初次丰收",
      description: "收获 1 个作物",
      target: 1,
      icon: "🌾",
      rewards: { seeds: {}, coins: 5 },
    },
    easteregg: {
      id: "easteregg",
      category: "hidden",
      name: "发现彩蛋",
      description: "？？？",
      target: 1,
      icon: "🥚",
      rewards: { seeds: {}, coins: 50 },
    },
  },
  CROP_CONFIG: {
    carrot: { name: "胡萝卜", growTime: 25, icon: "🥕", seedType: "carrot", rarity: "common", value: 10, seedPrice: 8, sellPrice: 10 },
  },
}));

import GardenAchievement from "../garden/GardenAchievement.vue";

describe("GardenAchievement.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    storeMocks.data.achievements = {};
    storeMocks.unlockedAchievementCount = 0;
    storeMocks.totalAchievementCount = 25;
    storeMocks.getAchievementProgress.mockReset();
    storeMocks.getAchievementProgress.mockReturnValue(0);
  });

  const mountComponent = (props: { visible: boolean }) => {
    return mount(GardenAchievement, { props });
  };

  it("visible=false 时不应渲染任何内容", () => {
    const wrapper = mountComponent({ visible: false });
    expect(wrapper.find(".achievement-modal").exists()).toBe(false);
  });

  it("visible=true 时应渲染成就墙弹窗", () => {
    const wrapper = mountComponent({ visible: true });
    expect(wrapper.find(".achievement-modal").exists()).toBe(true);
  });

  it("应显示『已解锁 {unlocked} / {total}』统计", () => {
    storeMocks.unlockedAchievementCount = 7;
    storeMocks.totalAchievementCount = 25;
    const wrapper = mountComponent({ visible: true });
    const summary = wrapper.find(".achievement-summary").text();
    expect(summary).toContain("已解锁");
    expect(summary).toContain("7");
    expect(summary).toContain("25");
  });

  it("应渲染所有分类 tab", () => {
    const wrapper = mountComponent({ visible: true });
    const tabs = wrapper.findAll(".achievement-tab");
    expect(tabs).toHaveLength(4);
    expect(tabs[0].text()).toBe("全部");
    expect(tabs[1].text()).toBe("专注");
    expect(tabs[2].text()).toBe("收获");
    expect(tabs[3].text()).toBe("隐藏");
  });

  it("默认激活『全部』分类 tab", () => {
    const wrapper = mountComponent({ visible: true });
    const tabs = wrapper.findAll(".achievement-tab");
    expect(tabs[0].classes()).toContain("active");
  });

  it("点击分类 tab 应切换激活状态", async () => {
    const wrapper = mountComponent({ visible: true });
    const tabs = wrapper.findAll(".achievement-tab");
    await tabs[1].trigger("click"); // focus
    expect(tabs[1].classes()).toContain("active");
    expect(tabs[0].classes()).not.toContain("active");
  });

  it("『全部』分类应显示所有成就", () => {
    const wrapper = mountComponent({ visible: true });
    expect(wrapper.findAll(".achievement-item")).toHaveLength(3);
  });

  it("『focus』分类应只显示 focus 类成就", async () => {
    const wrapper = mountComponent({ visible: true });
    const tabs = wrapper.findAll(".achievement-tab");
    await tabs[1].trigger("click"); // focus

    const items = wrapper.findAll(".achievement-item");
    expect(items).toHaveLength(1);
    expect(items[0].find(".achievement-item__name").text()).toBe("初心者");
  });

  it("『harvest』分类应只显示 harvest 类成就", async () => {
    const wrapper = mountComponent({ visible: true });
    const tabs = wrapper.findAll(".achievement-tab");
    await tabs[2].trigger("click"); // harvest

    const items = wrapper.findAll(".achievement-item");
    expect(items).toHaveLength(1);
    expect(items[0].find(".achievement-item__name").text()).toBe("初次丰收");
  });

  it("『hidden』分类应只显示 hidden 类成就", async () => {
    const wrapper = mountComponent({ visible: true });
    const tabs = wrapper.findAll(".achievement-tab");
    await tabs[3].trigger("click"); // hidden

    const items = wrapper.findAll(".achievement-item");
    expect(items).toHaveLength(1);
    expect(items[0].find(".achievement-item__name").text()).toBe("发现彩蛋");
  });

  it("每个成就应显示图标", () => {
    const wrapper = mountComponent({ visible: true });
    const items = wrapper.findAll(".achievement-item");
    expect(items[0].find(".achievement-item__icon").text()).toBe("⏱️");
  });

  it("每个成就应显示名称、描述", () => {
    const wrapper = mountComponent({ visible: true });
    const items = wrapper.findAll(".achievement-item");
    expect(items[0].find(".achievement-item__name").text()).toBe("初心者");
    expect(items[0].find(".achievement-item__desc").text()).toBe("累计专注 1 小时");
  });

  it("每个成就应显示进度文本 {progress}/{target}", () => {
    storeMocks.getAchievementProgress.mockReturnValue(15);
    const wrapper = mountComponent({ visible: true });
    const items = wrapper.findAll(".achievement-item");
    // focus1h target=60, progress=15
    expect(items[0].find(".achievement-progress-text").text()).toBe("15/60");
  });

  it("进度条宽度应等于 progress/target*100", () => {
    storeMocks.getAchievementProgress.mockReturnValue(30);
    const wrapper = mountComponent({ visible: true });
    const items = wrapper.findAll(".achievement-item");
    // focus1h: 30/60 = 50%
    const fill = items[0].find(".achievement-progress-fill");
    expect(fill.attributes("style")).toContain("width: 50%");
  });

  it("进度条应封顶 100%", () => {
    storeMocks.getAchievementProgress.mockReturnValue(100); // 100/60 = 166%
    const wrapper = mountComponent({ visible: true });
    const items = wrapper.findAll(".achievement-item");
    const fill = items[0].find(".achievement-progress-fill");
    expect(fill.attributes("style")).toContain("width: 100%");
  });

  it("进度为 0 时进度条宽度为 0%", () => {
    storeMocks.getAchievementProgress.mockReturnValue(0);
    const wrapper = mountComponent({ visible: true });
    const items = wrapper.findAll(".achievement-item");
    const fill = items[0].find(".achievement-progress-fill");
    expect(fill.attributes("style")).toContain("width: 0%");
  });

  it("每个成就应显示奖励", () => {
    const wrapper = mountComponent({ visible: true });
    const items = wrapper.findAll(".achievement-item");
    // focus1h rewards: carrot x3, coins x10
    const rewards = items[0].findAll(".achievement-reward");
    const rewardTexts = rewards.map((r) => r.text());
    expect(rewardTexts.some((t) => t.includes("🥕") && t.includes("x3"))).toBe(true);
    expect(rewardTexts.some((t) => t.includes("💰") && t.includes("x10"))).toBe(true);
  });

  it("已解锁成就应有 .unlocked class", () => {
    storeMocks.data.achievements = { focus1h: { unlocked: true, unlockedAt: "2025-01-01" } };
    const wrapper = mountComponent({ visible: true });
    const items = wrapper.findAll(".achievement-item");
    expect(items[0].classes()).toContain("unlocked");
  });

  it("已解锁成就应显示 ✓ badge", () => {
    storeMocks.data.achievements = { focus1h: { unlocked: true, unlockedAt: "2025-01-01" } };
    const wrapper = mountComponent({ visible: true });
    const items = wrapper.findAll(".achievement-item");
    expect(items[0].find(".achievement-item__badge").exists()).toBe(true);
    expect(items[0].find(".achievement-item__badge").text()).toBe("✓");
  });

  it("未解锁成就不应显示 ✓ badge", () => {
    storeMocks.data.achievements = {};
    const wrapper = mountComponent({ visible: true });
    const items = wrapper.findAll(".achievement-item");
    expect(items[0].find(".achievement-item__badge").exists()).toBe(false);
  });

  it("点击遮罩 (target===currentTarget) 应 emit close", async () => {
    const wrapper = mountComponent({ visible: true });
    const modal = wrapper.find(".achievement-modal");
    await modal.trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("点击 close 按钮应 emit close", async () => {
    const wrapper = mountComponent({ visible: true });
    const closeBtn = wrapper.find(".achievement-modal__close");
    await closeBtn.trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("点击 panel 内部不应 emit close", async () => {
    const wrapper = mountComponent({ visible: true });
    const panel = wrapper.find(".achievement-modal__panel");
    await panel.trigger("click");
    expect(wrapper.emitted("close")).toBeFalsy();
  });

  it("标题应显示『🏆 成就墙』", () => {
    const wrapper = mountComponent({ visible: true });
    expect(wrapper.find(".achievement-modal__title").text()).toBe("🏆 成就墙");
  });
});
