import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

// Mock @tauri-apps/api/core（AIHelper 通过 api/ai 间接依赖）
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// ===== Mock @/api/ai =====
const aiGeneratePlanMock = vi.fn();
vi.mock("@/api/ai", () => ({
  aiGeneratePlan: (...args: unknown[]) => aiGeneratePlanMock(...args),
}));

import AIHelper from "../AIHelper.vue";

describe("AIHelper.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    invokeMock.mockReset();
    aiGeneratePlanMock.mockReset();
  });

  const mountComponent = (props: Record<string, unknown> = {}) =>
    mount(AIHelper, {
      props: { visible: true, ...props },
    });

  // ===== 可见性 =====

  it("visible=false 时不应渲染任何内容", () => {
    const wrapper = mountComponent({ visible: false });
    expect(wrapper.find(".ai-modal").exists()).toBe(false);
  });

  it("visible=true 时应渲染弹窗", () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".ai-modal").exists()).toBe(true);
  });

  // ===== 标题 + 关闭按钮 =====

  it("应显示标题『🤖 AI 规划助手』", () => {
    const wrapper = mountComponent();
    const title = wrapper.find(".ai-modal__title");
    expect(title.exists()).toBe(true);
    expect(title.text()).toBe("🤖 AI 规划助手");
  });

  it("应有关闭按钮（✕）", () => {
    const wrapper = mountComponent();
    const closeBtn = wrapper.find(".ai-modal__close");
    expect(closeBtn.exists()).toBe(true);
    expect(closeBtn.text()).toBe("✕");
  });

  // ===== 输入区 =====

  it("应有 textarea 输入框并带 placeholder", () => {
    const wrapper = mountComponent();
    const textarea = wrapper.find(".ai-input");
    expect(textarea.exists()).toBe(true);
    expect(textarea.attributes("placeholder")).toContain("工作或学习需求");
  });

  it("应有生成按钮", () => {
    const wrapper = mountComponent();
    const btn = wrapper.find(".ai-generate-btn");
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toContain("生成计划");
  });

  // ===== 按钮禁用逻辑 =====

  it("输入为空时生成按钮应禁用", () => {
    const wrapper = mountComponent();
    const btn = wrapper.find(".ai-generate-btn");
    expect(btn.attributes("disabled")).toBeDefined();
  });

  it("输入有内容时生成按钮应启用", async () => {
    const wrapper = mountComponent();
    await wrapper.find(".ai-input").setValue("复习高数");
    const btn = wrapper.find(".ai-generate-btn");
    expect(btn.attributes("disabled")).toBeUndefined();
  });

  it("仅有空格输入时生成按钮应禁用", async () => {
    const wrapper = mountComponent();
    await wrapper.find(".ai-input").setValue("   ");
    const btn = wrapper.find(".ai-generate-btn");
    expect(btn.attributes("disabled")).toBeDefined();
  });

  // ===== 生成行为 =====

  it("点击生成（空输入）应显示错误信息『请输入您的工作或学习需求』", async () => {
    // 直接调用 handleGenerate（通过输入空格后清空来模拟）
    // 但按钮在空输入时禁用，所以我们直接测试组件方法
    const wrapper = mountComponent();
    // 先输入一些内容使按钮启用，然后清空
    await wrapper.find(".ai-input").setValue("temp");
    await wrapper.find(".ai-input").setValue("");
    // 此时按钮禁用，但我们直接触发 handleGenerate
    await (wrapper.vm as unknown as { handleGenerate: () => Promise<void> }).handleGenerate();

    const error = wrapper.find(".ai-error");
    expect(error.exists()).toBe(true);
    expect(error.text()).toContain("请输入您的工作或学习需求");
  });

  it("点击生成（有输入）应调用 aiGeneratePlan", async () => {
    aiGeneratePlanMock.mockResolvedValue({
      success: true,
      data: { summary: "摘要", plan: [] },
    });

    const wrapper = mountComponent();
    await wrapper.find(".ai-input").setValue("复习高数");
    await wrapper.find(".ai-generate-btn").trigger("click");

    expect(aiGeneratePlanMock).toHaveBeenCalledWith("复习高数");
  });

  it("生成中按钮应显示『生成中...』", async () => {
    // 用一个未完成的 Promise 模拟加载中
    let resolveFn: (value: unknown) => void = () => {};
    aiGeneratePlanMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      }),
    );

    const wrapper = mountComponent();
    await wrapper.find(".ai-input").setValue("复习高数");
    await wrapper.find(".ai-generate-btn").trigger("click");

    expect(wrapper.find(".ai-generate-btn").text()).toContain("生成中...");
    // 也应显示加载提示
    expect(wrapper.find(".ai-loading").exists()).toBe(true);

    // 解决 Promise 以避免悬挂
    resolveFn({ success: true, data: { plan: [] } });
    await wrapper.vm.$nextTick();
  });

  it("生成成功 + 有 summary 时应显示 summary", async () => {
    aiGeneratePlanMock.mockResolvedValue({
      success: true,
      data: {
        summary: "这是一个复习计划",
        plan: [],
      },
    });

    const wrapper = mountComponent();
    await wrapper.find(".ai-input").setValue("复习高数");
    await wrapper.find(".ai-generate-btn").trigger("click");

    await wrapper.vm.$nextTick();

    const summary = wrapper.find(".ai-summary");
    expect(summary.exists()).toBe(true);
    expect(summary.text()).toContain("这是一个复习计划");
  });

  it("生成成功 + 有 plan items 时应显示编号列表", async () => {
    aiGeneratePlanMock.mockResolvedValue({
      success: true,
      data: {
        plan: [
          { type: "work", minutes: 25, description: "高数第一章" },
          { type: "break", minutes: 5 },
          { type: "work", minutes: 25, description: "高数第二章" },
        ],
      },
    });

    const wrapper = mountComponent();
    await wrapper.find(".ai-input").setValue("复习高数");
    await wrapper.find(".ai-generate-btn").trigger("click");

    await wrapper.vm.$nextTick();

    const items = wrapper.findAll(".ai-plan-item");
    expect(items).toHaveLength(3);

    // 编号
    const numbers = wrapper.findAll(".ai-plan-number");
    expect(numbers[0].text()).toBe("1");
    expect(numbers[1].text()).toBe("2");
    expect(numbers[2].text()).toBe("3");

    // 类型文字
    const types = wrapper.findAll(".ai-plan-type");
    expect(types[0].text()).toBe("工作");
    expect(types[1].text()).toBe("休息");

    // 分钟数
    const times = wrapper.findAll(".ai-plan-time");
    expect(times[0].text()).toContain("25");
    expect(times[1].text()).toContain("5");

    // 描述
    const descs = wrapper.findAll(".ai-plan-desc");
    expect(descs[0].text()).toBe("高数第一章");
  });

  it("plan item work 类型应显示 💼 图标", async () => {
    aiGeneratePlanMock.mockResolvedValue({
      success: true,
      data: { plan: [{ type: "work", minutes: 25 }] },
    });

    const wrapper = mountComponent();
    await wrapper.find(".ai-input").setValue("test");
    await wrapper.find(".ai-generate-btn").trigger("click");
    await wrapper.vm.$nextTick();

    const icon = wrapper.find(".ai-plan-icon");
    expect(icon.text()).toBe("💼");
  });

  it("plan item break 类型应显示 ☕ 图标", async () => {
    aiGeneratePlanMock.mockResolvedValue({
      success: true,
      data: { plan: [{ type: "break", minutes: 5 }] },
    });

    const wrapper = mountComponent();
    await wrapper.find(".ai-input").setValue("test");
    await wrapper.find(".ai-generate-btn").trigger("click");
    await wrapper.vm.$nextTick();

    const icon = wrapper.find(".ai-plan-icon");
    expect(icon.text()).toBe("☕");
  });

  it("有 plan 时应显示总时间", async () => {
    aiGeneratePlanMock.mockResolvedValue({
      success: true,
      data: {
        plan: [
          { type: "work", minutes: 25 },
          { type: "break", minutes: 5 },
          { type: "work", minutes: 25 },
        ],
      },
    });

    const wrapper = mountComponent();
    await wrapper.find(".ai-input").setValue("test");
    await wrapper.find(".ai-generate-btn").trigger("click");
    await wrapper.vm.$nextTick();

    const total = wrapper.find(".ai-total-time");
    expect(total.exists()).toBe(true);
    // 25 + 5 + 25 = 55 分钟
    expect(total.text()).toContain("55");
    expect(total.text()).toContain("分钟");
  });

  it("总时间超过 60 分钟时应显示小时+分钟", async () => {
    aiGeneratePlanMock.mockResolvedValue({
      success: true,
      data: {
        plan: [
          { type: "work", minutes: 50 },
          { type: "break", minutes: 10 },
          { type: "work", minutes: 25 },
        ],
      },
    });

    const wrapper = mountComponent();
    await wrapper.find(".ai-input").setValue("test");
    await wrapper.find(".ai-generate-btn").trigger("click");
    await wrapper.vm.$nextTick();

    const total = wrapper.find(".ai-total-time");
    // 50 + 10 + 25 = 85 分钟 = 1小时25分钟
    expect(total.text()).toContain("1");
    expect(total.text()).toContain("小时");
    expect(total.text()).toContain("25");
    expect(total.text()).toContain("分钟");
  });

  // ===== Apply 按钮 =====

  it("有 plan 时应显示应用按钮", async () => {
    aiGeneratePlanMock.mockResolvedValue({
      success: true,
      data: { plan: [{ type: "work", minutes: 25 }] },
    });

    const wrapper = mountComponent();
    await wrapper.find(".ai-input").setValue("test");
    await wrapper.find(".ai-generate-btn").trigger("click");
    await wrapper.vm.$nextTick();

    const applyBtn = wrapper.find(".ai-apply-btn");
    expect(applyBtn.exists()).toBe(true);
    expect(applyBtn.text()).toContain("应用到番茄钟");
  });

  it("点击应用按钮应 emit apply(plan) + close", async () => {
    const plan = [
      { type: "work" as const, minutes: 25, description: "任务1" },
      { type: "break" as const, minutes: 5 },
    ];
    aiGeneratePlanMock.mockResolvedValue({
      success: true,
      data: { plan },
    });

    const wrapper = mountComponent();
    await wrapper.find(".ai-input").setValue("test");
    await wrapper.find(".ai-generate-btn").trigger("click");
    await wrapper.vm.$nextTick();

    await wrapper.find(".ai-apply-btn").trigger("click");

    expect(wrapper.emitted("apply")).toBeTruthy();
    expect(wrapper.emitted("apply")![0]).toEqual([plan]);
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("无 plan 时不应显示应用按钮", async () => {
    aiGeneratePlanMock.mockResolvedValue({
      success: true,
      data: { plan: [] },
    });

    const wrapper = mountComponent();
    await wrapper.find(".ai-input").setValue("test");
    await wrapper.find(".ai-generate-btn").trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".ai-apply-btn").exists()).toBe(false);
  });

  // ===== 关闭行为 =====

  it("点击关闭按钮应 emit close", async () => {
    const wrapper = mountComponent();
    await wrapper.find(".ai-modal__close").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("点击遮罩层（非处理中）应 emit close", async () => {
    const wrapper = mountComponent();
    // 点击 .ai-modal 本身（不是内部 panel）
    await wrapper.find(".ai-modal").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("处理中时点击遮罩层不应 emit close", async () => {
    let resolveFn: (value: unknown) => void = () => {};
    aiGeneratePlanMock.mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      }),
    );

    const wrapper = mountComponent();
    await wrapper.find(".ai-input").setValue("test");
    await wrapper.find(".ai-generate-btn").trigger("click");

    // 处理中点击遮罩
    await wrapper.find(".ai-modal").trigger("click");
    expect(wrapper.emitted("close")).toBeFalsy();

    resolveFn({ success: true, data: { plan: [] } });
    await wrapper.vm.$nextTick();
  });

  // ===== Enter 键 =====

  it("按 Enter（无 Shift）应触发生成", async () => {
    aiGeneratePlanMock.mockResolvedValue({
      success: true,
      data: { plan: [] },
    });

    const wrapper = mountComponent();
    await wrapper.find(".ai-input").setValue("复习高数");
    await wrapper.find(".ai-input").trigger("keydown", {
      key: "Enter",
      shiftKey: false,
    });

    expect(aiGeneratePlanMock).toHaveBeenCalledWith("复习高数");
  });

  it("按 Shift+Enter 不应触发生成", async () => {
    aiGeneratePlanMock.mockResolvedValue({
      success: true,
      data: { plan: [] },
    });

    const wrapper = mountComponent();
    await wrapper.find(".ai-input").setValue("复习高数");
    await wrapper.find(".ai-input").trigger("keydown", {
      key: "Enter",
      shiftKey: true,
    });

    expect(aiGeneratePlanMock).not.toHaveBeenCalled();
  });

  // ===== 错误处理 =====

  it("生成失败（success=false）应显示后端返回的错误信息", async () => {
    aiGeneratePlanMock.mockResolvedValue({
      success: false,
      error: "API Key 无效",
    });

    const wrapper = mountComponent();
    await wrapper.find(".ai-input").setValue("test");
    await wrapper.find(".ai-generate-btn").trigger("click");
    await wrapper.vm.$nextTick();

    const error = wrapper.find(".ai-error");
    expect(error.exists()).toBe(true);
    expect(error.text()).toContain("API Key 无效");
  });

  it("生成抛错应显示网络错误信息", async () => {
    aiGeneratePlanMock.mockRejectedValue(new Error("network down"));

    const wrapper = mountComponent();
    await wrapper.find(".ai-input").setValue("test");
    await wrapper.find(".ai-generate-btn").trigger("click");
    await wrapper.vm.$nextTick();

    const error = wrapper.find(".ai-error");
    expect(error.exists()).toBe(true);
    expect(error.text()).toContain("网络错误");
  });

  it("生成完成后 isProcessing 应为 false（按钮恢复）", async () => {
    aiGeneratePlanMock.mockResolvedValue({
      success: true,
      data: { plan: [] },
    });

    const wrapper = mountComponent();
    await wrapper.find(".ai-input").setValue("test");
    await wrapper.find(".ai-generate-btn").trigger("click");
    await wrapper.vm.$nextTick();

    // 按钮文本应恢复为『生成计划』
    expect(wrapper.find(".ai-generate-btn").text()).toContain("生成计划");
    expect(wrapper.find(".ai-loading").exists()).toBe(false);
  });

  // ===== 空状态 =====

  it("初始无结果时应显示占位提示", () => {
    const wrapper = mountComponent();
    const placeholder = wrapper.find(".ai-placeholder");
    expect(placeholder.exists()).toBe(true);
    expect(placeholder.text()).toContain("输入您的需求");
  });
});
