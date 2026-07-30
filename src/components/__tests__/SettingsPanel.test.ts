import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

// Mock @tauri-apps/api/core（update API 间接依赖 invoke）
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

// Mock @tauri-apps/api/event（useTauriEvent 间接依赖 listen）
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
}));

// Mock @tauri-apps/api/app（getVersion 调用 invoke）
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(() => Promise.resolve("0.0.0")),
}));

// Mock @/api/data 模块（settings store 通过 readSettings/writeSettings 持久化）
const dataApi = vi.hoisted(() => ({
  readSettings: vi.fn(),
  writeSettings: vi.fn(),
}));
vi.mock("@/api/data", () => dataApi);

import SettingsPanel from "../SettingsPanel.vue";
import { useSettingsStore, DEFAULT_SETTINGS } from "../../stores/settings";

describe("SettingsPanel.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    dataApi.readSettings.mockReset();
    dataApi.writeSettings.mockReset();
    dataApi.writeSettings.mockResolvedValue(undefined);
  });

  const mountComponent = (visible = true) =>
    mount(SettingsPanel, { props: { visible } });

  // ===== 可见性 =====

  it("visible=false 时不应渲染面板", () => {
    const wrapper = mountComponent(false);
    expect(wrapper.find(".settings-overlay").exists()).toBe(false);
  });

  it("visible=true 时应渲染设置面板", () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".settings-overlay").exists()).toBe(true);
    expect(wrapper.find(".settings-panel").exists()).toBe(true);
  });

  // ===== 标题 + 关闭按钮 =====

  it("应显示标题『设置』", () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".settings-panel__title").text()).toBe("设置");
  });

  it("应有关闭按钮（×）", () => {
    const wrapper = mountComponent();
    const closeBtn = wrapper.find(".settings-panel__close");
    expect(closeBtn.exists()).toBe(true);
    expect(closeBtn.text()).toBe("×");
  });

  it("点击关闭按钮应 emit close", async () => {
    const wrapper = mountComponent();
    await wrapper.find(".settings-panel__close").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  // ===== 遮罩点击 =====

  it("点击遮罩层应 emit close", async () => {
    const wrapper = mountComponent();
    await wrapper.find(".settings-overlay").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  it("点击面板内容不应 emit close（stopPropagation）", async () => {
    const wrapper = mountComponent();
    await wrapper.find(".settings-panel").trigger("click");
    expect(wrapper.emitted("close")).toBeFalsy();
  });

  // ===== 主题切换 =====

  it("应渲染『深色』和『浅色』两个主题按钮", () => {
    const wrapper = mountComponent();
    const themeBtns = wrapper.findAll(".theme-btn");
    expect(themeBtns).toHaveLength(2);
    expect(themeBtns[0].text()).toBe("深色");
    expect(themeBtns[1].text()).toBe("浅色");
  });

  it("默认 dark 主题下『深色』按钮应有 active 类", () => {
    const wrapper = mountComponent();
    const themeBtns = wrapper.findAll(".theme-btn");
    expect(themeBtns[0].classes()).toContain("theme-btn--active");
    expect(themeBtns[1].classes()).not.toContain("theme-btn--active");
  });

  it("点击『浅色』应调用 settings.update('theme', 'light') 并切换 active", async () => {
    const wrapper = mountComponent();
    const store = useSettingsStore();
    const updateSpy = vi.spyOn(store, "update");

    const lightBtn = wrapper.findAll(".theme-btn")[1];
    await lightBtn.trigger("click");

    expect(updateSpy).toHaveBeenCalledWith("theme", "light");
    expect(store.theme).toBe("light");
    // active 应切换到浅色
    const themeBtns = wrapper.findAll(".theme-btn");
    expect(themeBtns[1].classes()).toContain("theme-btn--active");
    expect(themeBtns[0].classes()).not.toContain("theme-btn--active");
  });

  it("点击『深色』应调用 settings.update('theme', 'dark')", async () => {
    const wrapper = mountComponent();
    const store = useSettingsStore();
    // 先切到 light
    await store.update("theme", "light");
    const updateSpy = vi.spyOn(store, "update");

    const darkBtn = wrapper.findAll(".theme-btn")[0];
    await darkBtn.trigger("click");

    expect(updateSpy).toHaveBeenCalledWith("theme", "dark");
    expect(store.theme).toBe("dark");
  });

  // ===== 计时器行为：最小化行为 =====

  it("应渲染最小化行为 select，默认值为 tray", () => {
    const wrapper = mountComponent();
    const selects = wrapper.findAll(".settings-select");
    expect(selects.length).toBeGreaterThanOrEqual(1);
    expect(selects[0].attributes("value")).toBe("tray");
  });

  it("最小化行为 select 应包含『最小化到托盘』和『最小化窗口』选项", () => {
    const wrapper = mountComponent();
    const select = wrapper.findAll(".settings-select")[0];
    const options = select.findAll("option");
    expect(options).toHaveLength(2);
    expect(options[0].attributes("value")).toBe("tray");
    expect(options[0].text()).toBe("最小化到托盘");
    expect(options[1].attributes("value")).toBe("minimize");
    expect(options[1].text()).toBe("最小化窗口");
  });

  it("切换最小化行为应调用 settings.update('minimizeBehavior', 'minimize')", async () => {
    const wrapper = mountComponent();
    const store = useSettingsStore();
    const updateSpy = vi.spyOn(store, "update");

    const select = wrapper.findAll(".settings-select")[0];
    await select.setValue("minimize");

    expect(updateSpy).toHaveBeenCalledWith("minimizeBehavior", "minimize");
    expect(store.minimizeBehavior).toBe("minimize");
  });

  // ===== 计时器行为：迷你模式退出 =====

  it("应渲染迷你模式退出 select，默认值为 double-click", () => {
    const wrapper = mountComponent();
    const selects = wrapper.findAll(".settings-select");
    expect(selects[1].attributes("value")).toBe("double-click");
  });

  it("迷你模式退出 select 应包含『双击退出』和『按钮退出』选项", () => {
    const wrapper = mountComponent();
    const select = wrapper.findAll(".settings-select")[1];
    const options = select.findAll("option");
    expect(options).toHaveLength(2);
    expect(options[0].attributes("value")).toBe("double-click");
    expect(options[0].text()).toBe("双击退出");
    expect(options[1].attributes("value")).toBe("button");
    expect(options[1].text()).toBe("按钮退出");
  });

  it("切换迷你模式退出应调用 settings.update('miniExitMode', 'button')", async () => {
    const wrapper = mountComponent();
    const store = useSettingsStore();
    const updateSpy = vi.spyOn(store, "update");

    const select = wrapper.findAll(".settings-select")[1];
    await select.setValue("button");

    expect(updateSpy).toHaveBeenCalledWith("miniExitMode", "button");
    expect(store.settings.miniExitMode).toBe("button");
  });

  // ===== 界面显示开关 =====

  it("应渲染所有界面显示/音乐播放器/系统开关", () => {
    const wrapper = mountComponent();
    const toggles = wrapper.findAll('.settings-row--toggle input[type="checkbox"]');
    // 界面显示 10 个 + 音乐播放器 3 个 + 系统 1 个 = 14 个
    expect(toggles).toHaveLength(14);
  });

  it("显示菜园子按钮开关默认应为 checked", () => {
    const wrapper = mountComponent();
    const toggles = wrapper.findAll('.settings-row--toggle input[type="checkbox"]');
    // 界面显示区第 2 个开关（索引 1）：显示菜园子按钮
    expect((toggles[1].element as HTMLInputElement).checked).toBe(
      DEFAULT_SETTINGS.showGardenBtn,
    );
  });

  it("切换『显示菜园子按钮』应调用 settings.update('showGardenBtn', false)", async () => {
    const wrapper = mountComponent();
    const store = useSettingsStore();
    const updateSpy = vi.spyOn(store, "update");

    const toggles = wrapper.findAll('.settings-row--toggle input[type="checkbox"]');
    // 界面显示区第 2 个开关（索引 1）：显示菜园子按钮
    await toggles[1].setValue(false);

    expect(updateSpy).toHaveBeenCalledWith("showGardenBtn", false);
    expect(store.settings.showGardenBtn).toBe(false);
  });

  it("切换『显示统计按钮』应调用 settings.update('showStatsBtn', false)", async () => {
    const wrapper = mountComponent();
    const store = useSettingsStore();
    const updateSpy = vi.spyOn(store, "update");

    const toggles = wrapper.findAll('.settings-row--toggle input[type="checkbox"]');
    // 界面显示区第 3 个开关（索引 2）：显示统计按钮
    await toggles[2].setValue(false);

    expect(updateSpy).toHaveBeenCalledWith("showStatsBtn", false);
    expect(store.settings.showStatsBtn).toBe(false);
  });

  it("切换『显示 AI 助手按钮』应调用 settings.update('showAiBtn', false)", async () => {
    const wrapper = mountComponent();
    const store = useSettingsStore();
    const updateSpy = vi.spyOn(store, "update");

    const toggles = wrapper.findAll('.settings-row--toggle input[type="checkbox"]');
    // 界面显示区第 4 个开关（索引 3）：显示 AI 助手按钮
    await toggles[3].setValue(false);

    expect(updateSpy).toHaveBeenCalledWith("showAiBtn", false);
    expect(store.settings.showAiBtn).toBe(false);
  });

  it("切换『种植轮盘模式』应调用 settings.update('plantWheelMode', false)", async () => {
    const wrapper = mountComponent();
    const store = useSettingsStore();
    const updateSpy = vi.spyOn(store, "update");

    const toggles = wrapper.findAll('.settings-row--toggle input[type="checkbox"]');
    // 界面显示区第 9 个开关（索引 8）：种植轮盘模式
    await toggles[8].setValue(false);

    expect(updateSpy).toHaveBeenCalledWith("plantWheelMode", false);
    expect(store.settings.plantWheelMode).toBe(false);
  });

  // ===== 系统设置 =====

  it("开机自启动开关默认应为 unchecked", () => {
    const wrapper = mountComponent();
    const toggles = wrapper.findAll('.settings-row--toggle input[type="checkbox"]');
    // 最后一个开关：开机自启动
    const autoStartToggle = toggles[toggles.length - 1];
    expect((autoStartToggle.element as HTMLInputElement).checked).toBe(
      DEFAULT_SETTINGS.autoStart,
    );
  });

  it("切换『开机自启动』应调用 settings.update('autoStart', true)", async () => {
    const wrapper = mountComponent();
    const store = useSettingsStore();
    const updateSpy = vi.spyOn(store, "update");

    const toggles = wrapper.findAll('.settings-row--toggle input[type="checkbox"]');
    const autoStartToggle = toggles[toggles.length - 1];
    await autoStartToggle.setValue(true);

    expect(updateSpy).toHaveBeenCalledWith("autoStart", true);
    expect(store.autoStart).toBe(true);
  });

  // ===== 底部按钮 =====

  it("应渲染『恢复默认』和『完成』按钮", () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".settings-btn--reset").text()).toBe("恢复默认");
    expect(wrapper.find(".settings-btn--save").text()).toBe("完成");
  });

  it("点击『恢复默认』应调用 settings.reset()", async () => {
    const wrapper = mountComponent();
    const store = useSettingsStore();
    // 先修改一个值
    await store.update("theme", "light");
    expect(store.theme).toBe("light");

    const resetSpy = vi.spyOn(store, "reset");
    await wrapper.find(".settings-btn--reset").trigger("click");

    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(store.theme).toBe("dark");
    expect(store.settings).toEqual(DEFAULT_SETTINGS);
  });

  it("点击『完成』应 emit close", async () => {
    const wrapper = mountComponent();
    await wrapper.find(".settings-btn--save").trigger("click");
    expect(wrapper.emitted("close")).toBeTruthy();
  });

  // ===== update 持久化 =====

  it("任何设置变更都应触发后端持久化（writeSettings）", async () => {
    const wrapper = mountComponent();
    const lightBtn = wrapper.findAll(".theme-btn")[1];
    await lightBtn.trigger("click");

    expect(dataApi.writeSettings).toHaveBeenCalled();
  });
});
