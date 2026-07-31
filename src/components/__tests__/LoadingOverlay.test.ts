import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import LoadingOverlay from "../LoadingOverlay.vue";

describe("LoadingOverlay.vue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const mountComponent = (visible: boolean) =>
    mount(LoadingOverlay, {
      props: { visible },
    });

  it("visible=false 时不渲染遮罩层", () => {
    const wrapper = mountComponent(false);
    expect(wrapper.find(".loading-overlay").exists()).toBe(false);
  });

  it("visible=true 时渲染遮罩 + spinner + 标题 + 状态 + 进度条", () => {
    const wrapper = mountComponent(true);
    expect(wrapper.find(".loading-overlay").exists()).toBe(true);
    expect(wrapper.find(".loading-spinner").exists()).toBe(true);
    expect(wrapper.find(".loading-title").text()).toBe("番茄钟");
    expect(wrapper.find(".loading-status").exists()).toBe(true);
    expect(wrapper.find(".loading-progress-container").exists()).toBe(true);
    expect(wrapper.find(".loading-progress-bar").exists()).toBe(true);
  });

  it("初始状态显示 '正在启动...'", () => {
    const wrapper = mountComponent(true);
    expect(wrapper.find(".loading-status").text()).toBe("正在启动...");
  });

  it("进度条初始宽度为 0%", () => {
    const wrapper = mountComponent(true);
    const bar = wrapper.find(".loading-progress-bar");
    expect(bar.attributes("style")).toContain("width: 0%");
  });

  it("挂载后定时器应推进进度（fake timer）", async () => {
    const wrapper = mountComponent(true);
    // 推进 200ms 一次
    vi.advanceTimersByTime(200);
    await flushPromises();
    const bar = wrapper.find(".loading-progress-bar");
    expect(bar.attributes("style")).toContain("width: 10%");
  });

  it("进度达到 50 后状态文本变为 '正在加载...'", async () => {
    const wrapper = mountComponent(true);
    // 推进 5 次 200ms = 1000ms，progress 应达到 50
    vi.advanceTimersByTime(1000);
    await flushPromises();
    expect(wrapper.find(".loading-status").text()).toBe("正在加载...");
  });

  it("进度上限为 90（到达后停止增长）", async () => {
    const wrapper = mountComponent(true);
    // 推进 20 次 200ms = 4000ms，每次 +10 → 应到 90 后停止
    vi.advanceTimersByTime(4000);
    await flushPromises();
    const bar = wrapper.find(".loading-progress-bar");
    expect(bar.attributes("style")).toContain("width: 90%");
    // 再推进也不应超过 90
    vi.advanceTimersByTime(2000);
    await flushPromises();
    expect(bar.attributes("style")).toContain("width: 90%");
  });
});
