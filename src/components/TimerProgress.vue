<script setup lang="ts">
import { useTimerStore } from "../stores/timer";

const timer = useTimerStore();

const circumference = 2 * Math.PI * 120;
const dashOffset = circumference * (1 - timer.progress);
</script>

<template>
  <div class="progress-ring">
    <svg width="280" height="280" viewBox="0 0 280 280">
      <!-- 背景圆环 -->
      <circle
        cx="140"
        cy="140"
        :r="120"
        fill="none"
        stroke="rgba(255, 255, 255, 0.05)"
        stroke-width="8"
      />
      <!-- 进度圆环 -->
      <circle
        cx="140"
        cy="140"
        :r="120"
        fill="none"
        :stroke="'var(--accent)'"
        stroke-width="8"
        stroke-linecap="round"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="dashOffset"
        transform="rotate(-90 140 140)"
        style="transition: stroke-dashoffset 0.2s linear"
      />
    </svg>
  </div>
</template>

<style scoped>
.progress-ring {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
</style>
