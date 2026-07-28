<script setup lang="ts">
/**
 * PomoSolo 主应用
 *
 * 布局：顶部窗口控制 → 模式切换 → 计时器 → 预设 → 底部导航（统计 / 设置）
 * 整合所有迁移自 Electron 渲染模块的 Vue 3 组件。
 */
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import Timer from "./components/Timer.vue";
import TimerProgress from "./components/TimerProgress.vue";
import ModeSwitch from "./components/ModeSwitch.vue";
import WindowControls from "./components/WindowControls.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import Statistics from "./components/Statistics.vue";
import Presets from "./components/Presets.vue";
import NoteManager from "./components/NoteManager.vue";
import { useTimerStore } from "./stores/timer";
import { useSettingsStore } from "./stores/settings";
import { useStatsStore } from "./stores/stats";
import { useGardenStore } from "./stores/garden";

const timer = useTimerStore();
const settings = useSettingsStore();
const stats = useStatsStore();
const garden = useGardenStore();

// 面板可见性
const showSettings = ref(false);
const showStats = ref(false);

// 当前专注任务备注
const note = ref("");

// 主题 class
const themeClass = computed(() =>
  settings.isDark ? "app--dark" : "app--light",
);

// ===== 生命周期 =====
onMounted(async () => {
  // 加载设置 & 统计
  await Promise.all([settings.load(), stats.load(), garden.load()]);

  // 从统计 store 同步今日计数到计时器 store（保持主界面显示一致）
  timer.todayCount = stats.todayCount;
  timer.totalMinutes = stats.totalMinutes;

  timer.init();
  window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
});

// ===== 完成事件 → 记录统计 =====
watch(
  () => timer.completionId,
  async (id, prevId) => {
    if (id > prevId) {
      const minutes = timer.lastCompletedMinutes;
      await stats.recordSession(minutes, note.value);
      // 同步回计时器 store
      timer.todayCount = stats.todayCount;
      timer.totalMinutes = stats.totalMinutes;
      // 累加专注时间到菜园子（触发成就）
      void garden.addFocus(minutes);
    }
  },
);

// ===== 键盘快捷键 =====
function handleKeydown(e: KeyboardEvent) {
  if (e.code === "Space" && e.target === document.body) {
    e.preventDefault();
    timer.toggle();
  }
  // ESC 关闭面板
  if (e.key === "Escape") {
    showSettings.value = false;
    showStats.value = false;
  }
}
</script>

<template>
  <div class="app" :class="[themeClass, { 'app--break': timer.mode === 'break' }]">
    <!-- 顶部窗口控制 -->
    <div class="app__topbar">
      <WindowControls />
    </div>

    <!-- 主计时区 -->
    <div class="app__main">
      <ModeSwitch />
      <div class="app__timer-area">
        <TimerProgress />
        <Timer />
      </div>
      <NoteManager v-model="note" :disabled="timer.isRunning" />
      <Presets />
    </div>

    <!-- 底部导航 -->
    <div class="app__nav">
      <button
        class="nav-btn"
        :class="{ 'nav-btn--active': showStats }"
        @click="showStats = true"
      >
        <span class="nav-btn__icon">📊</span>
        <span class="nav-btn__label">统计</span>
      </button>
      <button
        class="nav-btn"
        :class="{ 'nav-btn--active': showSettings }"
        @click="showSettings = true"
      >
        <span class="nav-btn__icon">⚙️</span>
        <span class="nav-btn__label">设置</span>
      </button>
    </div>

    <!-- 浮层面板 -->
    <Statistics :visible="showStats" @close="showStats = false" />
    <SettingsPanel :visible="showSettings" @close="showSettings = false" />
  </div>
</template>

<style scoped>
.app {
  --bg-primary: #1a1a2e;
  --bg-secondary: #16213e;
  --accent: #e94560;
  --text-primary: #eee;
  --text-secondary: #888;
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  color: var(--text-primary);
  transition: background 0.3s ease, color 0.3s ease;
  overflow: hidden;
}

/* 休息模式配色 */
.app--break {
  --bg-primary: #0f3460;
  --accent: #4ecca3;
}

/* 浅色主题 */
.app--light {
  --bg-primary: #f5f5f5;
  --bg-secondary: #ffffff;
  --accent: #e94560;
  --text-primary: #333;
  --text-secondary: #999;
}

.app__topbar {
  display: flex;
  justify-content: flex-end;
  padding: 8px 12px;
  flex-shrink: 0;
}

.app__main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
  padding: 0 20px;
  overflow-y: auto;
}

.app__timer-area {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 280px;
  height: 280px;
}

.app__nav {
  display: flex;
  justify-content: center;
  gap: 24px;
  padding: 8px 20px 12px;
  flex-shrink: 0;
}

.nav-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 16px;
  border-radius: 10px;
  color: var(--text-secondary);
  transition: all 0.15s ease;
}

.nav-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-primary);
}

.nav-btn--active {
  color: var(--accent);
}

.nav-btn__icon {
  font-size: 18px;
}

.nav-btn__label {
  font-size: 11px;
}
</style>
