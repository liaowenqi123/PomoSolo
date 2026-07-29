<script setup lang="ts">
/**
 * 计时器时间显示
 *
 * 参照原 Electron 版 .time-display 样式：48px 白色大字。
 * 状态文本由 App.vue 的 .status 元素显示，此处只显示时间。
 */
import { useTimerStore } from "../stores/timer";

const timer = useTimerStore();
</script>

<template>
  <div class="time-display">{{ timer.displayTime }}</div>
</template>

<style scoped>
.time-display {
  font-size: 48px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}
</style>
