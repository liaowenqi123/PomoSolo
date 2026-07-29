import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";

// Mock @tauri-apps/api/core（store 间接依赖）
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// Mock @tauri-apps/api/event（MusicPlayer 间接依赖）
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
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
          ModeSlider: true,
          WindowControls: true,
          PinButton: true,
          HeaderButtons: true,
          SidebarCollapse: true,
          FocusModeSwitch: true,
          MiniMode: true,
          MusicPlayer: true,
          SettingsPanel: true,
          Statistics: true,
          Presets: true,
          NoteManager: true,
          AIHelper: true,
          AuthPanel: true,
          StudyRoom: true,
          Charts: true,
          ForegroundWarning: true,
          GardenMain: true,
        },
      },
    });
    await flushPromises();
    return wrapper;
  };

  // ===== 布局渲染 =====

  it("应渲染 .window-frame 根容器", async () => {
    const wrapper = await mountApp();
    expect(wrapper.find(".window-frame").exists()).toBe(true);
  });

  it("应渲染 .container 内层容器", async () => {
    const wrapper = await mountApp();
    expect(wrapper.find(".container").exists()).toBe(true);
  });

  it("应渲染 .sidebar 侧边栏", async () => {
    const wrapper = await mountApp();
    expect(wrapper.find(".sidebar").exists()).toBe(true);
  });

  it("应渲染 .main-content 主区域", async () => {
    const wrapper = await mountApp();
    expect(wrapper.find(".main-content").exists()).toBe(true);
  });

  it("应渲染 .timer-section 计时器区域", async () => {
    const wrapper = await mountApp();
    expect(wrapper.find(".timer-section").exists()).toBe(true);
  });

  // ===== 主题 class =====

  it("默认 dark 主题应在 container 上应用 dark-theme class", async () => {
    const wrapper = await mountApp();
    const container = wrapper.find(".container");
    expect(container.classes()).toContain("dark-theme");
  });

  it("切换到 light 主题应移除 dark-theme class", async () => {
    const wrapper = await mountApp();
    const settings = useSettingsStore();
    await settings.update("theme", "light");
    await wrapper.vm.$nextTick();
    const container = wrapper.find(".container");
    expect(container.classes()).not.toContain("dark-theme");
  });

  it("timer.mode === 'break' 时应应用 break-mode class", async () => {
    const wrapper = await mountApp();
    const timer = useTimerStore();
    timer.setMode("break");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".container").classes()).toContain("break-mode");
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

  // ===== 键盘事件 =====

  it("按空格键应切换计时器运行状态", async () => {
    const wrapper = await mountApp();
    const timer = useTimerStore();
    const startSpy = vi.spyOn(timer, "toggle");
    // jsdom 中 KeyboardEvent target 可能不是 document.body，直接 dispatch
    const event = new KeyboardEvent("keydown", { code: "Space" });
    Object.defineProperty(event, "target", { value: document.body, writable: false });
    window.dispatchEvent(event);
    expect(startSpy).toHaveBeenCalled();
  });

  it("按 Escape 应关闭设置面板", async () => {
    const wrapper = await mountApp();
    const vm = wrapper.vm as unknown as { showSettings: boolean };
    vm.showSettings = true;
    await wrapper.vm.$nextTick();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();
    expect(vm.showSettings).toBe(false);
  });

  // ===== 卸载 =====

  it("卸载后按空格不应再调用 toggle", async () => {
    const wrapper = await mountApp();
    const timer = useTimerStore();
    const startSpy = vi.spyOn(timer, "toggle");
    wrapper.unmount();
    startSpy.mockClear();
    const event = new KeyboardEvent("keydown", { code: "Space" });
    Object.defineProperty(event, "target", { value: document.body, writable: false });
    window.dispatchEvent(event);
    expect(startSpy).not.toHaveBeenCalled();
  });
});
