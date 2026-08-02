import { defineStore, acceptHMRUpdate } from "pinia";
import { ref, computed } from "vue";

export type TimerPhase = "ready" | "running" | "paused" | "finished";
export type TimerMode = "work" | "break";
/** 应用模式：单次 / 计划 / 正向计时 */
export type AppMode = "single" | "plan" | "stopwatch";

const DEFAULT_WORK_MINUTES = 25;
const DEFAULT_BREAK_MINUTES = 5;
const TICK_INTERVAL_MS = 200;

export const useTimerStore = defineStore("timer", () => {
  // ===== State =====
  const phase = ref<TimerPhase>("ready");
  const mode = ref<TimerMode>("work");
  const appMode = ref<AppMode>("single");
  const remainingMs = ref(DEFAULT_WORK_MINUTES * 60 * 1000);
  const totalMs = ref(DEFAULT_WORK_MINUTES * 60 * 1000);
  const todayCount = ref(0);
  const totalMinutes = ref(0);
  /** 最近一次完成的工作番茄钟时长（分钟），供外部监听 */
  const lastCompletedMinutes = ref(0);
  /** 完成事件自增信号，每次工作番茄钟完成 +1，供外部 watch */
  const completionId = ref(0);
  /**
   * 计划模式步骤信号：计划模式下任意一项（work/break）完成 +1。
   * 供 App.vue 监听以自动进入下一计划项（单次模式不递增）。
   */
  const planStepId = ref(0);

  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let lastTickTime = 0;

  // ===== Getters =====
  const progress = computed(() => {
    if (totalMs.value === 0) return 0;
    return 1 - remainingMs.value / totalMs.value;
  });

  const displayTime = computed(() => {
    const totalSeconds = Math.ceil(remainingMs.value / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  });

  // Bug 2: isRunning 仅在 running 时为 true，paused/ready/finished 均为 false
  const isRunning = computed(() => phase.value === "running");

  // ===== Actions =====

  // Bug 5: 不再加载 settings（由 App.vue 调用 Presets.load() 应用预设）
  function init() {
    // no-op：保留函数以维持 API 兼容
  }

  function setMode(newMode: TimerMode) {
    if (phase.value === "running") return;
    mode.value = newMode;
    const minutes = newMode === "work" ? DEFAULT_WORK_MINUTES : DEFAULT_BREAK_MINUTES;
    totalMs.value = minutes * 60 * 1000;
    remainingMs.value = totalMs.value;
    phase.value = "ready";
  }

  // Bug 4: 切换模式但保留当前 totalMs，避免 complete() 覆盖用户预设时长
  function setModeKeepTime(newMode: TimerMode) {
    mode.value = newMode;
    remainingMs.value = totalMs.value;
    phase.value = "ready";
  }

  /** 切换应用模式（单次/计划/正向） */
  function setAppMode(newAppMode: AppMode) {
    if (phase.value === "running") return;
    appMode.value = newAppMode;
    phase.value = "ready";
    // Bug 7: 切换 appMode 时重置计时器状态
    if (newAppMode === "stopwatch") {
      remainingMs.value = 0;
    } else {
      remainingMs.value = totalMs.value;
    }
  }

  function start() {
    if (phase.value === "running") return;
    // Bug 3: phase="finished" 时 remainingMs=0，需重置为 totalMs 避免立即再次完成
    if (remainingMs.value <= 0) {
      remainingMs.value = totalMs.value;
    }
    // Bug 2: 从 paused 恢复到 running
    phase.value = "running";
    lastTickTime = Date.now();
    tickTimer = setInterval(tick, TICK_INTERVAL_MS);
  }

  // Bug 2: 使用 "paused" 状态区分"从未开始"和"暂停中"
  function pause() {
    if (phase.value !== "running") return;
    phase.value = "paused";
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function toggle() {
    if (phase.value === "running") {
      pause();
    } else {
      start();
    }
  }

  function reset() {
    phase.value = "ready";
    remainingMs.value = totalMs.value;
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function tick() {
    const now = Date.now();
    const elapsed = now - lastTickTime;
    lastTickTime = now;

    // Bug 6: 正向计时（Stopwatch）模式累加而非递减，不触发 complete()
    if (appMode.value === "stopwatch") {
      remainingMs.value += elapsed;
      return;
    }

    remainingMs.value -= elapsed;

    if (remainingMs.value <= 0) {
      remainingMs.value = 0;
      complete();
    }
  }

  function complete() {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    phase.value = "finished";

    // 计划模式下任意一项完成都推进步骤（供计划自动进入下一项）
    if (appMode.value === "plan") {
      planStepId.value++;
    }

    if (mode.value === "work") {
      const minutes = Math.round(totalMs.value / 60000);
      // Bug 1: 移除 todayCount/totalMinutes 累加，统计由 stats store 负责
      lastCompletedMinutes.value = minutes;
      completionId.value++;
      // Bug 4: 使用 setModeKeepTime 避免覆盖用户预设时长
      setModeKeepTime("break");
    } else {
      setModeKeepTime("work");
    }

    // Bug 8: 移除 saveStats 调用，统计持久化由 stats store 负责
  }

  /** 设置计时时长（分钟）并回到 ready（对应旧版 Timer.setTime；运行中忽略） */
  function setTime(minutes: number): void {
    if (phase.value === "running") return;
    totalMs.value = minutes * 60 * 1000;
    remainingMs.value = totalMs.value;
    phase.value = "ready";
  }

  return {
    phase,
    mode,
    appMode,
    remainingMs,
    totalMs,
    todayCount,
    totalMinutes,
    lastCompletedMinutes,
    completionId,
    planStepId,
    progress,
    displayTime,
    isRunning,
    init,
    setMode,
    setModeKeepTime,
    setAppMode,
    setTime,
    start,
    pause,
    toggle,
    reset,
  };
});

// HMR: 支持 Vite 热更新，避免 HMR 后丢失 Pinia 上下文
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useTimerStore, import.meta.hot));
}
