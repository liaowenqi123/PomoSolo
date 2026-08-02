import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import FocusModeSwitch from "../FocusModeSwitch.vue";

describe("FocusModeSwitch.vue（受控 v-model）", () => {
  const mountComponent = (props: Record<string, unknown> = {}) =>
    mount(FocusModeSwitch, {
      props: { modelValue: false, ...props },
    });

  it("modelValue=false 时显示关闭，无 active class", () => {
    const wrapper = mountComponent({ modelValue: false });
    expect(wrapper.find(".focus-mode-status").text()).toBe("关闭");
    expect(wrapper.find(".focus-mode-switch").classes()).not.toContain("active");
  });

  it("modelValue=true 时显示开启，有 active class", () => {
    const wrapper = mountComponent({ modelValue: true });
    expect(wrapper.find(".focus-mode-status").text()).toBe("开启");
    expect(wrapper.find(".focus-mode-switch").classes()).toContain("active");
    expect(wrapper.find(".focus-mode-status").classes()).toContain("active");
  });

  it("点击开关应 emit update:modelValue 与 toggle", async () => {
    const wrapper = mountComponent({ modelValue: false });
    await wrapper.find(".focus-mode-switch").trigger("click");
    const updateEvents = wrapper.emitted("update:modelValue");
    const toggleEvents = wrapper.emitted("toggle");
    expect(updateEvents?.[0]?.[0]).toBe(true);
    expect(toggleEvents?.[0]?.[0]).toBe(true);
  });

  it("disabled 时点击不应 emit", async () => {
    const wrapper = mountComponent({ modelValue: true, disabled: true });
    await wrapper.find(".focus-mode-switch").trigger("click");
    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
    expect(wrapper.emitted("toggle")).toBeFalsy();
    // 滑块保持开启
    expect(wrapper.find(".focus-mode-switch").classes()).toContain("active");
  });

  it("父组件将 modelValue 置 false 时滑块应同步归位（惩罚后场景）", async () => {
    const wrapper = mountComponent({ modelValue: true });
    expect(wrapper.find(".focus-mode-switch").classes()).toContain("active");
    await wrapper.setProps({ modelValue: false });
    expect(wrapper.find(".focus-mode-switch").classes()).not.toContain("active");
    expect(wrapper.find(".focus-mode-status").text()).toBe("关闭");
  });
});
