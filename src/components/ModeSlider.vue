<script setup lang="ts">
/**
 * 应用模式切换滑块
 *
 * 参照原 Electron 版 renderer.js 中 DOM.modeSlider 的 click 行为：
 *   点击滑块（轨道或 thumb）一次，循环切换到下一档：single → plan → stopwatch → single ...
 *   不根据点击位置跳转。标签点击仍可直接切换到对应档位。
 *
 * 样式参照原 Electron 版 .mode-slider-container / .mode-slider：
 *   左上角拨杆，三档：单次 / 计划 / 正向。
 * 滑块位置：single → left:3px, plan → left:16px, stopwatch → left:29px
 */
import { computed } from "vue";
import { useTimerStore, type AppMode } from "../stores/timer";

const timer = useTimerStore();

const modes: { key: AppMode; label: string }[] = [
  { key: "single", label: "单次" },
  { key: "plan", label: "计划" },
  { key: "stopwatch", label: "正向" },
];

const sliderClass = computed(() => `mode-slider--${timer.appMode}`);

function onLabelClick(mode: AppMode) {
  timer.setAppMode(mode);
}

/** 点击滑块（轨道或 thumb）：循环切换到下一档
 *  与原 Electron 版 renderer.js 中 modeSlider click 行为一致 */
function onSliderCycle() {
  const order: AppMode[] = ["single", "plan", "stopwatch"];
  const idx = order.indexOf(timer.appMode);
  timer.setAppMode(order[(idx + 1) % order.length]);
}
</script>

<template>
  <div class="mode-slider-container">
    <div class="mode-slider" :class="sliderClass" @click="onSliderCycle">
      <div class="mode-slider-thumb"></div>
    </div>
    <div class="mode-slider-labels">
      <span
        v-for="m in modes"
        :key="m.key"
        class="mode-label"
        :class="{ active: timer.appMode === m.key }"
        @click="onLabelClick(m.key)"
      >
        {{ m.label }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.mode-slider-container {
  position: absolute;
  left: 8px;
  top: 10px;
  display: flex;
  align-items: center;
  gap: 5px;
  z-index: 50;
}

.mode-slider {
  width: 46px;
  height: 20px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  position: relative;
  cursor: pointer;
  transition: background 0.3s ease;
  border: 1px solid rgba(255, 255, 255, 0.2);
  flex-shrink: 0;
}

.mode-slider:hover {
  background: rgba(255, 255, 255, 0.2);
}

.mode-slider-thumb {
  width: 14px;
  height: 14px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.85));
  border-radius: 50%;
  position: absolute;
  left: 3px;
  top: 2px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}

.mode-slider--plan .mode-slider-thumb {
  left: 16px;
}

.mode-slider--stopwatch .mode-slider-thumb {
  left: 29px;
}

.mode-slider-labels {
  display: flex;
  gap: 3px;
  align-items: center;
}

.mode-label {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.5);
  transition: all 0.3s ease;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  background: transparent;
  user-select: none;
  white-space: nowrap;
}

.mode-label:hover {
  color: rgba(255, 255, 255, 0.7);
  background: rgba(255, 255, 255, 0.08);
}

.mode-label.active {
  color: rgba(255, 255, 255, 0.95);
  font-weight: 600;
  background: rgba(255, 255, 255, 0.12);
}
</style>
