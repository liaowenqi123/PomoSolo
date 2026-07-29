import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import { nextTick } from "vue";
import ModeSlider from "../ModeSlider.vue";
import { useTimerStore } from "../../stores/timer";

describe("ModeSlider.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  const mountComponent = () => mount(ModeSlider);

  it("应渲染三个模式标签（单次/计划/正向）", () => {
    const wrapper = mountComponent();
    const labels = wrapper.findAll(".mode-label");
    expect(labels).toHaveLength(3);
    expect(labels[0].text()).toBe("单次");
    expect(labels[1].text()).toBe("计划");
    expect(labels[2].text()).toBe("正向");
  });

  it("初始 appMode 应为 single，『单次』标签 active", () => {
    const wrapper = mountComponent();
    const store = useTimerStore();
    expect(store.appMode).toBe("single");

    const labels = wrapper.findAll(".mode-label");
    expect(labels[0].classes()).toContain("active");
    expect(labels[1].classes()).not.toContain("active");
    expect(labels[2].classes()).not.toContain("active");
  });

  it("点击『计划』标签应切换到 plan 模式", async () => {
    const wrapper = mountComponent();
    const store = useTimerStore();

    const labels = wrapper.findAll(".mode-label");
    await labels[1].trigger("click");

    expect(store.appMode).toBe("plan");
    expect(labels[1].classes()).toContain("active");
    expect(labels[0].classes()).not.toContain("active");
  });

  it("点击『正向』标签应切换到 stopwatch 模式", async () => {
    const wrapper = mountComponent();
    const store = useTimerStore();

    const labels = wrapper.findAll(".mode-label");
    await labels[2].trigger("click");

    expect(store.appMode).toBe("stopwatch");
    expect(labels[2].classes()).toContain("active");
  });

  it("滑块 thumb 在不同模式下位置应不同（class 切换）", async () => {
    const wrapper = mountComponent();
    const store = useTimerStore();
    const slider = wrapper.find(".mode-slider");

    // single
    expect(slider.classes()).toContain("mode-slider--single");

    // plan
    store.setAppMode("plan");
    await nextTick();
    expect(slider.classes()).toContain("mode-slider--plan");

    // stopwatch
    store.setAppMode("stopwatch");
    await nextTick();
    expect(slider.classes()).toContain("mode-slider--stopwatch");
  });

  it("点击滑块 thumb 应循环切换模式", async () => {
    const wrapper = mountComponent();
    const store = useTimerStore();
    const thumb = wrapper.find(".mode-slider-thumb");

    expect(store.appMode).toBe("single");
    await thumb.trigger("click");
    expect(store.appMode).toBe("plan");
    await thumb.trigger("click");
    expect(store.appMode).toBe("stopwatch");
    await thumb.trigger("click");
    expect(store.appMode).toBe("single");
  });

  it("运行中点击标签应被忽略", async () => {
    const wrapper = mountComponent();
    const store = useTimerStore();
    store.start();

    const labels = wrapper.findAll(".mode-label");
    await labels[1].trigger("click");

    expect(store.appMode).toBe("single");
  });
});
