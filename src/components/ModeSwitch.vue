<script setup lang="ts">
/**
 * 工作/休息模式切换
 *
 * 参照原 Electron 版 .mode-switch / .mode-btn 样式：
 *   胶囊按钮，半透明白色背景，带 emoji 图标。
 */
import { useTimerStore } from "../stores/timer";

const timer = useTimerStore();

function onModeChange(mode: "work" | "break") {
  timer.setMode(mode);
}
</script>

<template>
  <div class="mode-switch">
    <button
      class="mode-btn"
      :class="{ active: timer.mode === 'work' }"
      @click="onModeChange('work')"
    >
      <span class="mode-icon">💼</span>
      <span class="mode-text">专注</span>
    </button>
    <button
      class="mode-btn"
      :class="{ active: timer.mode === 'break' }"
      @click="onModeChange('break')"
    >
      <span class="mode-icon">☕</span>
      <span class="mode-text">休息</span>
    </button>
  </div>
</template>

<style scoped>
.mode-switch {
  display: flex;
  gap: 8px;
}

.mode-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.3);
  cursor: pointer;
  transition: all 0.3s ease;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
}

.mode-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.mode-btn.active {
  background: rgba(255, 255, 255, 0.25);
  border-color: rgba(255, 255, 255, 0.5);
  color: white;
}

.mode-icon {
  font-size: 13px;
}

.mode-text {
  font-weight: 500;
}
</style>
