import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

// Mock @tauri-apps/api/core（update API 间接依赖 invoke；可控制返回值）
const invokeMock = vi.hoisted(() =>
  vi.fn<(cmd: string) => Promise<unknown>>(() => Promise.resolve()),
);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
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

// Mock @/api/system 模块（autoStart 切换时调用 autostartEnable 同步系统登录项）
const systemApi = vi.hoisted(() => ({
  autostartEnable: vi.fn(),
  autostartIsEnabled: vi.fn(),
}));
vi.mock("@/api/system", () => systemApi);

// Mock @/api/garden 模块（彩蛋触发时调用 gardenUnlockEasteregg）
const gardenApi = vi.hoisted(() => ({
  gardenUnlockEasteregg: vi.fn(),
}));
vi.mock("@/api/garden", () => gardenApi);

import SettingsPanel from "../SettingsPanel.vue";
import { useSettingsStore, DEFAULT_SETTINGS } from "../../stores/settings";
import { useGardenStore } from "../../stores/garden";

describe("SettingsPanel.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    dataApi.readSettings.mockReset();
    dataApi.writeSettings.mockReset();
    dataApi.writeSettings.mockResolvedValue(undefined);
    systemApi.autostartEnable.mockReset();
    systemApi.autostartIsEnabled.mockReset();
    // autostartEnable 默认返回与请求一致的状态（不触发回写）
    systemApi.autostartEnable.mockResolvedValue(true);
    gardenApi.gardenUnlockEasteregg.mockReset();
    gardenApi.gardenUnlockEasteregg.mockResolvedValue({
      success: true,
      alreadyUnlocked: false,
      gardenData: {},
      unlockedAchievements: [],
    });
  });

  const mountComponent = (visible = true) =>
    mount(SettingsPanel, {
      props: { visible },
      global: {
        stubs: {
          // SpaceTravel 已上移到 App.vue 顶层，此处无需 stub
        },
      },
    });

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

  it("默认 light 主题下『浅色』按钮应有 active 类", () => {
    const wrapper = mountComponent();
    const themeBtns = wrapper.findAll(".theme-btn");
    expect(themeBtns[1].classes()).toContain("theme-btn--active");
    expect(themeBtns[0].classes()).not.toContain("theme-btn--active");
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

  it("应渲染迷你模式退出 select，默认值为 button", () => {
    const wrapper = mountComponent();
    const selects = wrapper.findAll(".settings-select");
    expect(selects[1].attributes("value")).toBe("button");
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

  it("应渲染所有开关（外观2+功能按钮5+导航2+音乐3+种植1+系统1+Beta1=15）", () => {
    const wrapper = mountComponent();
    const toggles = wrapper.findAll('.settings-row--toggle input[type="checkbox"]');
    expect(toggles).toHaveLength(15);
  });

  it("显示菜园子按钮开关默认应为 checked", () => {
    const wrapper = mountComponent();
    const toggles = wrapper.findAll('.settings-row--toggle input[type="checkbox"]');
    // 功能按钮区第 1 个开关（索引 2）：显示菜园子按钮
    expect((toggles[2].element as HTMLInputElement).checked).toBe(
      DEFAULT_SETTINGS.showGardenBtn,
    );
  });

  it("切换『显示菜园子按钮』应调用 settings.update('showGardenBtn', false)", async () => {
    const wrapper = mountComponent();
    const store = useSettingsStore();
    const updateSpy = vi.spyOn(store, "update");

    const toggles = wrapper.findAll('.settings-row--toggle input[type="checkbox"]');
    await toggles[2].setValue(false);

    expect(updateSpy).toHaveBeenCalledWith("showGardenBtn", false);
    expect(store.settings.showGardenBtn).toBe(false);
  });

  it("切换『显示统计按钮』应调用 settings.update('showStatsBtn', false)", async () => {
    const wrapper = mountComponent();
    const store = useSettingsStore();
    const updateSpy = vi.spyOn(store, "update");

    const toggles = wrapper.findAll('.settings-row--toggle input[type="checkbox"]');
    await toggles[3].setValue(false);

    expect(updateSpy).toHaveBeenCalledWith("showStatsBtn", false);
    expect(store.settings.showStatsBtn).toBe(false);
  });

  it("切换『显示 AI 助手按钮』应调用 settings.update('showAiBtn', false)", async () => {
    const wrapper = mountComponent();
    const store = useSettingsStore();
    const updateSpy = vi.spyOn(store, "update");

    const toggles = wrapper.findAll('.settings-row--toggle input[type="checkbox"]');
    await toggles[4].setValue(false);

    expect(updateSpy).toHaveBeenCalledWith("showAiBtn", false);
    expect(store.settings.showAiBtn).toBe(false);
  });

  it("切换『种植轮盘模式』应调用 settings.update('plantWheelMode', false)", async () => {
    const wrapper = mountComponent();
    const store = useSettingsStore();
    const updateSpy = vi.spyOn(store, "update");

    const toggles = wrapper.findAll('.settings-row--toggle input[type="checkbox"]');
    // 种植区第 1 个开关（索引 12）：种植轮盘模式
    await toggles[12].setValue(false);

    expect(updateSpy).toHaveBeenCalledWith("plantWheelMode", false);
    expect(store.settings.plantWheelMode).toBe(false);
  });

  // ===== 系统设置 =====

  it("开机自启动开关默认应为 unchecked", () => {
    const wrapper = mountComponent();
    const toggles = wrapper.findAll('.settings-row--toggle input[type="checkbox"]');
    // 索引 13：开机自启动（索引 14 是接收 Beta 版本更新）
    const autoStartToggle = toggles[13];
    expect((autoStartToggle.element as HTMLInputElement).checked).toBe(
      DEFAULT_SETTINGS.autoStart,
    );
  });

  it("切换『开机自启动』应调用 settings.update('autoStart', true) 和 autostartEnable(true)", async () => {
    const wrapper = mountComponent();
    const store = useSettingsStore();
    const updateSpy = vi.spyOn(store, "update");

    const toggles = wrapper.findAll('.settings-row--toggle input[type="checkbox"]');
    const autoStartToggle = toggles[13];
    await autoStartToggle.setValue(true);
    await flushPromises();

    expect(updateSpy).toHaveBeenCalledWith("autoStart", true);
    expect(store.autoStart).toBe(true);
    // autostartEnable 也应被调用以同步系统登录项
    expect(systemApi.autostartEnable).toHaveBeenCalledWith(true);
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
    await store.update("theme", "dark");
    expect(store.theme).toBe("dark");

    const resetSpy = vi.spyOn(store, "reset");
    await wrapper.find(".settings-btn--reset").trigger("click");

    expect(resetSpy).toHaveBeenCalledTimes(1);
    expect(store.theme).toBe("light");
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

  // ===== 隐藏彩蛋（版本号点击 5 次）=====

  async function clickVersionTimes(wrapper: ReturnType<typeof mountComponent>, times: number) {
    const versionText = wrapper.find(".version-text");
    for (let i = 0; i < times; i++) {
      await versionText.trigger("click");
    }
  }

  it("点击版本号 5 次应触发彩蛋（解锁成就 + emit easter-egg + 关闭面板）", async () => {
    vi.useFakeTimers();
    try {
      const wrapper = mountComponent();
      await clickVersionTimes(wrapper, 5);
      await flushPromises();
      // 解锁 API 被调用
      expect(gardenApi.gardenUnlockEasteregg).toHaveBeenCalledTimes(1);
      // 800ms 延迟后：发出 easter-egg（父组件播放太空旅行）+ close（关闭面板）
      await vi.advanceTimersByTimeAsync(800);
      expect(wrapper.emitted("easter-egg")).toBeTruthy();
      expect(wrapper.emitted("close")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("点击版本号少于 5 次不应触发彩蛋", async () => {
    const wrapper = mountComponent();
    await clickVersionTimes(wrapper, 3);
    await flushPromises();
    expect(gardenApi.gardenUnlockEasteregg).not.toHaveBeenCalled();
    expect(wrapper.emitted("easter-egg")).toBeFalsy();
  });

  it("点击间隔超过 1.5 秒应重置计数（不触发彩蛋）", async () => {
    vi.useFakeTimers();
    try {
      const wrapper = mountComponent();
      await clickVersionTimes(wrapper, 3);
      // 等待超过间隔阈值
      await vi.advanceTimersByTimeAsync(1600);
      await clickVersionTimes(wrapper, 2);
      await flushPromises();
      // 总点击 5 次但跨间隔，计数被重置，不应触发
      expect(gardenApi.gardenUnlockEasteregg).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("彩蛋已解锁时重复触发不重复发放奖励（不刷新菜园子）", async () => {
    vi.useFakeTimers();
    try {
      gardenApi.gardenUnlockEasteregg.mockResolvedValue({
        success: false,
        alreadyUnlocked: true,
        gardenData: {},
        unlockedAchievements: [],
      });
      const wrapper = mountComponent();
      const gardenStore = useGardenStore();
      const loadSpy = vi.spyOn(gardenStore, "load");
      await clickVersionTimes(wrapper, 5);
      await flushPromises();
      expect(gardenApi.gardenUnlockEasteregg).toHaveBeenCalledTimes(1);
      // alreadyUnlocked 时不刷新数据
      expect(loadSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // ===== 更新源选择 =====

  it("默认更新源为 github（GitHub 按钮激活）", () => {
    const wrapper = mountComponent();
    const btns = wrapper.findAll(".update-source-seg__btn");
    expect(btns.length).toBe(2);
    expect(btns[0].text()).toBe("GitHub");
    expect(btns[0].classes()).toContain("update-source-seg__btn--active");
    expect(btns[1].text()).toBe("服务器");
    expect(btns[1].classes()).not.toContain("update-source-seg__btn--active");
  });

  it("应显示更新源提示文案（断连可切换）", () => {
    const wrapper = mountComponent();
    const hint = wrapper.find(".update-source-hint");
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toContain("切换更新源后重试");
  });

  it("点击『服务器』应调用 settings.update('updateSource', 'server') 并切换激活态", async () => {
    const store = useSettingsStore();
    const updateSpy = vi.spyOn(store, "update");
    const wrapper = mountComponent();
    const serverBtn = wrapper.findAll(".update-source-seg__btn")[1];
    await serverBtn.trigger("click");
    await flushPromises();
    expect(updateSpy).toHaveBeenCalledWith("updateSource", "server");
    const btns = wrapper.findAll(".update-source-seg__btn");
    expect(btns[1].classes()).toContain("update-source-seg__btn--active");
    expect(btns[0].classes()).not.toContain("update-source-seg__btn--active");
  });

  // ===== 接收 Beta 版本更新（v4.5.18）=====

  it("接收 Beta 开关默认应为 unchecked（正式渠道默认跳过 Beta）", () => {
    const wrapper = mountComponent();
    const toggles = wrapper.findAll('.settings-row--toggle input[type="checkbox"]');
    // 索引 14：接收 Beta 版本更新
    expect((toggles[14].element as HTMLInputElement).checked).toBe(
      DEFAULT_SETTINGS.allowBetaUpdates,
    );
    expect(DEFAULT_SETTINGS.allowBetaUpdates).toBe(false);
  });

  it("切换『接收 Beta 版本更新』应调用 settings.update('allowBetaUpdates', true)", async () => {
    const store = useSettingsStore();
    const updateSpy = vi.spyOn(store, "update");
    const wrapper = mountComponent();
    const toggles = wrapper.findAll('.settings-row--toggle input[type="checkbox"]');
    await toggles[14].setValue(true);
    await flushPromises();
    expect(updateSpy).toHaveBeenCalledWith("allowBetaUpdates", true);
    expect(store.settings.allowBetaUpdates).toBe(true);
  });

  it("检查更新默认传 allowBeta=false（不接收 Beta）", async () => {
    const wrapper = mountComponent();
    const toggles = wrapper.findAll('.settings-row--toggle input[type="checkbox"]');
    await toggles[14].setValue(false); // 默认关，确保状态
    await flushPromises();
    invokeMock.mockClear();

    // 点击"检查更新"按钮（第一个 update-btn 是意见反馈，第二个是检查更新）
    const updateBtn = wrapper.findAll(".update-btn")[1];
    await updateBtn.trigger("click");
    await flushPromises();

    expect(invokeMock).toHaveBeenCalledWith("check_update", {
      source: "github",
      allowBeta: false,
    });
  });

  it("开启 Beta 接收后检查更新应传 allowBeta=true", async () => {
    const store = useSettingsStore();
    await store.update("allowBetaUpdates", true);
    const wrapper = mountComponent();
    invokeMock.mockClear();

    const updateBtn = wrapper.findAll(".update-btn")[1];
    await updateBtn.trigger("click");
    await flushPromises();

    expect(invokeMock).toHaveBeenCalledWith("check_update", {
      source: "github",
      allowBeta: true,
    });
  });
});
