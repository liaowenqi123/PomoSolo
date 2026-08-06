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

// Mock @tauri-apps/api/event（useTauriEvent 间接依赖 listen；捕获 handler 供测试触发事件）
const eventHandlers = vi.hoisted(() => new Map<string, (e: { payload: unknown }) => void>());
const eventApi = vi.hoisted(() => ({
  listen: vi.fn(),
  emit: vi.fn(() => Promise.resolve()),
}));
vi.mock("@tauri-apps/api/event", () => eventApi);

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

// Mock @/api/seed（Phase 2 种子查询）
const seedApi = vi.hoisted(() => ({
  seedRegister: vi.fn(),
  seedHeartbeat: vi.fn(),
  seedUnregister: vi.fn(),
  seedList: vi.fn(),
}));
vi.mock("@/api/seed", () => seedApi);

// Mock @/seed（Phase 2 种子管理器）
const seedManagerApi = vi.hoisted(() => ({
  startSeedSharing: vi.fn(),
  stopSeedSharing: vi.fn(),
}));
vi.mock("@/seed", () => seedManagerApi);

// Mock @/p2p（Phase 2 P2P 接收，jsdom 无 RTCPeerConnection）
const p2pApi = vi.hoisted(() => ({
  p2pReceive: vi.fn(),
  p2pSend: vi.fn(),
}));
vi.mock("@/p2p", () => p2pApi);

import SettingsPanel from "../SettingsPanel.vue";
import { useSettingsStore, DEFAULT_SETTINGS } from "../../stores/settings";
import { useGardenStore } from "../../stores/garden";
import {
  checkUpdate,
  downloadAndInstall,
  type UpdateStatusPayload,
} from "@/api/update";

