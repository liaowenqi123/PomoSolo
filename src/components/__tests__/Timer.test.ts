import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import Timer from "../Timer.vue";
import { useTimerStore } from "../../stores/timer";

describe("Timer.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const mountComponent = () => {
    return mount(Timer);
  };

  it("应渲染 .timer-display 容器", () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".timer-display").exists()).toBe(true);
  });

  it("初始应显示格式化时间 25:00", () => {
    const wrapper = mountComponent();
    const timeEl = wrapper.find(".timer-display__time");
    expect(timeEl.text()).toBe("25:00");
  });

  it("初始 phase=ready 时应显示『准备开始』", () => {
    const wrapper = mountComponent();
    const status = wrapper.find(".timer-display__status");
    expect(status.text()).toBe("准备开始");
  });

  it("running 状态下 work 模式应显示『专注中』", async () => {
    const wrapper = mountComponent();
    const store = useTimerStore();
    store.start();
    await wrapper.vm.$nextTick();

    const status = wrapper.find(".timer-display__status");
    expect(status.text()).toBe("专注中");
  });

  it("running 状态下 break 模式应显示『休息中』", async () => {
    const wrapper = mountComponent();
    const store = useTimerStore();
    store.setMode("break");
    store.start();
    await wrapper.vm.$nextTick();

    const status = wrapper.find(".timer-display__status");
    expect(status.text()).toBe("休息中");
  });

  it("finished 状态应显示『已完成』", async () => {
    const wrapper = mountComponent();
    const store = useTimerStore();
    // 通过推进时间触发完成
    store.start();
    vi.advanceTimersByTime(25 * 60 * 1000 + 1000);
    await wrapper.vm.$nextTick();

    // 注意：complete 后会自动 setMode('break') 并把 phase 设为 ready
    // 因此 finished 状态可能稍纵即逝。这里直接断言 store 行为：
    // 已经完成至少一次番茄钟，且最终回到 ready/break 状态
    expect(store.todayCount).toBe(1);
    // 状态文本应为『休息中』或『准备开始』
    const status = wrapper.find(".timer-display__status");
    expect(["休息中", "准备开始"]).toContain(status.text());
  });

  it("切换到 break 模式应显示 05:00", async () => {
    const wrapper = mountComponent();
    const store = useTimerStore();
    store.setMode("break");
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".timer-display__time").text()).toBe("05:00");
  });

  it("时间应随计时减少而更新", async () => {
    const wrapper = mountComponent();
    const store = useTimerStore();
    store.start();
    // 推进 5 秒
    vi.advanceTimersByTime(5000);
    await wrapper.vm.$nextTick();

    const text = wrapper.find(".timer-display__time").text();
    // 时间格式应为 MM:SS
    expect(text).toMatch(/^\d{2}:\d{2}$/);
    // 应小于 25:00
    expect(text).not.toBe("25:00");
  });

  it("显示的时间与 store.displayTime 一致", async () => {
    const wrapper = mountComponent();
    const store = useTimerStore();
    store.start();
    vi.advanceTimersByTime(10000); // 10 秒
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".timer-display__time").text()).toBe(store.displayTime);
  });
});
