import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import SpaceTravel from "../SpaceTravel.vue";

describe("SpaceTravel.vue", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.removeEventListener("keydown", () => {});
  });

  const mountComponent = (visible: boolean) =>
    mount(SpaceTravel, { props: { visible } });

  it("visible=false 时不渲染太空旅行", () => {
    const wrapper = mountComponent(false);
    expect(wrapper.find(".space-travel-container").exists()).toBe(false);
  });

  it("visible=true 时应渲染太空旅行（背景/星星/行星/火箭/感谢信息）", () => {
    const wrapper = mountComponent(true);
    expect(wrapper.find(".space-travel-container").exists()).toBe(true);
    expect(wrapper.find(".space-background").exists()).toBe(true);
    expect(wrapper.find(".stars-container").exists()).toBe(true);
    expect(wrapper.find(".planets-container").exists()).toBe(true);
    expect(wrapper.find(".tomato-rocket").exists()).toBe(true);
    expect(wrapper.find(".thank-you-message").exists()).toBe(true);
  });

  it("visible=true 时应生成 50 颗星星", () => {
    const wrapper = mountComponent(true);
    expect(wrapper.findAll(".star").length).toBe(50);
  });

  it("初始不可退出（无 exit-ready class，点击不退出）", async () => {
    vi.useFakeTimers();
    const wrapper = mountComponent(true);
    expect(wrapper.find(".space-travel-container").classes()).not.toContain("exit-ready");
    // 未到 8 秒前点击不应退出
    await wrapper.trigger("click");
    expect(wrapper.emitted("update:visible")).toBeFalsy();
  });

  it("8 秒后出现 exit-ready 并可点击退出", async () => {
    vi.useFakeTimers();
    const wrapper = mountComponent(true);
    await vi.advanceTimersByTimeAsync(8000);
    expect(wrapper.find(".space-travel-container").classes()).toContain("exit-ready");
    // 点击退出
    await wrapper.trigger("click");
    const updates = wrapper.emitted("update:visible");
    expect(updates).toBeTruthy();
    expect(updates?.[0]?.[0]).toBe(false);
  });

  it("8 秒后按 ESC 也可退出", async () => {
    vi.useFakeTimers();
    const wrapper = mountComponent(true);
    await vi.advanceTimersByTimeAsync(8000);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    const updates = wrapper.emitted("update:visible");
    expect(updates).toBeTruthy();
    expect(updates?.[0]?.[0]).toBe(false);
  });

  it("重新显示时应重新生成星星并重置退出状态", async () => {
    vi.useFakeTimers();
    const wrapper = mountComponent(true);
    await vi.advanceTimersByTimeAsync(8000);
    expect(wrapper.find(".space-travel-container").classes()).toContain("exit-ready");
    // 退出后重新显示
    await wrapper.setProps({ visible: false });
    await flushPromises();
    await wrapper.setProps({ visible: true });
    await flushPromises();
    expect(wrapper.find(".space-travel-container").classes()).not.toContain("exit-ready");
    expect(wrapper.findAll(".star").length).toBe(50);
  });
});
