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

  it("默认 light 主题不应在 container 上应用 dark-theme class", async () => {
    const wrapper = await mountApp();
    const container = wrapper.find(".container");
    expect(container.classes()).not.toContain("dark-theme");
  });

  it("切换到 dark 主题应在 container 上应用 dark-theme class", async () => {
    const wrapper = await mountApp();
    const settings = useSettingsStore();
    await settings.update("theme", "dark");
    await wrapper.vm.$nextTick();
    const container = wrapper.find(".container");
    expect(container.classes()).toContain("dark-theme");
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

  // ===== 专注模式（奖惩机制）=====

  /** 触发专注模式开关 stub 的 toggle 事件 */
  async function toggleFocusMode(wrapper: ReturnType<typeof mountApp> extends Promise<infer T> ? T : never, active: boolean) {
    const fgSwitch = wrapper.findComponent({ name: "FocusModeSwitch" });
    await fgSwitch.vm.$emit("toggle", active);
    await wrapper.vm.$nextTick();
  }

  it("专注模式开启且运行中，点击暂停按钮应无效（不能轻易停止番茄钟）", async () => {
    const wrapper = await mountApp();
    const timer = useTimerStore();
    timer.start(); // running
    await toggleFocusMode(wrapper, true);
    // 点击开始/暂停按钮
    await wrapper.find(".btn-start").trigger("click");
    await wrapper.vm.$nextTick();
    expect(timer.phase).toBe("running");
    timer.reset(); // 清理 interval
  });

  it("专注模式运行中按空格键也不应暂停", async () => {
    const wrapper = await mountApp();
    const timer = useTimerStore();
    timer.start();
    await toggleFocusMode(wrapper, true);
    const event = new KeyboardEvent("keydown", { code: "Space" });
    Object.defineProperty(event, "target", { value: document.body, writable: false });
    window.dispatchEvent(event);
    expect(timer.phase).toBe("running");
    timer.reset();
  });

  it("未开启专注模式时，点击暂停按钮应正常暂停", async () => {
    const wrapper = await mountApp();
    const timer = useTimerStore();
    timer.start();
    await wrapper.find(".btn-start").trigger("click");
    await wrapper.vm.$nextTick();
    expect(timer.phase).toBe("paused");
    timer.reset();
  });

  it("专注模式运行中点击重置应触发惩罚（枯萎 + 关闭专注模式 + 弹窗）", async () => {
    const wrapper = await mountApp();
    const timer = useTimerStore();
    const garden = useGardenStore();
    const punishSpy = vi.spyOn(garden, "punish").mockResolvedValue({
      hasLoss: true,
      losses: [{ crop: "carrot", name: "胡萝卜", icon: "🥕", progress: 10, growTime: 25 }],
      totalMinutes: 10,
    });
    timer.start();
    await toggleFocusMode(wrapper, true);
    await wrapper.find(".btn-reset").trigger("click");
    await flushPromises();
    // 花园惩罚被调用
    expect(punishSpy).toHaveBeenCalled();
    // 计时器重置
    expect(timer.phase).toBe("ready");
    // 惩罚结果弹窗可见
    const vm = wrapper.vm as unknown as { showPunishmentResult: boolean };
    expect(vm.showPunishmentResult).toBe(true);
    // 专注模式已关闭（ForegroundWarning stub 的 active prop = false）
    const fgWarning = wrapper.findComponent({ name: "ForegroundWarning" });
    expect(fgWarning.props("active")).toBe(false);
  });

  it("专注模式开启后未完成番茄钟就手动关闭应触发惩罚", async () => {
    const wrapper = await mountApp();
    const timer = useTimerStore();
    const garden = useGardenStore();
    const punishSpy = vi.spyOn(garden, "punish").mockResolvedValue({
      hasLoss: false,
      losses: [],
      totalMinutes: 0,
    });
    await toggleFocusMode(wrapper, true);
    await toggleFocusMode(wrapper, false);
    await flushPromises();
    expect(punishSpy).toHaveBeenCalled();
    const vm = wrapper.vm as unknown as { showPunishmentResult: boolean };
    expect(vm.showPunishmentResult).toBe(true);
    expect(timer.phase).toBe("ready");
  });

  it("番茄钟自然完成后手动关闭专注模式不应惩罚", async () => {
    vi.useFakeTimers();
    try {
      const wrapper = await mountApp();
      const timer = useTimerStore();
      const garden = useGardenStore();
      const punishSpy = vi.spyOn(garden, "punish").mockResolvedValue({
        hasLoss: false,
        losses: [],
        totalMinutes: 0,
      });
      await toggleFocusMode(wrapper, true);
      timer.start();
      // 推进一个完整工作番茄钟（25 分钟）→ 完成（completionId 增加）
      await vi.advanceTimersByTimeAsync(25 * 60 * 1000);
      expect(timer.completionId).toBe(1);
      // 完成后 phase 立即回到 ready（break 模式）
      expect(timer.phase).toBe("ready");
      await toggleFocusMode(wrapper, false);
      await flushPromises();
      expect(punishSpy).not.toHaveBeenCalled();
      const vm = wrapper.vm as unknown as { showPunishmentResult: boolean };
      expect(vm.showPunishmentResult).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("专注模式运行中每分钟应调用一次菜园成长", async () => {
    vi.useFakeTimers();
    try {
      const wrapper = await mountApp();
      const timer = useTimerStore();
      const garden = useGardenStore();
      const growSpy = vi.spyOn(garden, "grow").mockResolvedValue(true);
      timer.start();
      await toggleFocusMode(wrapper, true);
      await vi.advanceTimersByTimeAsync(60000);
      expect(growSpy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60000);
      expect(growSpy).toHaveBeenCalledTimes(2);
      // 停止计时后不再成长
      timer.reset();
      await vi.advanceTimersByTimeAsync(60000);
      expect(growSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("专注模式关闭时不应启动菜园成长", async () => {
    vi.useFakeTimers();
    try {
      const wrapper = await mountApp();
      const timer = useTimerStore();
      const garden = useGardenStore();
      const growSpy = vi.spyOn(garden, "grow").mockResolvedValue(true);
      timer.start();
      // 未开启专注模式
      await vi.advanceTimersByTimeAsync(120000);
      expect(growSpy).not.toHaveBeenCalled();
      timer.reset();
    } finally {
      vi.useRealTimers();
    }
  });

  // ===== 计划模式（颜色联动 + 执行）=====

  /** 添加计划项（通过模板按钮） */
  async function addPlanItem(wrapper: ReturnType<typeof mountApp> extends Promise<infer T> ? T : never, type: "work" | "break") {
    await wrapper.vm.$nextTick(); // 等待 plan 面板渲染
    const btn = type === "work" ? wrapper.find(".btn-add-work") : wrapper.find(".btn-add-break");
    await btn.trigger("click");
    await wrapper.vm.$nextTick();
  }

  it("计划模式未开始时容器颜色应跟随第一项类型（第一项 break → break-mode）", async () => {
    const wrapper = await mountApp();
    const timer = useTimerStore();
    timer.setAppMode("plan");
    await addPlanItem(wrapper, "break");
    expect(wrapper.find(".container").classes()).toContain("break-mode");
    // 第二项 work 不影响（仍看第一项）
    await addPlanItem(wrapper, "work");
    expect(wrapper.find(".container").classes()).toContain("break-mode");
  });

  it("计划模式第一项为 work 时不应有 break-mode", async () => {
    const wrapper = await mountApp();
    const timer = useTimerStore();
    timer.setAppMode("plan");
    await addPlanItem(wrapper, "work");
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".container").classes()).not.toContain("break-mode");
  });

  it("计划模式下点击开始应启动计划（第一项开始计时）", async () => {
    const wrapper = await mountApp();
    const timer = useTimerStore();
    timer.setAppMode("plan");
    await addPlanItem(wrapper, "work");
    await wrapper.find(".btn-start").trigger("click");
    await wrapper.vm.$nextTick();
    expect(timer.phase).toBe("running");
    const vm = wrapper.vm as unknown as { planRunning: boolean; planCurrentIndex: number };
    expect(vm.planRunning).toBe(true);
    expect(vm.planCurrentIndex).toBe(0);
    timer.reset();
  });

  it("计划完成一项后应自动进入下一项并跟随其颜色", async () => {
    vi.useFakeTimers();
    try {
      const wrapper = await mountApp();
      const timer = useTimerStore();
      timer.setAppMode("plan");
      await addPlanItem(wrapper, "work");  // 25min work
      await addPlanItem(wrapper, "break"); // 5min break
      await wrapper.find(".btn-start").trigger("click");
      // 完成第一项（work）
      await vi.advanceTimersByTimeAsync(25 * 60 * 1000 + 1000);
      const vm = wrapper.vm as unknown as { planRunning: boolean; planCurrentIndex: number };
      expect(vm.planRunning).toBe(true);
      expect(vm.planCurrentIndex).toBe(1);
      // 颜色跟随第二项（break）
      expect(wrapper.find(".container").classes()).toContain("break-mode");
      // 1s 后自动开始第二项
      await vi.advanceTimersByTimeAsync(1000);
      expect(timer.phase).toBe("running");
    } finally {
      vi.useRealTimers();
    }
  });

  it("计划全部完成后应停止计划", async () => {
    vi.useFakeTimers();
    try {
      const wrapper = await mountApp();
      const timer = useTimerStore();
      timer.setAppMode("plan");
      await addPlanItem(wrapper, "work");
      await wrapper.find(".btn-start").trigger("click");
      await vi.advanceTimersByTimeAsync(25 * 60 * 1000 + 1000);
      const vm = wrapper.vm as unknown as { planRunning: boolean; planCurrentIndex: number };
      expect(vm.planRunning).toBe(false);
      expect(vm.planCurrentIndex).toBe(-1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("计划模式运行中点击重置应停止计划", async () => {
    const wrapper = await mountApp();
    const timer = useTimerStore();
    timer.setAppMode("plan");
    await addPlanItem(wrapper, "work");
    await wrapper.find(".btn-start").trigger("click");
    await wrapper.find(".btn-reset").trigger("click");
    await wrapper.vm.$nextTick();
    const vm = wrapper.vm as unknown as { planRunning: boolean; planCurrentIndex: number };
    expect(vm.planRunning).toBe(false);
    expect(timer.phase).toBe("ready");
  });

  // ===== 菜园子联动（v3 隔离架构：完成/中断统一信号）=====

  it("番茄钟自然完成后应调用 garden.recordFocus(true)", async () => {
    vi.useFakeTimers();
    try {
      const wrapper = await mountApp();
      const timer = useTimerStore();
      const garden = useGardenStore();
      const recordFocusSpy = vi.spyOn(garden, "recordFocus").mockResolvedValue(true);
      timer.start();
      await vi.advanceTimersByTimeAsync(25 * 60 * 1000);
      await flushPromises();
      expect(recordFocusSpy).toHaveBeenCalledTimes(1);
      expect(recordFocusSpy).toHaveBeenCalledWith(true);
      timer.reset();
    } finally {
      vi.useRealTimers();
    }
  });

  it("专注模式运行中点击重置（惩罚路径）应调用 garden.recordFocus(false)", async () => {
    const wrapper = await mountApp();
    const timer = useTimerStore();
    const garden = useGardenStore();
    const recordFocusSpy = vi.spyOn(garden, "recordFocus").mockResolvedValue(true);
    vi.spyOn(garden, "punish").mockResolvedValue({
      hasLoss: false,
      losses: [],
      totalMinutes: 0,
    });
    timer.start();
    await toggleFocusMode(wrapper, true);
    await wrapper.find(".btn-reset").trigger("click");
    await flushPromises();
    expect(recordFocusSpy).toHaveBeenCalledWith(false);
    expect(timer.phase).toBe("ready");
  });

  it("专注模式未完成番茄钟就手动关闭应调用 garden.recordFocus(false)", async () => {
    const wrapper = await mountApp();
    const timer = useTimerStore();
    const garden = useGardenStore();
    const recordFocusSpy = vi.spyOn(garden, "recordFocus").mockResolvedValue(true);
    vi.spyOn(garden, "punish").mockResolvedValue({
      hasLoss: false,
      losses: [],
      totalMinutes: 0,
    });
    timer.start();
    await toggleFocusMode(wrapper, true);
    await toggleFocusMode(wrapper, false);
    await flushPromises();
    expect(recordFocusSpy).toHaveBeenCalledWith(false);
  });

  it("番茄钟完成后手动关闭专注模式不应再 recordFocus(false)（承诺已兑现）", async () => {
    vi.useFakeTimers();
    try {
      const wrapper = await mountApp();
      const timer = useTimerStore();
      const garden = useGardenStore();
      const recordFocusSpy = vi.spyOn(garden, "recordFocus").mockResolvedValue(true);
      const punishSpy = vi.spyOn(garden, "punish").mockResolvedValue({
        hasLoss: false,
        losses: [],
        totalMinutes: 0,
      });
      await toggleFocusMode(wrapper, true);
      timer.start();
      await vi.advanceTimersByTimeAsync(25 * 60 * 1000);
      expect(timer.completionId).toBe(1);
      await toggleFocusMode(wrapper, false);
      await flushPromises();
      // 完成时已发过 true；关闭（承诺兑现）不应再发 false
      expect(recordFocusSpy).toHaveBeenCalledTimes(1);
      expect(recordFocusSpy).toHaveBeenCalledWith(true);
      expect(punishSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("非专注模式运行中普通重置应调用 garden.recordFocus(false)（放弃专注=断了）", async () => {
    const wrapper = await mountApp();
    const timer = useTimerStore();
    const garden = useGardenStore();
    const recordFocusSpy = vi.spyOn(garden, "recordFocus").mockResolvedValue(true);
    timer.start();
    await wrapper.find(".btn-reset").trigger("click");
    await flushPromises();
    expect(recordFocusSpy).toHaveBeenCalledWith(false);
    expect(timer.phase).toBe("ready");
  });

  it("前台娱乐检测触发惩罚时应调用 garden.recordFocus(false)", async () => {
    const wrapper = await mountApp();
    const timer = useTimerStore();
    const garden = useGardenStore();
    const recordFocusSpy = vi.spyOn(garden, "recordFocus").mockResolvedValue(true);
    vi.spyOn(garden, "punish").mockResolvedValue({
      hasLoss: true,
      losses: [{ crop: "carrot", name: "胡萝卜", icon: "🥕", progress: 10, growTime: 25 }],
      totalMinutes: 10,
    });
    timer.start();
    await toggleFocusMode(wrapper, true);
    const fgWarning = wrapper.findComponent({ name: "ForegroundWarning" });
    await fgWarning.vm.$emit("punishment");
    await flushPromises();
    expect(recordFocusSpy).toHaveBeenCalledWith(false);
    expect(timer.phase).toBe("ready");
  });
});
