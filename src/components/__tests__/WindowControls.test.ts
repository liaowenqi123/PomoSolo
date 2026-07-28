import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

// Mock ../../api/window 模块，避免依赖 Tauri 运行时
const minimizeWindowMock = vi.fn();
const closeWindowMock = vi.fn();

vi.mock("../../api/window", () => ({
  minimizeWindow: (...args: unknown[]) => minimizeWindowMock(...args),
  closeWindow: (...args: unknown[]) => closeWindowMock(...args),
}));

import WindowControls from "../WindowControls.vue";

describe("WindowControls.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    minimizeWindowMock.mockReset();
    closeWindowMock.mockReset();
    // 默认解析为成功
    minimizeWindowMock.mockResolvedValue(undefined);
    closeWindowMock.mockResolvedValue(undefined);
  });

  const mountComponent = () => mount(WindowControls);

  it("应渲染两个按钮（最小化 + 关闭）", () => {
    const wrapper = mountComponent();
    const buttons = wrapper.findAll("button");
    expect(buttons).toHaveLength(2);
  });

  it("最小化按钮应包含正确的 title 与类名", () => {
    const wrapper = mountComponent();
    const minimizeBtn = wrapper.findAll("button")[0];
    expect(minimizeBtn.attributes("title")).toBe("最小化");
    expect(minimizeBtn.classes()).toContain("window-controls__btn");
    expect(minimizeBtn.classes()).toContain("window-controls__btn--minimize");
  });

  it("关闭按钮应包含正确的 title 与类名", () => {
    const wrapper = mountComponent();
    const closeBtn = wrapper.findAll("button")[1];
    expect(closeBtn.attributes("title")).toBe("关闭");
    expect(closeBtn.classes()).toContain("window-controls__btn");
    expect(closeBtn.classes()).toContain("window-controls__btn--close");
  });

  it("点击最小化按钮应调用 minimizeWindow()", async () => {
    const wrapper = mountComponent();
    const minimizeBtn = wrapper.findAll("button")[0];
    await minimizeBtn.trigger("click");
    await wrapper.vm.$nextTick();

    expect(minimizeWindowMock).toHaveBeenCalledTimes(1);
    expect(minimizeWindowMock).toHaveBeenCalledWith();
  });

  it("点击关闭按钮应调用 closeWindow()", async () => {
    const wrapper = mountComponent();
    const closeBtn = wrapper.findAll("button")[1];
    await closeBtn.trigger("click");
    await wrapper.vm.$nextTick();

    expect(closeWindowMock).toHaveBeenCalledTimes(1);
    expect(closeWindowMock).toHaveBeenCalledWith();
  });

  it("minimizeWindow 失败时应被捕获（console.warn）且不抛错", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    minimizeWindowMock.mockRejectedValue(new Error("minimize failed"));

    const wrapper = mountComponent();
    const minimizeBtn = wrapper.findAll("button")[0];

    // 不应 reject
    await expect(minimizeBtn.trigger("click")).resolves.toBeUndefined();
    await wrapper.vm.$nextTick();
    // 等微任务完成
    await Promise.resolve();
    await Promise.resolve();

    expect(minimizeWindowMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    const warnArgs = warnSpy.mock.calls[0];
    expect(warnArgs[0]).toContain("minimizeWindow 失败");
    warnSpy.mockRestore();
  });

  it("closeWindow 失败时应被捕获（console.warn）且不抛错", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    closeWindowMock.mockRejectedValue(new Error("close failed"));

    const wrapper = mountComponent();
    const closeBtn = wrapper.findAll("button")[1];

    await expect(closeBtn.trigger("click")).resolves.toBeUndefined();
    await wrapper.vm.$nextTick();
    await Promise.resolve();
    await Promise.resolve();

    expect(closeWindowMock).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    const warnArgs = warnSpy.mock.calls[0];
    expect(warnArgs[0]).toContain("closeWindow 失败");
    warnSpy.mockRestore();
  });

  it("两个按钮都应包含 svg 图标", () => {
    const wrapper = mountComponent();
    const buttons = wrapper.findAll("button");
    expect(buttons[0].find("svg").exists()).toBe(true);
    expect(buttons[1].find("svg").exists()).toBe(true);
  });

  it("根元素应包含 window-controls 类名", () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".window-controls").exists()).toBe(true);
  });
});
