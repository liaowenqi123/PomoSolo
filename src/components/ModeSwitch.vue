<script setup lang="ts">
import { useTimerStore } from "../stores/timer";

const timer = useTimerStore();

function onModeChange(mode: "work" | "break") {
  timer.setMode(mode);
}
</script>

<template>
  <div class="mode-switch">
    <button
      class="mode-switch__btn"
      :class="{ 'mode-switch__btn--active': timer.mode === 'work' }"
      @click="onModeChange('work')"
    >
      专注
    </button>
    <button
      class="mode-switch__btn"
      :class="{ 'mode-switch__btn--active': timer.mode === 'break' }"
      @click="onModeChange('break')"
    >
      休息
    </button>
  </div>
</template>

<style scoped>
.mode-switch {
  display: flex;
  gap: 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  padding: 4px;
}

.mode-switch__btn {
  padding: 8px 24px;
  border-radius: 8px;
  font-size: 14px;
  color: var(--text-secondary);
  transition: all 0.2s ease;
}

.mode-switch__btn--active {
  background: var(--accent);
  color: #fff;
}

.mode-switch__btn:hover:not(.mode-switch__btn--active) {
  color: var(--text-primary);
}
</style>
