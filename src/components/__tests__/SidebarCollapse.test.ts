import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import SidebarCollapse from "../SidebarCollapse.vue";

describe("SidebarCollapse.vue", () => {
  const mountComponent = (collapsed: boolean) =>
    mount(SidebarCollapse, {
      props: { collapsed },
    });

  it("collapsed=false 时渲染按钮（无 collapsed class）", () => {
    const wrapper = mountComponent(false);
    const btn = wrapper.find(".sidebar-collapse-btn");
    expect(btn.exists()).toBe(true);
    expect(btn.classes()).not.toContain("collapsed");
  });

  it("collapsed=true 时按钮应有 collapsed class", () => {
    const wrapper = mountComponent(true);
    expect(wrapper.find(".sidebar-collapse-btn").classes()).toContain("collapsed");
  });

  it("collapsed=false 时图标应指向 '◀'（展开态，点击会收起）", () => {
    const wrapper = mountComponent(false);
    expect(wrapper.find(".sidebar-collapse-icon").text()).toBe("◀");
  });

  it("collapsed=true 时图标应指向 '▶'（收起态，点击会展开）", () => {
    const wrapper = mountComponent(true);
    expect(wrapper.find(".sidebar-collapse-icon").text()).toBe("▶");
  });

  it("点击按钮应触发 toggle 事件", async () => {
    const wrapper = mountComponent(false);
    await wrapper.find(".sidebar-collapse-btn").trigger("click");
    expect(wrapper.emitted("toggle")).toBeTruthy();
    expect(wrapper.emitted("toggle")?.length).toBe(1);
  });

  it("多次点击应多次触发 toggle 事件", async () => {
    const wrapper = mountComponent(false);
    await wrapper.find(".sidebar-collapse-btn").trigger("click");
    await wrapper.find(".sidebar-collapse-btn").trigger("click");
    await wrapper.find(".sidebar-collapse-btn").trigger("click");
    expect(wrapper.emitted("toggle")?.length).toBe(3);
  });

  it("collapsed 切换时图标应跟随更新", async () => {
    const wrapper = mountComponent(false);
    expect(wrapper.find(".sidebar-collapse-icon").text()).toBe("◀");
    await wrapper.setProps({ collapsed: true });
    expect(wrapper.find(".sidebar-collapse-icon").text()).toBe("▶");
    await wrapper.setProps({ collapsed: false });
    expect(wrapper.find(".sidebar-collapse-icon").text()).toBe("◀");
  });

  it("title 应为 '收起侧边栏'", () => {
    const wrapper = mountComponent(false);
    expect(wrapper.find(".sidebar-collapse-btn").attributes("title")).toBe(
      "收起侧边栏",
    );
  });

  it("collapsed=true 时按钮 class 应包含 collapsed", async () => {
    const wrapper = mountComponent(false);
    expect(wrapper.find(".sidebar-collapse-btn").classes()).not.toContain(
      "collapsed",
    );
    await wrapper.setProps({ collapsed: true });
    expect(wrapper.find(".sidebar-collapse-btn").classes()).toContain(
      "collapsed",
    );
  });
});
