<script setup lang="ts">
/**
 * 进度圆环
 *
 * 参照原 Electron 版 .progress-ring 样式：
 *   200x200 SVG，r=116，stroke-width 5，白色进度 + 半透明白色背景圆环
 */
import { computed } from "vue";
import { useTimerStore } from "../stores/timer";

const timer = useTimerStore();

const RADIUS = 116;
const circumference = 2 * Math.PI * RADIUS;
const dashOffset = computed(() => circumference * (1 - timer.progress));
</script>

<template>
  <svg class="progress-ring" width="200" height="200" viewBox="0 0 240 240">
    <circle
      class="bg"
      cx="120"
      cy="120"
      :r="RADIUS"
      fill="none"
      stroke="rgba(255, 255, 255, 0.12)"
      stroke-width="5"
    />
    <circle
      class="progress"
      cx="120"
      cy="120"
      :r="RADIUS"
      fill="none"
      stroke="rgba(255, 255, 255, 0.85)"
      stroke-width="5"
      stroke-linecap="round"
      :stroke-dasharray="circumference"
      :stroke-dashoffset="dashOffset"
      transform="rotate(-90 120 120)"
      style="transition: stroke-dashoffset 1s linear; filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.4))"
    />
  </svg>
</template>

<style scoped>
.progress-ring {
  position: absolute;
  width: 200px;
  height: 200px;
  transform: rotate(0deg);
  pointer-events: none;
}
</style>
