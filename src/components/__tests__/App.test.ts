import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

// Mock @tauri-apps/api/core（store 间接依赖）
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import App from "../../App.vue";
import { useTimerStore } from "../../stores/timer";
import { useSettingsStore } from "../../stores/settings";
import { useStatsStore } from "../../stores/stats";
import { useGardenStore } from "../../stores/garden";

describe("App.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mountApp = async () => {
    const wrapper = mount(App, {
      global: {
        stubs: {
          Timer: true,
          TimerProgress: true,
          ModeSwitch: true,
          WindowControls: true,
          SettingsPanel: true,
          Statistics: true,
          Presets: true,
          NoteManager: true,
        },
      },
    });
    await flushPromises();
    return wrapper;
  };

  // ===== 布局渲染 =====

  it("应渲染 .app 根容器", async () => {
    const wrapper = await mountApp();
    expect(wrapper.find(".app").exists()).toBe(true);
  });

  it("应渲染顶部窗口控制条 .app__topbar", async () => {
    const wrapper = await mountApp();
    expect(wrapper.find(".app__topbar").exists()).toBe(true);
  });

  it("应渲染主区域 .app__main", async () => {
    const wrapper = await mountApp();
    expect(wrapper.find(".app__main").exists()).toBe(true);
  });

  it("应渲染底部导航 .app__nav", async () => {
    const wrapper = await mountApp();
    expect(wrapper.find(".app__nav").exists()).toBe(true);
  });

  it("底部导航应包含『统计』和『设置』两个按钮", async () => {
    const wrapper = await mountApp();
    const labels = wrapper.findAll(".nav-btn__label").map((el) => el.text());
    expect(labels).toContain("统计");
    expect(labels).toContain("设置");
  });

  // ===== 主题 class =====

  it("默认 dark 主题应应用 app--dark class", async () => {
    const wrapper = await mountApp();
    expect(wrapper.find(".app").classes()).toContain("app--dark");
    expect(wrapper.find(".app").classes()).not.toContain("app--light");
  });

  it("切换到 light 主题应应用 app--light class", async () => {
    const wrapper = await mountApp();
    const settings = useSettingsStore();
    await settings.update("theme", "light");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".app").classes()).toContain("app--light");
    expect(wrapper.find(".app").classes()).not.toContain("app--dark");
  });

  it("timer.mode === 'break' 时应应用 app--break class", async () => {
    const wrapper = await mountApp();
    const timer = useTimerStore();
    timer.setMode("break");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".app").classes()).toContain("app--break");
  });

  // ===== onMounted 生命周期 =====

  it("挂载时应调用 settings.load / stats.load / garden.load", async () => {
    const settings = useSettingsStore();
    const stats = useStatsStore();
    const garden = useGardenStore();
    const settingsSpy = vi.spyOn(settings, "load");
    const statsSpy = vi.spyOn(stats, "load");
    const gardenSpy = vi.spyOn(garden, "load");
    await mountApp();
    expect(settingsSpy).toHaveBeenCalledTimes(1);
    expect(statsSpy).toHaveBeenCalledTimes(1);
    expect(gardenSpy).toHaveBeenCalledTimes(1);
  });

  it("挂载后应同步 stats.todayCount 到 timer.todayCount", async () => {
    // 让 read_data 返回带 todayCount 的数据
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_data") {
        return Promise.resolve({
          date: new Date().toDateString(),
          todayCount: 5,
          totalMinutes: 120,
          statisticsHistory: [],
        });
      }
      return Promise.resolve({});
    });
    const wrapper = await mountApp();
    const timer = useTimerStore();
    expect(timer.todayCount).toBe(5);
    expect(timer.totalMinutes).toBe(120);
    wrapper.unmount();
  });

  // ===== 导航交互 =====

  it("点击『统计』按钮应打开 Statistics 面板（nav-btn--active）", async () => {
    const wrapper = await mountApp();
    const statsBtn = wrapper.findAll(".nav-btn")[0];
    await statsBtn.trigger("click");
    expect(statsBtn.classes()).toContain("nav-btn--active");
  });

  it("点击『设置』按钮应打开 SettingsPanel 面板（nav-btn--active）", async () => {
    const wrapper = await mountApp();
    const settingsBtn = wrapper.findAll(".nav-btn")[1];
    await settingsBtn.trigger("click");
    expect(settingsBtn.classes()).toContain("nav-btn--active");
  });

  // ===== 键盘快捷键 =====

  it("按 Space（target=body）应切换计时器状态", async () => {
    const wrapper = await mountApp();
    const timer = useTimerStore();
    const startSpy = vi.spyOn(timer, "toggle");
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Space", bubbles: true }),
    );
    await wrapper.vm.$nextTick();
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("按 Escape 应关闭打开的面板", async () => {
    const wrapper = await mountApp();
    // 先打开统计面板
    await wrapper.findAll(".nav-btn")[0].trigger("click");
    // 按 ESC
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await wrapper.vm.$nextTick();
    // nav-btn--active 应被移除
    expect(wrapper.findAll(".nav-btn--active")).toHaveLength(0);
  });

  // ===== 完成事件联动 =====

  it("timer.completionId 增加时应调用 stats.recordSession 和 garden.addFocus", async () => {
    const wrapper = await mountApp();
    const timer = useTimerStore();
    const stats = useStatsStore();
    const garden = useGardenStore();
    const recordSpy = vi.spyOn(stats, "recordSession").mockResolvedValue();
    const addFocusSpy = vi.spyOn(garden, "addFocus").mockResolvedValue(true);

    // 模拟完成一次工作番茄钟
    timer.start();
    // 推进时间到完成（fake timers 在其他测试中已使用，这里通过直接调用 complete）
    // 直接修改 completionId 触发 watch
    timer.completionId += 1;
    timer.lastCompletedMinutes = 25;
    await flushPromises();

    expect(recordSpy).toHaveBeenCalledWith(25, "");
    expect(addFocusSpy).toHaveBeenCalledWith(25);
  });

  it("完成工作番茄钟后应同步 stats.todayCount/totalMinutes 回 timer", async () => {
    const wrapper = await mountApp();
    const timer = useTimerStore();
    const stats = useStatsStore();
    const garden = useGardenStore();
    vi.spyOn(stats, "recordSession").mockImplementation(async () => {
      stats.stats.todayCount += 1;
      stats.stats.totalMinutes += 25;
    });
    vi.spyOn(garden, "addFocus").mockResolvedValue(true);

    timer.completionId += 1;
    timer.lastCompletedMinutes = 25;
    await flushPromises();

    expect(timer.todayCount).toBe(stats.todayCount);
    expect(timer.totalMinutes).toBe(stats.totalMinutes);
  });

  // ===== 卸载清理 =====

  it("卸载时应移除 keydown 监听器", async () => {
    const wrapper = await mountApp();
    const timer = useTimerStore();
    const toggleSpy = vi.spyOn(timer, "toggle");
    wrapper.unmount();
    // 卸载后按键不应再触发
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { code: "Space", bubbles: true }),
    );
    expect(toggleSpy).not.toHaveBeenCalled();
  });
});
