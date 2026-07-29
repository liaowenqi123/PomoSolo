import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import ModeSwitch from "../ModeSwitch.vue";
import { useTimerStore } from "../../stores/timer";

describe("ModeSwitch.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  const mountComponent = () => mount(ModeSwitch);

  it("应渲染两个按钮（专注 / 休息）", () => {
    const wrapper = mountComponent();
    const buttons = wrapper.findAll("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].text()).toContain("专注");
    expect(buttons[1].text()).toContain("休息");
  });

  it("初始 work 模式下『专注』按钮应有 active 类", () => {
    const wrapper = mountComponent();
    const buttons = wrapper.findAll("button");
    expect(buttons[0].classes()).toContain("active");
    expect(buttons[1].classes()).not.toContain("active");
  });

  it("点击『休息』应设置 break 模式", async () => {
    const wrapper = mountComponent();
    const store = useTimerStore();
    expect(store.mode).toBe("work");

    const breakBtn = wrapper.findAll("button")[1];
    await breakBtn.trigger("click");

    expect(store.mode).toBe("break");
    expect(store.displayTime).toBe("05:00");
  });

  it("点击『专注』应设置 work 模式", async () => {
    const wrapper = mountComponent();
    const store = useTimerStore();
    store.setMode("break");
    expect(store.mode).toBe("break");

    const workBtn = wrapper.findAll("button")[0];
    await workBtn.trigger("click");

    expect(store.mode).toBe("work");
    expect(store.displayTime).toBe("25:00");
  });

  it("切换到 break 后『休息』按钮应有 active 类", async () => {
    const wrapper = mountComponent();
    const buttons = wrapper.findAll("button");

    await buttons[1].trigger("click");
    await wrapper.vm.$nextTick();

    expect(buttons[1].classes()).toContain("active");
    expect(buttons[0].classes()).not.toContain("active");
  });

  it("切换回 work 后『专注』按钮应再次 active", async () => {
    const wrapper = mountComponent();
    const buttons = wrapper.findAll("button");

    await buttons[1].trigger("click");
    await buttons[0].trigger("click");

    expect(buttons[0].classes()).toContain("active");
    expect(buttons[1].classes()).not.toContain("active");
  });

  it("运行中点击切换应被忽略（store 行为）", async () => {
    const wrapper = mountComponent();
    const store = useTimerStore();
    store.start();

    const breakBtn = wrapper.findAll("button")[1];
    await breakBtn.trigger("click");

    expect(store.mode).toBe("work");
  });

  it("应有 emoji 图标", () => {
    const wrapper = mountComponent();
    const icons = wrapper.findAll(".mode-icon");
    expect(icons).toHaveLength(2);
    expect(icons[0].text()).toBe("💼");
    expect(icons[1].text()).toBe("☕");
  });
});