describe("SettingsPanel.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    eventHandlers.clear();
    eventApi.listen.mockReset();
    // 捕获事件 handler 供测试触发（模拟后端 emit update-status）
    eventApi.listen.mockImplementation((_name: string, handler: (e: { payload: unknown }) => void) => {
      eventHandlers.set(_name, handler);
      return Promise.resolve(() => {});
    });
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
    seedApi.seedList.mockReset();
    seedApi.seedList.mockResolvedValue([]);
    seedManagerApi.startSeedSharing.mockReset();
    seedManagerApi.startSeedSharing.mockResolvedValue(undefined);
    seedManagerApi.stopSeedSharing.mockReset();
    seedManagerApi.stopSeedSharing.mockResolvedValue(undefined);
    p2pApi.p2pReceive.mockReset();
    p2pApi.p2pSend.mockReset();
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

  it("应渲染所有开关（外观2+功能按钮5+导航2+音乐3+种植1+系统1+Beta1+分享1=16）", () => {
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
    // 索引 13：开机自启动（索引 14 接收 Beta，索引 15 分享安装包）
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

  // ===== 服务器公告（v4.5.21） =====

  /** 模拟后端 update-status 事件（触发组件监听的回调） */
  function emitUpdateStatus(payload: UpdateStatusPayload): void {
    const handler = eventHandlers.get("update-status")!;
    expect(handler).toBeDefined();
    handler({ payload });
  }

  it("更新失败时应展示服务器公告（含官方指引链接）", async () => {
    invokeMock.mockResolvedValue({
      active: true,
      level: "warning",
      text: "自动更新异常，请手动下载 v4.5.20 覆盖安装",
      url: "http://115.159.49.112/updates/PomoSolo_4.5.20_x64-setup.exe",
      min_version: "4.5.15",
      max_version: "4.5.19",
    });
    const wrapper = mountComponent();

    // 等 getVersion 异步 resolve（appVersion 就绪后事件触发才会带上正确版本号）
    await flushPromises();

    emitUpdateStatus({ status: "error", message: "签名验证失败" });
    await flushPromises();

    // 错误提示仍在
    expect(wrapper.find(".update-status--error").text()).toContain("更新失败");
    // 公告条已展示
    const notice = wrapper.find(".update-notice");
    expect(notice.exists()).toBe(true);
    expect(notice.classes()).toContain("update-notice--warning");
    expect(notice.text()).toContain("自动更新异常");
    // 指引链接指向服务器安装包
    const link = notice.find(".update-notice__link");
    expect(link.exists()).toBe(true);
    expect(link.attributes("href")).toBe(
      "http://115.159.49.112/updates/PomoSolo_4.5.20_x64-setup.exe",
    );
    // 拉取公告时携带当前应用版本
    expect(invokeMock).toHaveBeenCalledWith("fetch_notice", { version: "0.0.0" });
  });

  it("点击公告关闭按钮应隐藏公告条", async () => {
    invokeMock.mockResolvedValue({ active: true, text: "官方指引" });
    const wrapper = mountComponent();

    emitUpdateStatus({ status: "error", message: "下载失败" });
    await flushPromises();
    expect(wrapper.find(".update-notice").exists()).toBe(true);

    await wrapper.find(".update-notice__close").trigger("click");
    await flushPromises();
    expect(wrapper.find(".update-notice").exists()).toBe(false);
  });

  it("公告拉取失败时应静默（不显示公告，不影响错误提示）", async () => {
    invokeMock.mockRejectedValue(new Error("network error"));
    const wrapper = mountComponent();

    emitUpdateStatus({ status: "error", message: "网络错误" });
    await flushPromises();

    expect(wrapper.find(".update-notice").exists()).toBe(false);
    expect(wrapper.find(".update-status--error").text()).toContain("更新失败");
  });

  // ===== Phase 2：分享安装包（P2P 种子）=====

  /** 分享安装包开关（toggle 列表最后一个，索引 15：索引 14 是接收 Beta） */
  const shareToggle = (wrapper: ReturnType<typeof mountComponent>) =>
    wrapper.findAll('.settings-row--toggle input[type="checkbox"]')[15];

  it("开启分享安装包：已登录时应注册种子并持久化开关", async () => {
    // cloud_get_session 返回登录会话（invoke 返回 Session 对象）
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "cloud_get_session") return Promise.resolve({ id: "u1", username: "test", admin: false });
      return Promise.resolve(undefined);
    });
    const store = useSettingsStore();
    const wrapper = mountComponent();
    await shareToggle(wrapper).setValue(true);
    await flushPromises();

    expect(seedManagerApi.startSeedSharing).toHaveBeenCalledTimes(1);
    expect(seedManagerApi.startSeedSharing).toHaveBeenCalledWith("0.0.0");
    expect(store.settings.shareInstaller).toBe(true);
    expect(wrapper.text()).toContain("分享中（本机作为 P2P 种子）");
  });

  it("开启分享安装包：未登录时应回滚开关并提示需登录", async () => {
    const store = useSettingsStore();
    const wrapper = mountComponent();
    await shareToggle(wrapper).setValue(true);
    await flushPromises();

    expect(seedManagerApi.startSeedSharing).not.toHaveBeenCalled();
    expect(store.settings.shareInstaller).toBe(false);
    expect(wrapper.text()).toContain("分享安装包需先登录");
  });

  it("关闭分享安装包应注销种子并回滚开关", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "cloud_get_session") return Promise.resolve({ id: "u1", username: "test", admin: false });
      return Promise.resolve(undefined);
    });
    const store = useSettingsStore();
    const wrapper = mountComponent();
    await shareToggle(wrapper).setValue(true);
    await flushPromises();
    expect(store.settings.shareInstaller).toBe(true);

    await shareToggle(wrapper).setValue(false);
    await flushPromises();
    expect(seedManagerApi.stopSeedSharing).toHaveBeenCalledTimes(1);
    expect(store.settings.shareInstaller).toBe(false);
  });

  // ===== Phase 2：更新下载走 P2P 种子优先 =====

  /** 检查更新按钮（"提交反馈"按钮同 class，索引 1 才是检查更新） */
  const updateBtn = (wrapper: ReturnType<typeof mountComponent>) =>
    wrapper.findAll(".update-btn")[1];

  /** 模拟完整更新流程：检查（返回带签名信息）→ available 事件 → 点击下载按钮 */
  async function setupAvailableDownload(wrapper: ReturnType<typeof mountComponent>): Promise<void> {
    await updateBtn(wrapper).trigger("click"); // 检查更新
    await flushPromises();
    // 后端 emit available（按钮切为下载）
    const handler = eventHandlers.get("update-status")!;
    handler({ payload: { status: "available", version: "4.6.0-beta.0" } });
    await flushPromises();
    expect(updateBtn(wrapper).text()).toBe("下载更新");
  }

  it("有在线种子时下载应走 P2P 并成功（不触发 downloadAndInstall）", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "check_update") {
        return Promise.resolve({
          version: "4.6.0-beta.0",
          notes: "beta",
          date: null,
          signature: "dW50cnVzdGVk...",
        });
      }
      return Promise.resolve(undefined);
    });
    seedApi.seedList.mockResolvedValue(["peer-uuid"]);
    let receiveOpts: Record<string, unknown> | null = null;
    p2pApi.p2pReceive.mockImplementation((opts: Record<string, unknown>) => {
      receiveOpts = opts;
      return { close: vi.fn() };
    });
    const wrapper = mountComponent();
    await setupAvailableDownload(wrapper);

    await updateBtn(wrapper).trigger("click"); // 下载
    await flushPromises();

    // 查种子 → 初始化 P2P 接收
    expect(seedApi.seedList).toHaveBeenCalledWith("4.6.0-beta.0");
    expect(receiveOpts).not.toBeNull();
    expect(receiveOpts!.peerId).toBe("peer-uuid");
    expect(receiveOpts!.role).toBe("answerer");

    // 分片到达 → 逐片调 Rust 落盘
    const onChunk = receiveOpts!.onChunk as (chunk: Uint8Array, index: number, total: number) => Promise<void>;
    await onChunk(new Uint8Array([1, 2, 3]), 0, 2);
    expect(invokeMock).toHaveBeenCalledWith("update_seed_download_chunk", {
      chunk: [1, 2, 3],
      chunkIndex: 0,
      totalChunks: 2,
    });

    // P2P 完成 → 不触发 downloadAndInstall
    const callbacks = receiveOpts!.callbacks as { onComplete: () => void };
    callbacks.onComplete();
    await flushPromises();
    expect(invokeMock).not.toHaveBeenCalledWith("download_and_install", expect.anything());
    expect(wrapper.text()).toContain("P2P 下载完成");
  });

  it("无在线种子时下载应回退 downloadAndInstall", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "check_update") {
        return Promise.resolve({
          version: "4.6.0-beta.0",
          notes: "beta",
          date: null,
          signature: "dW50cnVzdGVk...",
        });
      }
      return Promise.resolve(undefined);
    });
    seedApi.seedList.mockResolvedValue([]);
    const wrapper = mountComponent();
    await setupAvailableDownload(wrapper);

    await updateBtn(wrapper).trigger("click");
    await flushPromises();

    expect(seedApi.seedList).toHaveBeenCalledWith("4.6.0-beta.0");
    expect(invokeMock).toHaveBeenCalledWith("download_and_install", {
      source: "github",
      allowBeta: false,
    });
    expect(p2pApi.p2pReceive).not.toHaveBeenCalled();
  });

  it("P2P 建连失败应中止并回退 downloadAndInstall", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "check_update") {
        return Promise.resolve({
          version: "4.6.0-beta.0",
          notes: "beta",
          date: null,
          signature: "dW50cnVzdGVk...",
        });
      }
      return Promise.resolve(undefined);
    });
    seedApi.seedList.mockResolvedValue(["peer-uuid"]);
    let receiveOpts: Record<string, unknown> | null = null;
    p2pApi.p2pReceive.mockImplementation((opts: Record<string, unknown>) => {
      receiveOpts = opts;
      return { close: vi.fn() };
    });
    const wrapper = mountComponent();
    await setupAvailableDownload(wrapper);

    await updateBtn(wrapper).trigger("click");
    await flushPromises();

    const callbacks = receiveOpts!.callbacks as { onError: (err: string) => void };
    callbacks.onError("NAT 打洞失败");
    await flushPromises();

    // 中止种子会话 + 回退服务器/GitHub
    expect(invokeMock).toHaveBeenCalledWith("update_seed_download_abort");
    expect(invokeMock).toHaveBeenCalledWith("download_and_install", {
      source: "github",
      allowBeta: false,
    });
  });
});
