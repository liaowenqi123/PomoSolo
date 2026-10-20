import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import WheelPicker from "../WheelPicker.vue";

function mountPicker(props: Record<string, unknown> = {}) {
  return mount(WheelPicker, {
    props: { modelValue: 25, min: 1, max: 120, disabled: false, ...props },
  });
}

describe("WheelPicker.vue", () => {
  it("渲染中心值附近的选项，并高亮当前值", () => {
    const wrapper = mountPicker();
    const items = wrapper.findAll(".wheel-picker-item");
    expect(items).toHaveLength(7); // 22..28
    expect(items[3].text()).toBe("25");
    expect(items[3].classes()).toContain("center");
    // 25 在 22..28 中排第 4 位 → translateY(-3 * 32px)
    expect(wrapper.find(".wheel-picker-column").attributes("style")).toContain("translateY(-96px)");
    wrapper.unmount();
  });

  it("滚轮向下/向上切换 1，并 emit update:modelValue", async () => {
    const wrapper = mountPicker();
    await wrapper.find(".wheel-picker").trigger("wheel", { deltaY: 100 });
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual([26]);

    // v-model 真实用法：父组件把 26 写回 props，再向上滚才回到 25
    await wrapper.setProps({ modelValue: 26 });
    await wrapper.find(".wheel-picker").trigger("wheel", { deltaY: -100 });
    expect(wrapper.emitted("update:modelValue")?.[1]).toEqual([25]);
    wrapper.unmount();
  });

  it("disabled 时滚轮和拖动都不生效", async () => {
    const wrapper = mountPicker({ disabled: true });
    await wrapper.find(".wheel-picker").trigger("wheel", { deltaY: 100 });
    await wrapper.find(".wheel-picker").trigger("pointerdown", { clientY: 100 });
    window.dispatchEvent(new MouseEvent("pointermove", { clientY: 60 }));
    window.dispatchEvent(new MouseEvent("pointerup"));
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    wrapper.unmount();
  });

  it("滚轮不会越过 min/max", async () => {
    const low = mountPicker({ modelValue: 2, min: 1, max: 120 });
    await low.find(".wheel-picker").trigger("wheel", { deltaY: -100 });
    expect(low.emitted("update:modelValue")?.[0]).toEqual([1]);
    low.unmount();

    const high = mountPicker({ modelValue: 119, min: 1, max: 120 });
    await high.find(".wheel-picker").trigger("wheel", { deltaY: 100 });
    expect(high.emitted("update:modelValue")?.[0]).toEqual([120]);
    high.unmount();
  });

  it("外部 modelValue 变化会同步中心项", async () => {
    const wrapper = mountPicker();
    await wrapper.setProps({ modelValue: 30 });
    await nextTick();
    const center = wrapper.find(".wheel-picker-item.center");
    expect(center.text()).toBe("30");
    wrapper.unmount();
  });
});
