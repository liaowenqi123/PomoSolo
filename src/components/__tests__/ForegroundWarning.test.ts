import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

// Mock @tauri-apps/api/core
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// Mock @tauri-apps/api/event
const listenMock = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

import ForegroundWarning from "../ForegroundWarning.vue";
import type { DetectionResult } from "@/api/foreground";

describe("ForegroundWarning.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    invokeMock.mockReset();
    listenMock.mockReset();
    // listen 默认返回 unlisten 函数
    listenMock.mockResolvedValue(vi.fn());
  });

  const mountComponent = (props: Record<string, unknown> = {}) =>
    mount(ForegroundWarning, {
      props: { visible: false, ...props },
    });

  // ===== 事件监听注册 =====

  it("挂载时应注册 foreground-entertainment-detected 事件监听", async () => {
    mountComponent();
    await flushPromises();

    const eventNames = listenMock.mock.calls.map((c) => c[0]);
    expect(eventNames).toContain("foreground-entertainment-detected");
  });

  // ===== active prop（奖惩机制激活状态）=====

  it("active=false 时收到娱乐事件不应弹窗（迟到广播忽略）", async () => {
    const wrapper = mountComponent({ visible: false, active: false });
    await flushPromises();

    const detectedHandler = listenMock.mock.calls.find(
      (c) => c[0] === "foreground-entertainment-detected",
    )?.[1] as ((e: { payload: DetectionResult }) => void) | undefined;

    detectedHandler?.({
      payload: {
        windowTitle: "bilibili - 在线视频",
        isEntertainment: true,
        source: "ai",
        keyword: "",
      },
    });
    await flushPromises();

    // 不应 emit update:visible(true)
    const updates = wrapper.emitted("update:visible");
    expect(updates).toBeFalsy();
  });

  it("active=true 时收到娱乐事件应弹窗", async () => {
    const wrapper = mountComponent({ visible: false, active: true });
    await flushPromises();

    const detectedHandler = listenMock.mock.calls.find(
      (c) => c[0] === "foreground-entertainment-detected",
    )?.[1] as ((e: { payload: DetectionResult }) => void) | undefined;

    detectedHandler?.({
      payload: {
        windowTitle: "原神",
        isEntertainment: true,
        source: "blacklist",
        keyword: "原神",
      },
    });
    await flushPromises();

    const updates = wrapper.emitted("update:visible");
    expect(updates).toBeTruthy();
    expect(updates?.[0]?.[0]).toBe(true);
  });

  it("挂载时应注册 foreground-api-key-invalid 事件监听", async () => {
    mountComponent();
    await flushPromises();

    const eventNames = listenMock.mock.calls.map((c) => c[0]);
    expect(eventNames).toContain("foreground-api-key-invalid");
  });

  it("应注册 2 个事件监听", async () => {
    mountComponent();
    await flushPromises();

    expect(listenMock).toHaveBeenCalledTimes(2);
  });

  // ===== 主警告弹窗渲染 =====

  it("visible=false 时主警告弹窗不渲染内容", () => {
    const wrapper = mountComponent({ visible: false });
    expect(wrapper.find(".warning-content").exists()).toBe(false);
  });

  it("visible=true 时主警告弹窗标题应为『⚠️ 检测到娱乐窗口』", () => {
    const wrapper = mountComponent({ visible: true });
    const title = wrapper.find(".modal-title");
    expect(title.exists()).toBe(true);
    expect(title.text()).toBe("⚠️ 检测到娱乐窗口");
  });

  it("visible=true 时应显示警告文字", () => {
    const wrapper = mountComponent({ visible: true });
    const text = wrapper.find(".warning-text");
    expect(text.exists()).toBe(true);
    expect(text.text()).toContain("娱乐类应用");
  });

  // ===== 窗口标题显示 =====

  it("有 lastResult 时应显示窗口标题", async () => {
    const wrapper = mountComponent({ visible: true });
    // 通过事件触发设置 lastResult
    await flushPromises();

    const detectedHandler = listenMock.mock.calls.find(
      (c) => c[0] === "foreground-entertainment-detected",
    )?.[1] as ((e: { payload: DetectionResult }) => void) | undefined;

    // 组件已 visible=true，handleEntertainmentDetected 会 return（不重复弹出）
    // 所以先设为 false，触发事件后再 setProps
    await wrapper.setProps({ visible: false });
    detectedHandler?.({
      payload: {
        windowTitle: "Bilibili - 在线视频",
        isEntertainment: true,
        source: "ai",
        keyword: "bilibili",
      },
    });
    await wrapper.setProps({ visible: true });
    await flushPromises();

    const windowEl = wrapper.find(".warning-window");
    expect(windowEl.exists()).toBe(true);
    expect(windowEl.text()).toContain("Bilibili - 在线视频");
  });

  it("visible 从外部置为 true 但无 lastResult 时应使用占位『未知窗口』", async () => {
    const wrapper = mountComponent({ visible: false });
    await flushPromises();

    // 直接 setProps visible=true（无事件触发）
    await wrapper.setProps({ visible: true });
    await flushPromises();

    const windowEl = wrapper.find(".warning-window");
    expect(windowEl.exists()).toBe(true);
    expect(windowEl.text()).toContain("未知窗口");
  });

  // ===== 警告次数显示 =====

  it("应显示警告次数 {warningCount+1} / {maxWarnings}", async () => {
    const wrapper = mountComponent({ visible: true, maxWarnings: 3 });
    await flushPromises();

    const count = wrapper.find(".warning-count");
    expect(count.exists()).toBe(true);
    // 初始 warningCount=0，显示 1 / 3
    expect(count.text()).toContain("1");
    expect(count.text()).toContain("3");
  });

  it("maxWarnings 默认应为 3", async () => {
    const wrapper = mountComponent({ visible: true });
    await flushPromises();

    const count = wrapper.find(".warning-count");
    expect(count.text()).toContain("3");
  });

  it("maxWarnings 可自定义", async () => {
    const wrapper = mountComponent({ visible: true, maxWarnings: 5 });
    await flushPromises();

    const count = wrapper.find(".warning-count");
    expect(count.text()).toContain("5");
  });

  // ===== 惩罚提示 =====

  it("warningCount+1 < maxWarnings 时不显示惩罚提示", async () => {
    const wrapper = mountComponent({ visible: true, maxWarnings: 3 });
    await flushPromises();

    // 初始 warningCount=0，1 < 3
    expect(wrapper.find(".warning-punishment-hint").exists()).toBe(false);
  });

  it("warningCount+1 >= maxWarnings 时应显示惩罚提示", async () => {
    const wrapper = mountComponent({ visible: true, maxWarnings: 3 });
    await flushPromises();

    // 点击 2 次"知道了"使 warningCount=2，此时 2+1=3 >= 3
    const dismissBtn = wrapper.findAll("button").find((b) => b.text() === "知道了");
    await dismissBtn!.trigger("click");
    // visible 被置 false，需重新设为 true
    await wrapper.setProps({ visible: true });

    await dismissBtn!.trigger("click");
    await wrapper.setProps({ visible: true });

    // 现在 warningCount=2，显示 3/3 和惩罚提示
    expect(wrapper.find(".warning-punishment-hint").exists()).toBe(true);
    expect(wrapper.find(".warning-punishment-hint").text()).toContain("惩罚");
  });

  // ===== "知道了" 按钮行为 =====

  it("点击『知道了』应 emit dismiss + update:visible(false)", async () => {
    const wrapper = mountComponent({ visible: true });
    await flushPromises();

    const dismissBtn = wrapper.findAll("button").find((b) => b.text() === "知道了");
    await dismissBtn!.trigger("click");

    expect(wrapper.emitted("dismiss")).toBeTruthy();
    const updateEvents = wrapper.emitted("update:visible");
    expect(updateEvents).toBeTruthy();
    expect(updateEvents![updateEvents!.length - 1]).toEqual([false]);
  });

  it("点击『知道了』应增加 warningCount", async () => {
    const wrapper = mountComponent({ visible: true, maxWarnings: 5 });
    await flushPromises();

    const dismissBtn = wrapper.findAll("button").find((b) => b.text() === "知道了");
    await dismissBtn!.trigger("click");
    await wrapper.setProps({ visible: true });

    // warningCount 从 0 增加到 1，显示 2/5
    const count = wrapper.find(".warning-count");
    expect(count.text()).toContain("2");
  });

  it("达到 maxWarnings 时点击『知道了』应 emit punishment 并重置 warningCount", async () => {
    const wrapper = mountComponent({ visible: true, maxWarnings: 3 });
    await flushPromises();

    const dismissBtn = wrapper.findAll("button").find((b) => b.text() === "知道了");

    // 第 1 次
    await dismissBtn!.trigger("click");
    await wrapper.setProps({ visible: true });
    // 第 2 次
    await dismissBtn!.trigger("click");
    await wrapper.setProps({ visible: true });
    // 第 3 次 → 达到 maxWarnings=3
    await dismissBtn!.trigger("click");

    expect(wrapper.emitted("punishment")).toBeTruthy();

    // 重置后 warningCount=0，重新打开应显示 1/3
    await wrapper.setProps({ visible: true });
    const count = wrapper.find(".warning-count");
    expect(count.text()).toContain("1");
  });

  it("未达到 maxWarnings 时点击『知道了』不应 emit punishment", async () => {
    const wrapper = mountComponent({ visible: true, maxWarnings: 3 });
    await flushPromises();

    const dismissBtn = wrapper.findAll("button").find((b) => b.text() === "知道了");
    await dismissBtn!.trigger("click");

    expect(wrapper.emitted("punishment")).toBeFalsy();
  });

  // ===== "不是娱乐" 按钮行为 =====

  it("点击『不是娱乐』应 emit not-entertainment + update:visible(false)", async () => {
    const wrapper = mountComponent({ visible: true });
    await flushPromises();

    // 先设置 lastResult
    await wrapper.setProps({ visible: false });
    await flushPromises();

    // 触发事件以设置 lastResult
    const detectedHandler = listenMock.mock.calls.find(
      (c) => c[0] === "foreground-entertainment-detected",
    )?.[1] as ((e: { payload: DetectionResult }) => void) | undefined;

    const fakeResult: DetectionResult = {
      windowTitle: "VSCode",
      isEntertainment: false,
      source: "ai",
      keyword: "",
    };
    detectedHandler?.({ payload: fakeResult });
    await wrapper.setProps({ visible: true });
    await flushPromises();

    const notEntBtn = wrapper
      .findAll("button")
      .find((b) => b.text() === "不是娱乐");
    await notEntBtn!.trigger("click");

    expect(wrapper.emitted("not-entertainment")).toBeTruthy();
    expect(wrapper.emitted("not-entertainment")![0]).toEqual([fakeResult]);
    const updateEvents = wrapper.emitted("update:visible");
    expect(updateEvents).toBeTruthy();
    expect(updateEvents![updateEvents!.length - 1]).toEqual([false]);
  });

  it("点击『不是娱乐』不应增加 warningCount", async () => {
    const wrapper = mountComponent({ visible: true, maxWarnings: 5 });
    await flushPromises();

    const notEntBtn = wrapper
      .findAll("button")
      .find((b) => b.text() === "不是娱乐");
    await notEntBtn!.trigger("click");
    await wrapper.setProps({ visible: true });

    // warningCount 仍为 0，显示 1/5
    const count = wrapper.find(".warning-count");
    expect(count.text()).toContain("1");
  });

  // ===== API Key 错误弹窗 =====

  it("API Key 错误弹窗标题应为『🔑 API Key 错误』", async () => {
    const wrapper = mountComponent({ visible: false });
    await flushPromises();

    // 触发 API Key 失效事件
    const apiKeyHandler = listenMock.mock.calls.find(
      (c) => c[0] === "foreground-api-key-invalid",
    )?.[1] as ((e: { payload: { error?: string } }) => void) | undefined;

    apiKeyHandler?.({ payload: { error: "无效的 Key" } });
    await flushPromises();

    // 应有两个 Modal，第二个是 API Key 错误弹窗
    const titles = wrapper.findAll(".modal-title");
    const apiKeyTitle = titles.find((t) => t.text().includes("API Key"));
    expect(apiKeyTitle).toBeTruthy();
    expect(apiKeyTitle!.text()).toBe("🔑 API Key 错误");
  });

  it("API Key 错误弹窗应显示 apiKeyErrorMessage", async () => {
    const wrapper = mountComponent({ visible: false });
    await flushPromises();

    const apiKeyHandler = listenMock.mock.calls.find(
      (c) => c[0] === "foreground-api-key-invalid",
    )?.[1] as ((e: { payload: { error?: string } }) => void) | undefined;

    apiKeyHandler?.({ payload: { error: "API Key 已过期" } });
    await flushPromises();

    const msg = wrapper.find(".api-key-error-message");
    expect(msg.exists()).toBe(true);
    expect(msg.text()).toBe("API Key 已过期");
  });

  it("API Key 失效事件 payload 无 error 字段时应显示默认消息", async () => {
    const wrapper = mountComponent({ visible: false });
    await flushPromises();

    const apiKeyHandler = listenMock.mock.calls.find(
      (c) => c[0] === "foreground-api-key-invalid",
    )?.[1] as ((e: { payload: { error?: string } }) => void) | undefined;

    apiKeyHandler?.({ payload: {} });
    await flushPromises();

    const msg = wrapper.find(".api-key-error-message");
    expect(msg.text()).toContain("API Key");
  });

  it("API Key 失效应 emit api-key-invalid 事件", async () => {
    const wrapper = mountComponent({ visible: false });
    await flushPromises();

    const apiKeyHandler = listenMock.mock.calls.find(
      (c) => c[0] === "foreground-api-key-invalid",
    )?.[1] as ((e: { payload: { error?: string } }) => void) | undefined;

    apiKeyHandler?.({ payload: { error: "Key invalid" } });
    await flushPromises();

    expect(wrapper.emitted("api-key-invalid")).toBeTruthy();
    expect(wrapper.emitted("api-key-invalid")![0]).toEqual(["Key invalid"]);
  });

  it("API Key 错误弹窗点击『知道了』应关闭弹窗", async () => {
    const wrapper = mountComponent({ visible: false });
    await flushPromises();

    const apiKeyHandler = listenMock.mock.calls.find(
      (c) => c[0] === "foreground-api-key-invalid",
    )?.[1] as ((e: { payload: { error?: string } }) => void) | undefined;

    apiKeyHandler?.({ payload: { error: "无效" } });
    await flushPromises();

    // 弹窗显示
    expect(wrapper.find(".api-key-error-message").exists()).toBe(true);

    // 点击知道了（在 API Key 弹窗的 footer 中）
    const buttons = wrapper.findAll("button");
    const okBtn = buttons.find((b) => {
      // 找到 API Key 弹窗中的"知道了"按钮
      const parent = b.element.closest(".api-key-error-message");
      // 通过文本和位置判断：API Key 弹窗的按钮在最后一个 Modal 中
      return b.text() === "知道了" && b.element.closest(".modal-container");
    });
    // 更简单的方式：找到所有"知道了"按钮，API Key 弹窗的应该是最后一个
    const knowBtns = buttons.filter((b) => b.text() === "知道了");
    // 主弹窗不可见时只有 API Key 弹窗的按钮
    expect(knowBtns.length).toBeGreaterThanOrEqual(1);
    await knowBtns[knowBtns.length - 1].trigger("click");
    await flushPromises();

    // 弹窗关闭
    expect(wrapper.find(".api-key-error-message").exists()).toBe(false);
  });

  it("API Key 错误弹窗应显示配置提示", async () => {
    const wrapper = mountComponent({ visible: false });
    await flushPromises();

    const apiKeyHandler = listenMock.mock.calls.find(
      (c) => c[0] === "foreground-api-key-invalid",
    )?.[1] as ((e: { payload: { error?: string } }) => void) | undefined;

    apiKeyHandler?.({ payload: { error: "无效" } });
    await flushPromises();

    const hint = wrapper.find(".api-key-error-hint");
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toContain("DeepSeek API Key");
  });

  // ===== defineExpose =====

  it("应暴露 resetWarningCount 方法", async () => {
    const wrapper = mountComponent({ visible: true, maxWarnings: 3 });
    await flushPromises();

    const vm = wrapper.vm as unknown as {
      resetWarningCount: () => void;
      refreshListeners: () => void;
    };

    expect(typeof vm.resetWarningCount).toBe("function");

    // 先增加 warningCount
    const dismissBtn = wrapper
      .findAll("button")
      .find((b) => b.text() === "知道了");
    await dismissBtn!.trigger("click");
    await wrapper.setProps({ visible: true });

    // 确认 warningCount 已增加（显示 2/3）
    expect(wrapper.find(".warning-count").text()).toContain("2");

    // 重置
    vm.resetWarningCount();
    await wrapper.vm.$nextTick();

    // 应恢复到 1/3
    expect(wrapper.find(".warning-count").text()).toContain("1");
  });

  it("应暴露 refreshListeners 方法", async () => {
    const wrapper = mountComponent();
    await flushPromises();

    const vm = wrapper.vm as unknown as {
      resetWarningCount: () => void;
      refreshListeners: () => void;
    };

    expect(typeof vm.refreshListeners).toBe("function");
  });

  // ===== 事件触发检测 → 显示弹窗 =====

  it("foreground-entertainment-detected 事件应触发 update:visible(true)", async () => {
    const wrapper = mountComponent({ visible: false });
    await flushPromises();

    const detectedHandler = listenMock.mock.calls.find(
      (c) => c[0] === "foreground-entertainment-detected",
    )?.[1] as ((e: { payload: DetectionResult }) => void) | undefined;

    expect(detectedHandler).toBeDefined();

    detectedHandler?.({
      payload: {
        windowTitle: "游戏窗口",
        isEntertainment: true,
        source: "blacklist",
        keyword: "game",
      },
    });

    const updateEvents = wrapper.emitted("update:visible");
    expect(updateEvents).toBeTruthy();
    expect(updateEvents![0]).toEqual([true]);
  });

  it("已 visible 时收到检测事件不应重复触发", async () => {
    const wrapper = mountComponent({ visible: true });
    await flushPromises();

    const detectedHandler = listenMock.mock.calls.find(
      (c) => c[0] === "foreground-entertainment-detected",
    )?.[1] as ((e: { payload: DetectionResult }) => void) | undefined;

    detectedHandler?.({
      payload: {
        windowTitle: "新窗口",
        isEntertainment: true,
        source: "ai",
        keyword: "",
      },
    });

    // 不应再次 emit update:visible(true)
    const updateEvents = wrapper.emitted("update:visible");
    const trueEvents = updateEvents?.filter((e) => e[0] === true) ?? [];
    expect(trueEvents.length).toBe(0);
  });

  // ===== 卸载时清理监听 =====

  it("卸载时应调用 unlisten 清理监听", async () => {
    const unlisten1 = vi.fn();
    const unlisten2 = vi.fn();
    listenMock
      .mockResolvedValueOnce(unlisten1)
      .mockResolvedValueOnce(unlisten2);

    const wrapper = mountComponent();
    await flushPromises();

    wrapper.unmount();

    expect(unlisten1).toHaveBeenCalled();
    expect(unlisten2).toHaveBeenCalled();
  });
});
