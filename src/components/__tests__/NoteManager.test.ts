import { describe, it, expect, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import NoteManager from "../NoteManager.vue";

describe("NoteManager.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  const mountComponent = (props: Record<string, unknown> = {}) =>
    mount(NoteManager, { props });

  it("默认应渲染 placeholder='正在做什么？' 的输入框", () => {
    const wrapper = mountComponent();
    const input = wrapper.find("input");
    expect(input.exists()).toBe(true);
    expect(input.attributes("placeholder")).toBe("正在做什么？");
  });

  it("disabled=true 时 placeholder 应为 '—'", () => {
    const wrapper = mountComponent({ disabled: true });
    const input = wrapper.find("input");
    expect(input.attributes("placeholder")).toBe("—");
  });

  it("disabled=false 时 placeholder 仍为 '正在做什么？'", () => {
    const wrapper = mountComponent({ disabled: false });
    expect(wrapper.find("input").attributes("placeholder")).toBe("正在做什么？");
  });

  it("默认（note 为空）不渲染清除按钮", () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".note-manager__clear").exists()).toBe(false);
  });

  it("有值且未禁用时渲染清除按钮 ×", () => {
    const wrapper = mountComponent({ modelValue: "写代码" });
    const clearBtn = wrapper.find(".note-manager__clear");
    expect(clearBtn.exists()).toBe(true);
    expect(clearBtn.text()).toBe("×");
  });

  it("有值但禁用时不渲染清除按钮", () => {
    const wrapper = mountComponent({
      modelValue: "写代码",
      disabled: true,
    });
    expect(wrapper.find(".note-manager__clear").exists()).toBe(false);
  });

  it("空值时即使未禁用也不渲染清除按钮", () => {
    const wrapper = mountComponent({ modelValue: "", disabled: false });
    expect(wrapper.find(".note-manager__clear").exists()).toBe(false);
  });

  it("在输入框输入时应 emit update:modelValue 与新值", async () => {
    const wrapper = mountComponent();
    const input = wrapper.find("input");
    await input.setValue("正在写测试");

    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![emitted!.length - 1]).toEqual(["正在写测试"]);
  });

  it("点击清除按钮应清空 note 并 emit update:modelValue 为空字符串", async () => {
    const wrapper = mountComponent({ modelValue: "要被清除的内容" });
    expect(wrapper.find(".note-manager__clear").exists()).toBe(true);

    await wrapper.find(".note-manager__clear").trigger("click");

    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![emitted!.length - 1]).toEqual([""]);
    // 输入框应被清空
    expect(wrapper.find("input").element.value).toBe("");
    // 清除按钮应消失（note 为空）
    expect(wrapper.find(".note-manager__clear").exists()).toBe(false);
  });

  it("外部 modelValue 变化应同步到内部 note", async () => {
    const wrapper = mountComponent({ modelValue: "初始值" });
    expect(wrapper.find("input").element.value).toBe("初始值");

    await wrapper.setProps({ modelValue: "新值来自外部" });
    await wrapper.vm.$nextTick();

    expect(wrapper.find("input").element.value).toBe("新值来自外部");
  });

  it("外部 modelValue 设为 undefined 应同步为空字符串", async () => {
    const wrapper = mountComponent({ modelValue: "有值" });
    expect(wrapper.find("input").element.value).toBe("有值");

    await wrapper.setProps({ modelValue: undefined });
    await wrapper.vm.$nextTick();

    expect(wrapper.find("input").element.value).toBe("");
  });

  it("disabled=true 时输入框应有 disabled 属性", () => {
    const wrapper = mountComponent({ disabled: true });
    expect(wrapper.find("input").attributes("disabled")).toBeDefined();
  });

  it("disabled=false 时输入框不应有 disabled 属性", () => {
    const wrapper = mountComponent({ disabled: false });
    expect(wrapper.find("input").attributes("disabled")).toBeUndefined();
  });

  it("输入框 maxlength 应为 50", () => {
    const wrapper = mountComponent();
    expect(wrapper.find("input").attributes("maxlength")).toBe("50");
  });

  it("初始 modelValue 应反映在输入框中", () => {
    const wrapper = mountComponent({ modelValue: "初始备注" });
    expect(wrapper.find("input").element.value).toBe("初始备注");
  });

  it("未提供 modelValue 时输入框应为空", () => {
    const wrapper = mountComponent();
    expect(wrapper.find("input").element.value).toBe("");
  });

  it("连续输入应多次 emit update:modelValue", async () => {
    const wrapper = mountComponent();
    const input = wrapper.find("input");

    await input.setValue("a");
    await input.setValue("ab");
    await input.setValue("abc");

    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toHaveLength(3);
    expect(emitted![0]).toEqual(["a"]);
    expect(emitted![1]).toEqual(["ab"]);
    expect(emitted![2]).toEqual(["abc"]);
  });

  it("清除按钮应有 title='清除'", () => {
    const wrapper = mountComponent({ modelValue: "内容" });
    const clearBtn = wrapper.find(".note-manager__clear");
    expect(clearBtn.attributes("title")).toBe("清除");
  });

  it("根元素应包含 note-manager 类名", () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".note-manager").exists()).toBe(true);
  });
});
