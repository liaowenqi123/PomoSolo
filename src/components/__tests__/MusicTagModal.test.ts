import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import MusicTagModal from "../MusicTagModal.vue";

function mountModal(overrides: Record<string, unknown> = {}) {
  return mount(MusicTagModal, {
    props: {
      visible: true,
      songName: "测试歌曲.mp3",
      currentTag: { name: "学习", color: null },
      customTags: { 专注: "#5f9df7", 安静: "#48dbfb" },
      advancedColorEnabled: false,
      ...overrides,
    },
  });
}

describe("MusicTagModal.vue", () => {
  it("visible=false 不渲染；visible=true 显示歌曲名与标签", () => {
    const hidden = mountModal({ visible: false });
    expect(hidden.find(".music-tag-modal").exists()).toBe(false);
    hidden.unmount();

    const wrapper = mountModal();
    expect(wrapper.find(".music-tag-modal").exists()).toBe(true);
    expect(wrapper.find(".music-tag-modal__song-name").text()).toContain("测试歌曲.mp3");
    // 预设 3 个 + 自定义 2 个
    expect(wrapper.findAll(".tag-option")).toHaveLength(5);
    expect(wrapper.find(".tag-option.active").text()).toContain("学习");
    wrapper.unmount();
  });

  it("点预设标签：emit select-tag，颜色为 null，并关闭", async () => {
    const wrapper = mountModal();
    const preset = wrapper.findAll(".tag-option").find((b) => b.text() === "学习")!;
    await preset.trigger("click");
    expect(wrapper.emitted("select-tag")?.[0]).toEqual(["学习", null]);
    expect(wrapper.emitted("update:visible")?.[0]).toEqual([false]);
    wrapper.unmount();
  });

  it("点自定义标签：使用存储颜色 emit select-tag", async () => {
    const wrapper = mountModal();
    const custom = wrapper.findAll(".tag-option").find((b) => b.text().includes("专注"))!;
    await custom.trigger("click");
    expect(wrapper.emitted("select-tag")?.[0]).toEqual(["专注", "#5f9df7"]);
    wrapper.unmount();
  });

  it("删除自定义标签：emit delete-tag，且不触发 select-tag", async () => {
    const wrapper = mountModal();
    const del = wrapper.findAll(".tag-delete-btn")[0];
    await del.trigger("click");
    expect(wrapper.emitted("delete-tag")?.[0]).toEqual(["专注"]);
    expect(wrapper.emitted("select-tag")).toBeUndefined();
    wrapper.unmount();
  });

  it("自定义标签为空：显示错误且不提交", async () => {
    const wrapper = mountModal();
    await wrapper.find(".tag-add-btn").trigger("click");
    expect(wrapper.find(".tag-custom-error").text()).toContain("不能为空");
    expect(wrapper.emitted("add-tag")).toBeUndefined();
    wrapper.unmount();
  });

  it("自定义标签超 8 字：显示错误且不提交", async () => {
    const wrapper = mountModal();
    const input = wrapper.find(".tag-custom-input");
    // maxlength 会限制用户输入；这里直接模拟异常超长值，验证二道校验
    (input.element as HTMLInputElement).value = "123456789";
    await input.trigger("input");
    await wrapper.find(".tag-add-btn").trigger("click");
    expect(wrapper.find(".tag-custom-error").text()).toContain("最多 8 个字");
    expect(wrapper.emitted("add-tag")).toBeUndefined();
    wrapper.unmount();
  });

  it("自定义标签与预设/已有重名：分别给出提示", async () => {
    const wrapper = mountModal();
    const input = wrapper.find(".tag-custom-input");
    await input.setValue("学习");
    await wrapper.find(".tag-add-btn").trigger("click");
    expect(wrapper.find(".tag-custom-error").text()).toContain("预设标签");

    await input.setValue("专注");
    await wrapper.find(".tag-add-btn").trigger("click");
    expect(wrapper.find(".tag-custom-error").text()).toContain("已有同名标签");
    wrapper.unmount();
  });

  it("输入合法自定义标签：按当前选中颜色 emit add-tag 并关闭", async () => {
    const wrapper = mountModal();
    await wrapper.find('[data-color="#feca57"]').trigger("click");
    await wrapper.find(".tag-custom-input").setValue("心流");
    await wrapper.find(".tag-add-btn").trigger("click");
    expect(wrapper.emitted("add-tag")?.[0]).toEqual(["心流", "#feca57"]);
    expect(wrapper.emitted("update:visible")?.[0]).toEqual([false]);
    wrapper.unmount();
  });

  it("回车也能提交自定义标签", async () => {
    const wrapper = mountModal();
    await wrapper.find(".tag-custom-input").setValue("复盘");
    await wrapper.find(".tag-custom-input").trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("add-tag")?.[0]).toEqual(["复盘", "#ff6b6b"]);
    wrapper.unmount();
  });

  it("高级颜色开关：关闭时不显示调色盘；开启后可拖色相", async () => {
    const off = mountModal({ advancedColorEnabled: false });
    expect(off.find(".tag-color-advanced").exists()).toBe(false);
    off.unmount();

    const wrapper = mountModal({ advancedColorEnabled: true });
    const advanced = wrapper.find(".tag-color-advanced");
    expect(advanced.exists()).toBe(true);
    await advanced.trigger("click");
    expect(wrapper.find(".tag-custom-color-picker").exists()).toBe(true);

    const slider = wrapper.find(".color-hue-slider");
    (slider.element as HTMLInputElement).value = "120";
    await slider.trigger("input");
    await wrapper.find(".tag-custom-input").setValue("绿色");
    await wrapper.find(".tag-add-btn").trigger("click");
    const emitted = wrapper.emitted("add-tag")?.[0] as [string, string];
    expect(emitted[0]).toBe("绿色");
    expect(emitted[1]).toMatch(/^#[0-9a-f]{6}$/);
    wrapper.unmount();
  });

  it("点遮罩关闭；点内容不关闭；Esc 关闭", async () => {
    const wrapper = mountModal();
    await wrapper.find(".music-tag-modal").trigger("click");
    expect(wrapper.emitted("update:visible")).toBeUndefined();

    await wrapper.find(".music-tag-modal-overlay").trigger("click");
    expect(wrapper.emitted("update:visible")?.[0]).toEqual([false]);

    await wrapper.find(".music-tag-modal-overlay").trigger("keydown", { key: "Escape" });
    expect(wrapper.emitted("update:visible")?.[1]).toEqual([false]);
    wrapper.unmount();
  });

  it("重新打开时清空输入与错误", async () => {
    const wrapper = mountModal({ visible: false });
    await wrapper.setProps({ visible: true });
    await wrapper.find(".tag-custom-input").setValue("临");
    await wrapper.find(".tag-add-btn").trigger("click");
    // 合法，关闭
    expect(wrapper.emitted("add-tag")).toBeTruthy();

    await wrapper.setProps({ visible: false });
    await wrapper.setProps({ visible: true });
    expect((wrapper.find(".tag-custom-input").element as HTMLInputElement).value).toBe("");
    wrapper.unmount();
  });
});
