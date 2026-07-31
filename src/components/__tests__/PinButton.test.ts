import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";

// Mock window API
const setAlwaysOnTopMock = vi.fn();
const cancelAlwaysOnTopMock = vi.fn();
vi.mock("../../api/window", () => ({
  setAlwaysOnTop: (...args: unknown[]) => setAlwaysOnTopMock(...args),
  cancelAlwaysOnTop: (...args: unknown[]) => cancelAlwaysOnTopMock(...args),
}));

import PinButton from "../PinButton.vue";

describe("PinButton.vue", () => {
  beforeEach(() => {
    setAlwaysOnTopMock.mockReset();
    cancelAlwaysOnTopMock.mockReset();
    setAlwaysOnTopMock.mockResolvedValue(undefined);
    cancelAlwaysOnTopMock.mockResolvedValue(undefined);
  });

  const mountComponent = () => mount(PinButton);

  it("渲染按钮且默认未激活（无 active class）", () => {
    const wrapper = mountComponent();
    const btn = wrapper.find(".btn-pin");
    expect(btn.exists()).toBe(true);
    expect(btn.classes()).not.toContain("active");
  });

  it("按钮 title 应为 '始终置顶'", () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".btn-pin").attributes("title")).toBe("始终置顶");
  });

  it("按钮内容应为 📍 emoji", () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".btn-pin").text()).toBe("📍");
  });

  it("点击应激活并调用 setAlwaysOnTop(true)", async () => {
    const wrapper = mountComponent();
    await wrapper.find(".btn-pin").trigger("click");
    expect(setAlwaysOnTopMock).toHaveBeenCalledTimes(1);
    expect(setAlwaysOnTopMock).toHaveBeenCalledWith(true);
    expect(wrapper.find(".btn-pin").classes()).toContain("active");
  });

  it("再次点击应取消激活并调用 cancelAlwaysOnTop()", async () => {
    const wrapper = mountComponent();
    // 激活
    await wrapper.find(".btn-pin").trigger("click");
    expect(wrapper.find(".btn-pin").classes()).toContain("active");
    // 取消
    await wrapper.find(".btn-pin").trigger("click");
    expect(cancelAlwaysOnTopMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find(".btn-pin").classes()).not.toContain("active");
  });

  it("setAlwaysOnTop 抛错时应回滚 active 状态", async () => {
    setAlwaysOnTopMock.mockRejectedValue(new Error("backend error"));
    const wrapper = mountComponent();
    await wrapper.find(".btn-pin").trigger("click");
    // 抛错后应回滚到未激活
    expect(wrapper.find(".btn-pin").classes()).not.toContain("active");
  });

  it("cancelAlwaysOnTop 抛错时应恢复 active 状态", async () => {
    cancelAlwaysOnTopMock.mockRejectedValue(new Error("backend error"));
    const wrapper = mountComponent();
    // 先激活
    await wrapper.find(".btn-pin").trigger("click");
    expect(wrapper.find(".btn-pin").classes()).toContain("active");
    // 取消时抛错，应回滚到激活
    await wrapper.find(".btn-pin").trigger("click");
    expect(wrapper.find(".btn-pin").classes()).toContain("active");
  });
});
