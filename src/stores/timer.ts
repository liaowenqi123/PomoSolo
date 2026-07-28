import { defineStore } from "pinia";
import { ref, computed } from "vue";

export type TimerPhase = "ready" | "running" | "finished";
export type TimerMode = "work" | "break";

const DEFAULT_WORK_MINUTES = 25;
const DEFAULT_BREAK_MINUTES = 5;
const TICK_INTERVAL_MS = 200;

export const useTimerStore = defineStore("timer", () => {
  // ===== State =====
  const phase = ref<TimerPhase>("ready");
  const mode = ref<TimerMode>("work");
  const remainingMs = ref(DEFAULT_WORK_MINUTES * 60 * 1000);
  const totalMs = ref(DEFAULT_WORK_MINUTES * 60 * 1000);
  const todayCount = ref(0);
  const totalMinutes = ref(0);

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

  const isRunning = computed(() => phase.value === "running");

  // ===== Actions =====
  function init() {
    // 从本地存储加载设置
    loadSettings();
  }

  function loadSettings() {
    // TODO: 从 Tauri 后端加载
    const saved = localStorage.getItem("pomodoro-settings");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.workMinutes) {
          totalMs.value = data.workMinutes * 60 * 1000;
          remainingMs.value = totalMs.value;
        }
      } catch {}
    }
  }

  function setMode(newMode: TimerMode) {
    if (phase.value === "running") return;
    mode.value = newMode;
    const minutes = newMode === "work" ? DEFAULT_WORK_MINUTES : DEFAULT_BREAK_MINUTES;
    totalMs.value = minutes * 60 * 1000;
    remainingMs.value = totalMs.value;
    phase.value = "ready";
  }

  function start() {
    if (phase.value === "running") return;
    phase.value = "running";
    lastTickTime = Date.now();
    tickTimer = setInterval(tick, TICK_INTERVAL_MS);
  }

  function pause() {
    if (phase.value !== "running") return;
    phase.value = "ready";
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

    if (mode.value === "work") {
      todayCount.value++;
      totalMinutes.value += DEFAULT_WORK_MINUTES;
      // 自动切换到休息
      setMode("break");
    } else {
      // 休息结束，切换回工作
      setMode("work");
    }

    // 通知后端
    saveStats();
  }

  function saveStats() {
    // TODO: 通过 Tauri command 保存到后端
    localStorage.setItem(
      "pomodoro-stats",
      JSON.stringify({
        todayCount: todayCount.value,
        totalMinutes: totalMinutes.value,
        date: new Date().toDateString(),
      })
    );
  }

  return {
    phase,
    mode,
    remainingMs,
    totalMs,
    todayCount,
    totalMinutes,
    progress,
    displayTime,
    isRunning,
    init,
    setMode,
    start,
    pause,
    toggle,
    reset,
  };
});
