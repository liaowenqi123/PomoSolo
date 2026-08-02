import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

// Mock @tauri-apps/api/core（garden store 间接依赖）
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import PunishmentResultModal from "../PunishmentResultModal.vue";
import type { PunishmentResult } from "@/api/garden";

describe("PunishmentResultModal.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({});
  });

  const mountComponent = (props: Record<string, unknown> = {}) =>
    mount(PunishmentResultModal, {
      props: { visible: false, result: null, ...props },
    });

  // ===== 基础渲染 =====

  it("visible=false 时不渲染内容", () => {
    const wrapper = mountComponent({ visible: false });
    expect(wrapper.find(".punishment-content").exists()).toBe(false);
  });

  it("visible=true 时标题应为『🌱 专注模式已中断』", () => {
    const wrapper = mountComponent({ visible: true, result: null });
    expect(wrapper.find(".modal-title").text()).toBe("🌱 专注模式已中断");
  });

  // ===== 有损失 =====

  const lossResult: PunishmentResult = {
    hasLoss: true,
    losses: [
      { crop: "carrot", name: "胡萝卜", icon: "🥕", progress: 10, growTime: 25 },
      { crop: "tomato", name: "番茄", icon: "🍅", progress: 22, growTime: 50 },
    ],
    totalMinutes: 32,
  };

  it("有损失时显示损失列表（图标/名称/生长进度）", () => {
    const wrapper = mountComponent({ visible: true, result: lossResult });
    const items = wrapper.findAll(".punishment-loss-item");
    expect(items.length).toBe(2);
    expect(items[0].find(".loss-icon").text()).toBe("🥕");
    expect(items[0].find(".loss-name").text()).toBe("胡萝卜");
    expect(items[0].find(".loss-time").text()).toContain("已生长 10/25 分钟");
    expect(items[1].find(".loss-name").text()).toBe("番茄");
  });

  it("有损失时显示总损失分钟", () => {
    const wrapper = mountComponent({ visible: true, result: lossResult });
    expect(wrapper.find(".total-value").text()).toContain("32 分钟心血");
  });

  it("有损失时不显示『幸好没有正在生长的作物』", () => {
    const wrapper = mountComponent({ visible: true, result: lossResult });
    expect(wrapper.find(".punishment-no-loss").exists()).toBe(false);
  });

  it("超过 3 株时聚合为摘要并显示总数", () => {
    const many: PunishmentResult = {
      hasLoss: true,
      losses: [
        { crop: "carrot", name: "胡萝卜", icon: "🥕", progress: 1, growTime: 25 },
        { crop: "carrot", name: "胡萝卜", icon: "🥕", progress: 2, growTime: 25 },
        { crop: "tomato", name: "番茄", icon: "🍅", progress: 3, growTime: 50 },
        { crop: "rose", name: "玫瑰", icon: "🌹", progress: 4, growTime: 120 },
        { crop: "rose", name: "玫瑰", icon: "🌹", progress: 5, growTime: 120 },
      ],
      totalMinutes: 15,
    };
    const wrapper = mountComponent({ visible: true, result: many });
    // 摘要聚合：2 胡萝卜 + 1 番茄 + 2 玫瑰 = 3 组
    const summaryItems = wrapper.findAll(".punishment-summary-item");
    expect(summaryItems.length).toBe(3);
    expect(wrapper.find(".punishment-summary-text").text()).toContain("共 5 株作物枯萎");
    // 不显示完整列表
    expect(wrapper.findAll(".punishment-loss-item").length).toBe(0);
  });

  // ===== 无损失 =====

  it("无损失时显示『幸好没有正在生长的作物』", () => {
    const wrapper = mountComponent({
      visible: true,
      result: { hasLoss: false, losses: [], totalMinutes: 0 },
    });
    expect(wrapper.find(".punishment-no-loss").exists()).toBe(true);
    expect(wrapper.find(".punishment-no-loss").text()).toContain("幸好没有正在生长的作物");
    // 不显示损失列表与总分钟
    expect(wrapper.find(".punishment-loss-list").exists()).toBe(false);
    expect(wrapper.find(".punishment-total").exists()).toBe(false);
  });

  it("result=null 时按无损失处理", () => {
    const wrapper = mountComponent({ visible: true, result: null });
    expect(wrapper.find(".punishment-no-loss").exists()).toBe(true);
  });

  // ===== 交互 =====

  it("点击『知道了』应 emit update:visible(false)", async () => {
    const wrapper = mountComponent({ visible: true, result: lossResult });
    const okBtn = wrapper.findAll("button").find((b) => b.text() === "知道了");
    expect(okBtn).toBeTruthy();
    await okBtn!.trigger("click");
    const updates = wrapper.emitted("update:visible");
    expect(updates).toBeTruthy();
    expect(updates?.[0]?.[0]).toBe(false);
  });
});
