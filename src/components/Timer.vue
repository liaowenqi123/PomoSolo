<script setup lang="ts">
import { useTimerStore } from "../stores/timer";

const timer = useTimerStore();
</script>

<template>
  <div class="timer-display">
    <span class="timer-display__time">{{ timer.displayTime }}</span>
    <div class="timer-display__status">
      <span v-if="timer.phase === 'ready'">准备开始</span>
      <span v-else-if="timer.phase === 'running'">
        {{ timer.mode === "work" ? "专注中" : "休息中" }}
      </span>
      <span v-else>已完成</span>
    </div>
  </div>
</template>

<style scoped>
.timer-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.timer-display__time {
  font-size: 64px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 2px;
  color: var(--accent);
  text-shadow: 0 0 30px rgba(233, 69, 96, 0.3);
}

.timer-display__status {
  font-size: 14px;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 1px;
}
</style>
