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

  it("应渲染 .time-display 容器", () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".time-display").exists()).toBe(true);
  });

  it("初始应显示格式化时间 25:00", () => {
    const wrapper = mountComponent();
    const timeEl = wrapper.find(".time-display");
    expect(timeEl.text()).toBe("25:00");
  });

  it("切换到 break 模式应显示 05:00", async () => {
    const wrapper = mountComponent();
    const store = useTimerStore();
    store.setMode("break");
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".time-display").text()).toBe("05:00");
  });

  it("时间应随计时减少而更新", async () => {
    const wrapper = mountComponent();
    const store = useTimerStore();
    store.start();
    // 推进 5 秒
    vi.advanceTimersByTime(5000);
    await wrapper.vm.$nextTick();

    const text = wrapper.find(".time-display").text();
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

    expect(wrapper.find(".time-display").text()).toBe(store.displayTime);
  });

  it("完成后应增加 todayCount 并切换到 break 模式显示 05:00", async () => {
    const wrapper = mountComponent();
    const store = useTimerStore();
    // 通过推进时间触发完成
    store.start();
    vi.advanceTimersByTime(25 * 60 * 1000 + 1000);
    await wrapper.vm.$nextTick();

    // complete 后会自动 setMode('break') 并把 phase 设为 ready
    expect(store.todayCount).toBe(1);
    expect(store.mode).toBe("break");
    // 时间应显示 break 模式的初始时间
    expect(wrapper.find(".time-display").text()).toBe("05:00");
  });
});
