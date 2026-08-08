import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { reactive } from "vue";
import { buildTutorialCards } from "../garden/gardenTutorial";
import type { GardenState } from "@/stores/garden";

function baseState(): GardenState {
  return {
    coins: 0,
    seeds: {},
    crops: {},
    plots: [],
    warehouse: [],
    signIn: { lastDate: null, continuousDays: 0, totalDays: 0, weekRecords: [] },
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
  };
}

function unlockedKeys(s: GardenState): string[] {
  return buildTutorialCards()
    .filter((c) => c.unlocked(s))
    .map((c) => c.key);
}

describe("gardenTutorial 渐进解锁", () => {
  it("默认解锁 3 项：认识菜园 / 种植 / 商店", () => {
    expect(unlockedKeys(baseState()).sort()).toEqual(["intro", "plant", "shop"]);
  });

  it("种下一株作物后解锁「生长阶段」", () => {
    const s = baseState();
    s.achievementStats.totalPlantCount = 1;
    expect(unlockedKeys(s)).toContain("stage");
  });

  it("第一次收获后解锁「收获」「解锁土地」", () => {
    const s = baseState();
    s.achievementStats.totalHarvestCount = 1;
    expect(unlockedKeys(s)).toEqual(expect.arrayContaining(["harvest", "unlock"]));
  });

  it("完成番茄钟（历史最高连击≥1）解锁「专注连击」", () => {
    const s = baseState();
    s.combo!.best = 1;
    expect(unlockedKeys(s)).toContain("combo");
  });

  it("有枯萎作物时解锁「枯萎与救活」", () => {
    const s = baseState();
    s.plots = [{ id: 0, crop: "carrot", progress: 10, plantedAt: "x", wilted: true }];
    expect(unlockedKeys(s)).toContain("wilt");
  });

  it("累计专注 25 分钟解锁「枯萎与救活」「每日生长配额」", () => {
    const s = baseState();
    s.achievementStats.totalFocusMinutes = 25;
    expect(unlockedKeys(s)).toEqual(expect.arrayContaining(["wilt", "cap"]));
  });

  it("签到一次后解锁「每日签到与成就」", () => {
    const s = baseState();
    s.signIn.totalDays = 1;
    expect(unlockedKeys(s)).toContain("signin");
  });

  it("段位 Lv1 或连续签到 3 天解锁「段位与微黄」", () => {
    const s1 = baseState();
    s1.tier!.current = 1;
    expect(unlockedKeys(s1)).toContain("tier");

    const s2 = baseState();
    s2.signIn.continuousDays = 3;
    expect(unlockedKeys(s2)).toContain("tier");
  });

  it("解锁隐藏彩蛋成就后解锁「隐藏彩蛋」", () => {
    const s = baseState();
    s.achievements = { easteregg: { unlocked: true, unlockedAt: "2026-08-08" } };
    expect(unlockedKeys(s)).toContain("egg");
  });

  it("卡片覆盖菜园子全部设计（12 项）且 key 唯一", () => {
    const cards = buildTutorialCards();
    expect(cards).toHaveLength(12);
    expect(new Set(cards.map((c) => c.key)).size).toBe(12);
  });
});

// ===== 组件渲染 =====

// 顶层 mock（vi.mock 会被提升，factory 惰性执行，此时 storeMocks 已初始化）
// data 用 reactive 包装，保证"store 状态更新后解锁进度实时变化"可测
const storeMocks: { data: GardenState } = { data: reactive(baseState()) as GardenState };

vi.mock("@/stores/garden", () => ({
  useGardenStore: () => storeMocks,
}));

vi.mock("../Modal.vue", () => ({
  default: {
    name: "ModalStub",
    props: ["visible"],
    emits: ["update:visible"],
    template:
      '<div v-if="visible" class="modal-stub"><slot /><slot name="footer" /></div>',
  },
}));

describe("GardenTutorial.vue", () => {
  beforeEach(() => {
    // 原地重置（保持同一 reactive 引用，响应式追踪不断）
    Object.assign(storeMocks.data, baseState());
  });

  async function mountTutorial() {
    const mod = await import("../garden/GardenTutorial.vue");
    return mount(mod.default, { props: { visible: true } });
  }

  it("渲染 12 张卡片，已解锁卡片显示图标、锁定卡片显示 🔒 与解锁提示", async () => {
    // 默认状态：3 张解锁
    const wrapper = await mountTutorial();
    const cards = wrapper.findAll(".tutorial-card");
    expect(cards).toHaveLength(12);

    const locked = wrapper.findAll(".tutorial-card.locked");
    expect(locked).toHaveLength(9);
    expect(locked[0].text()).toContain("🔒");
    // 解锁提示文案存在
    expect(locked[0].find(".tutorial-card__hint").text()).toBeTruthy();

    // 进度文案
    expect(wrapper.find(".tutorial-progress__text").text()).toContain("已解锁 3 / 12");
  });

  it("点击已解锁卡片展开详情，再次点击收起", async () => {
    const wrapper = await mountTutorial();
    const introCard = wrapper
      .findAll(".tutorial-card.unlocked")
      .find((c) => c.find(".tutorial-card__title").text() === "认识菜园")!;
    expect(introCard.find(".tutorial-card__details").exists()).toBe(false);
    await introCard.trigger("click");
    const details = introCard.find(".tutorial-card__details");
    expect(details.exists()).toBe(true);
    // 详情覆盖设计内容
    expect(details.text()).toContain("菜园不是主菜");
    await introCard.trigger("click");
    expect(introCard.find(".tutorial-card__details").exists()).toBe(false);
  });

  it("点击锁定卡片不展开详情", async () => {
    const wrapper = await mountTutorial();
    const lockedCard = wrapper.find(".tutorial-card.locked");
    await lockedCard.trigger("click");
    expect(wrapper.find(".tutorial-card__details").exists()).toBe(false);
  });

  it("store 状态更新后解锁进度实时变化", async () => {
    const wrapper = await mountTutorial();
    expect(wrapper.find(".tutorial-progress__text").text()).toContain("3 / 12");
    // 模拟完成一次种植 + 收获 + 一个番茄钟
    storeMocks.data.achievementStats.totalPlantCount = 1;
    storeMocks.data.achievementStats.totalHarvestCount = 1;
    storeMocks.data.combo!.best = 1;
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".tutorial-progress__text").text()).not.toContain("3 / 12");
  });
});
