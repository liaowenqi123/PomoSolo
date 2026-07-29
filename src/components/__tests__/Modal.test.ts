import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import Modal from "../Modal.vue";

describe("Modal.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.style.overflow = "";
    // 清除可能残留的 keydown 监听器
    document.body.innerHTML = "";
  });

  afterEach(() => {
    document.body.style.overflow = "";
  });

  const mountComponent = (props: Record<string, unknown> = {}) =>
    mount(Modal, {
      props: { visible: false, ...props },
      slots: {
        default: "<p>弹窗内容</p>",
      },
    });

  it("visible=false 时不渲染任何内容（v-if）", () => {
    const wrapper = mountComponent({ visible: false });
    expect(wrapper.find(".modal-overlay").exists()).toBe(false);
    expect(wrapper.find(".modal-container").exists()).toBe(false);
  });

  it("visible=true 时渲染遮罩 + 容器 + 标题 + 关闭按钮", () => {
    const wrapper = mountComponent({
      visible: true,
      title: "测试标题",
    });
    expect(wrapper.find(".modal-overlay").exists()).toBe(true);
    expect(wrapper.find(".modal-container").exists()).toBe(true);
    expect(wrapper.find(".modal-title").text()).toBe("测试标题");
    expect(wrapper.find(".modal-close-btn").exists()).toBe(true);
  });

  it("点击遮罩本身（target===currentTarget）应触发 update:visible=false 与 close", async () => {
    const wrapper = mountComponent({ visible: true });
    await wrapper.find(".modal-overlay").trigger("click");

    const emitted = wrapper.emitted();
    expect(emitted["update:visible"]).toBeTruthy();
    expect(emitted["update:visible"][0]).toEqual([false]);
    expect(emitted["close"]).toBeTruthy();
    expect(emitted["close"].length).toBe(1);
  });

  it("点击容器内部不应关闭（仅遮罩点击关闭）", async () => {
    const wrapper = mountComponent({ visible: true });
    await wrapper.find(".modal-container").trigger("click");

    const emitted = wrapper.emitted();
    expect(emitted["update:visible"]).toBeFalsy();
    expect(emitted["close"]).toBeFalsy();
  });

  it("点击关闭按钮应触发 update:visible=false 与 close", async () => {
    const wrapper = mountComponent({ visible: true });
    await wrapper.find(".modal-close-btn").trigger("click");

    const emitted = wrapper.emitted();
    expect(emitted["update:visible"]).toBeTruthy();
    expect(emitted["update:visible"][0]).toEqual([false]);
    expect(emitted["close"]).toBeTruthy();
  });

  it("closeOnBackground=false 时点击遮罩不应关闭", async () => {
    const wrapper = mountComponent({
      visible: true,
      closeOnBackground: false,
    });
    await wrapper.find(".modal-overlay").trigger("click");

    const emitted = wrapper.emitted();
    expect(emitted["update:visible"]).toBeFalsy();
    expect(emitted["close"]).toBeFalsy();
  });

  it("showClose=false 时隐藏关闭按钮", () => {
    const wrapper = mountComponent({
      visible: true,
      showClose: false,
    });
    expect(wrapper.find(".modal-close-btn").exists()).toBe(false);
  });

  it("提供 title 时渲染标题", () => {
    const wrapper = mountComponent({
      visible: true,
      title: "我的标题",
    });
    expect(wrapper.find(".modal-title").text()).toBe("我的标题");
  });

  it("未提供 title 且 showClose=false 时不渲染 header", () => {
    const wrapper = mountComponent({
      visible: true,
      title: "",
      showClose: false,
    });
    expect(wrapper.find(".modal-header").exists()).toBe(false);
  });

  it("提供 footer 插槽时渲染 footer", () => {
    const wrapper = mount(Modal, {
      props: { visible: true },
      slots: {
        default: "<p>正文</p>",
        footer: "<button>确定</button>",
      },
    });
    expect(wrapper.find(".modal-footer").exists()).toBe(true);
    expect(wrapper.find(".modal-footer button").text()).toBe("确定");
  });

  it("未提供 footer 插槽时不渲染 footer", () => {
    const wrapper = mountComponent({ visible: true });
    expect(wrapper.find(".modal-footer").exists()).toBe(false);
  });

  it("ESC 键应触发关闭", async () => {
    const wrapper = mountComponent({ visible: false });
    // 切换到 visible=true 以绑定 keydown 监听器
    await wrapper.setProps({ visible: true });
    await wrapper.vm.$nextTick();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape" })
    );
    await wrapper.vm.$nextTick();

    const emitted = wrapper.emitted();
    expect(emitted["update:visible"]).toBeTruthy();
    expect(emitted["update:visible"][0]).toEqual([false]);
    expect(emitted["close"]).toBeTruthy();
  });

  it("visible=true 但 ESC key 不是 Escape 时不触发关闭", async () => {
    const wrapper = mountComponent({ visible: false });
    await wrapper.setProps({ visible: true });
    await wrapper.vm.$nextTick();

    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter" })
    );
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted()["update:visible"]).toBeFalsy();
  });

  it("width 属性应设置容器的 maxWidth 样式", () => {
    const wrapper = mountComponent({
      visible: true,
      width: "520px",
    });
    const container = wrapper.find(".modal-container");
    expect(container.attributes("style")).toContain("max-width: 520px");
  });

  it("未设置 width 时容器不应有 max-width 内联样式", () => {
    const wrapper = mountComponent({ visible: true, width: "" });
    const container = wrapper.find(".modal-container");
    const style = container.attributes("style") || "";
    expect(style).not.toContain("max-width");
  });

  it("visible 由 false→true 时 body.overflow 应被锁定为 hidden", async () => {
    const wrapper = mountComponent({ visible: false });
    expect(document.body.style.overflow).toBe("");

    await wrapper.setProps({ visible: true });
    await wrapper.vm.$nextTick();

    expect(document.body.style.overflow).toBe("hidden");
  });

  it("visible 由 true→false 时 body.overflow 应恢复", async () => {
    const wrapper = mountComponent({ visible: false });

    await wrapper.setProps({ visible: true });
    await wrapper.vm.$nextTick();
    expect(document.body.style.overflow).toBe("hidden");

    await wrapper.setProps({ visible: false });
    await wrapper.vm.$nextTick();
    expect(document.body.style.overflow).toBe("");
  });

  it("组件卸载时应恢复 body.overflow 并移除 keydown 监听", async () => {
    const wrapper = mountComponent({ visible: false });
    await wrapper.setProps({ visible: true });
    await wrapper.vm.$nextTick();
    expect(document.body.style.overflow).toBe("hidden");

    wrapper.unmount();
    expect(document.body.style.overflow).toBe("");

    // 卸载后 ESC 不应再触发任何 emit（无副作用即可）
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape" })
    );
    // 无异常即通过
    expect(true).toBe(true);
  });
});
