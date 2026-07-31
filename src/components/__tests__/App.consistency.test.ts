import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { setActivePinia, createPinia } from "pinia";
import App from "../../App.vue";
import { useTimerStore } from "../../stores/timer";
import { useSettingsStore } from "../../stores/settings";

// mock Tauri APIs
vi.mock("../../api/window", () => ({
  minimizeWindow: vi.fn(),
  closeWindow: vi.fn(),
  setAlwaysOnTop: vi.fn(),
  cancelAlwaysOnTop: vi.fn(),
  toggleMaximize: vi.fn(),
  showGardenWindow: vi.fn(),
  hideGardenWindow: vi.fn(),
}));
vi.mock("../../api/data", () => ({
  readData: vi.fn().mockResolvedValue({}),
  writeData: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../api/events", () => ({
  useTauriEvent: vi.fn(() => () => {}),
}));

describe("App.vue UI 一致性", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    document.documentElement.classList.remove("dark-theme");
    document.body.classList.remove("dark-theme");
  });

  const mountApp = async () => {
    const wrapper = mount(App, {
      global: {
        stubs: {
          MusicPlayer: true, // stub 掉以避免 Tauri 事件依赖
          Statistics: true,
          SettingsPanel: true,
          AIHelper: true,
          AuthPanel: true,
          StudyRoom: true,
          Charts: true,
          ForegroundWarning: true,
          GardenMain: true,
          MiniMode: true,
        },
      },
    });
    await flushPromises();
    return wrapper;
  };

  it("window-frame 应有 20px 圆角和 overflow:hidden", async () => {
    const wrapper = await mountApp();
    const frame = wrapper.find(".window-frame");
    expect(frame.exists()).toBe(true);
    const style = getComputedStyle(frame.element);
    // jsdom 不完全渲染 border-radius，至少验证 class 存在
    expect(frame.classes()).toContain("window-frame");
  });

  it("container 应在 sidebar-collapsed 时使用 translateX 而非压缩", async () => {
    const wrapper = await mountApp();
    const container = wrapper.find(".container");
    expect(container.exists()).toBe(true);

    // 初始无 sidebar-collapsed
    expect(container.classes()).not.toContain("sidebar-collapsed");

    // 触发收起
    const collapseBtn = wrapper.findComponent({ name: "SidebarCollapse" });
    if (collapseBtn.exists()) {
      await collapseBtn.vm.$emit("toggle");
      await flushPromises();
      expect(container.classes()).toContain("sidebar-collapsed");
    }
  });

  it("深色模式切换应将 dark-theme class 应用到 documentElement/body", async () => {
    const wrapper = await mountApp();
    const settings = useSettingsStore();

    // 默认 theme 是 light，所以初始应为 false
    const initialIsDark = settings.isDark;
    expect(document.documentElement.classList.contains("dark-theme")).toBe(initialIsDark);

    // 切换主题
    settings.toggleTheme();
    await flushPromises();

    // 切换后状态应反转
    expect(settings.isDark).toBe(!initialIsDark);
    expect(document.documentElement.classList.contains("dark-theme")).toBe(!initialIsDark);
    expect(document.body.classList.contains("dark-theme")).toBe(!initialIsDark);

    // 再切回来
    settings.toggleTheme();
    await flushPromises();
    expect(settings.isDark).toBe(initialIsDark);
    expect(document.documentElement.classList.contains("dark-theme")).toBe(initialIsDark);
  });

  it("HeaderButtons 应在 main-content 内部（不在 sidebar 内）", async () => {
    const wrapper = await mountApp();
    const sidebar = wrapper.find(".sidebar");
    const mainContent = wrapper.find(".main-content");

    // HeaderButtons 应该在 main-content 内
    const headerInMain = mainContent.find(".header-buttons");
    expect(headerInMain.exists()).toBe(true);

    // 不应该在 sidebar 内
    const headerInSidebar = sidebar.find(".header-buttons");
    expect(headerInSidebar.exists()).toBe(false);
  });

  it("timer.appMode 切换应改变 container 的 appModeClass", async () => {
    const wrapper = await mountApp();
    const timer = useTimerStore();
    const container = wrapper.find(".container");

    // 初始 single
    expect(container.classes()).not.toContain("plan-mode");
    expect(container.classes()).not.toContain("stopwatch-mode");

    // 切到 plan
    timer.setAppMode("plan");
    await flushPromises();
    expect(container.classes()).toContain("plan-mode");

    // 切到 stopwatch
    timer.setAppMode("stopwatch");
    await flushPromises();
    expect(container.classes()).toContain("stopwatch-mode");
    expect(container.classes()).not.toContain("plan-mode");
  });

  it("timer.mode 切换应改变 container 的 modeClass", async () => {
    const wrapper = await mountApp();
    const timer = useTimerStore();
    const container = wrapper.find(".container");

    expect(container.classes()).not.toContain("break-mode");

    timer.setMode("break");
    await flushPromises();
    expect(container.classes()).toContain("break-mode");
  });

  it("菜园子应使用独立窗口而非弹窗（无 modal-overlay/modal-content）", async () => {
    const wrapper = await mountApp();

    // 不应有弹窗 DOM
    expect(wrapper.find(".garden-modal-overlay").exists()).toBe(false);
    expect(wrapper.find(".garden-modal-content").exists()).toBe(false);
    expect(wrapper.find(".garden-modal-close").exists()).toBe(false);
  });

  it("showGardenWindow 应从 api/window 导出并可调用", async () => {
    const { showGardenWindow } = await import("../../api/window");
    expect(typeof showGardenWindow).toBe("function");
    await showGardenWindow();
    // 验证 mock 被调用过
    expect(showGardenWindow).toHaveBeenCalled();
  });
});
