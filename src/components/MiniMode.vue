<script setup lang="ts">
/**
 * 迷你模式 - 番茄切片风格
 *
 * 参照原 Electron 版 .mini-mode 样式：
 *   小番茄造型，叶子装饰 + 红色主体 + 进度环 + 时间显示。
 *   计时运行时最小化可进入迷你模式。
 */
import { computed } from "vue";
import { useTimerStore } from "../stores/timer";

const timer = useTimerStore();

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  expand: [];
}>();

const displayTime = computed(() => timer.displayTime);
const progress = computed(() => timer.progress);

const circumference = 2 * Math.PI * 62;
const dashOffset = computed(() => circumference * (1 - progress.value));
</script>

<template>
  <div v-if="props.visible" class="mini-mode">
    <div class="mini-draggable" data-tauri-drag-region></div>

    <!-- 番茄叶子装饰 -->
    <div class="mini-leaves">
      <div class="mini-leaf mini-leaf-left"></div>
      <div class="mini-leaf mini-leaf-center"></div>
      <div class="mini-leaf mini-leaf-right"></div>
    </div>

    <!-- 番茄主体 -->
    <div class="mini-tomato">
      <div class="mini-timer-container">
        <svg class="mini-progress-ring" viewBox="0 0 130 130">
          <circle
            class="bg"
            cx="65"
            cy="65"
            r="62"
            fill="none"
            stroke="rgba(255, 255, 255, 0.15)"
            stroke-width="3"
          />
          <circle
            class="progress"
            cx="65"
            cy="65"
            r="62"
            fill="none"
            stroke="rgba(255, 255, 255, 0.9)"
            stroke-width="3"
            stroke-linecap="round"
            :stroke-dasharray="circumference"
            :stroke-dashoffset="dashOffset"
            transform="rotate(-90 65 65)"
            style="transition: stroke-dashoffset 1s linear"
          />
        </svg>
        <div class="mini-timer-inner">
          <div class="mini-time-display">{{ displayTime }}</div>
        </div>
      </div>

      <!-- 种子装饰 -->
      <div class="mini-seeds">
        <span class="mini-seed" style="top: 25%; left: 30%;"></span>
        <span class="mini-seed" style="top: 35%; left: 55%;"></span>
        <span class="mini-seed" style="top: 55%; left: 25%;"></span>
        <span class="mini-seed" style="top: 60%; left: 60%;"></span>
        <span class="mini-seed" style="top: 75%; left: 40%;"></span>
      </div>
    </div>

    <button class="btn-expand-mini" title="展开" @click="emit('expand')">⬆</button>
  </div>
</template>

<style scoped>
.mini-mode {
  position: absolute;
  top: 0;
  left: 0;
  width: 180px;
  height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding-top: 5px;
  background: transparent;
  z-index: var(--z-popup);
  overflow: visible;
}

/* MiniMode 在独立窗口中运行，以下内部 z-index 为番茄视觉元素的精细堆叠
   （叶子/果实/高光的层叠效果），不参与主窗口层级体系，保持原数值。 */

.mini-draggable {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 8;
}

.mini-leaves {
  position: relative;
  width: 80px;
  height: 40px;
  z-index: 5;
  margin-bottom: -12px;
}

.mini-leaf {
  position: absolute;
  background: linear-gradient(145deg, #a5d6a7 0%, #81c784 30%, #66bb6a 60%, #4caf50 100%);
  box-shadow: 0 2px 8px rgba(76, 175, 80, 0.4);
  transition: transform 0.3s ease;
}

.mini-leaf-center {
  left: 50%;
  top: 0;
  transform: translateX(-50%);
  width: 16px;
  height: 28px;
  border-radius: 50% 50% 45% 45% / 30% 30% 70% 70%;
  z-index: 3;
  animation: leafCenterSway 2.5s ease-in-out infinite;
}

.mini-leaf-left {
  left: 5px;
  top: 8px;
  width: 22px;
  height: 26px;
  border-radius: 70% 30% 60% 40% / 40% 70% 30% 60%;
  transform: rotate(-40deg) skewX(5deg);
  z-index: 2;
  animation: leafLeftSway 3s ease-in-out infinite;
}

.mini-leaf-right {
  right: 5px;
  top: 8px;
  width: 22px;
  height: 26px;
  border-radius: 30% 70% 40% 60% / 70% 40% 60% 30%;
  transform: rotate(40deg) skewX(-5deg);
  z-index: 2;
  animation: leafRightSway 3.2s ease-in-out infinite;
}

@keyframes leafCenterSway {
  0%, 100% { transform: translateX(-50%) rotate(0deg); }
  25% { transform: translateX(-50%) rotate(-3deg); }
  75% { transform: translateX(-50%) rotate(3deg); }
}

@keyframes leafLeftSway {
  0%, 100% { transform: rotate(-40deg) skewX(5deg); }
  50% { transform: rotate(-35deg) skewX(5deg); }
}

@keyframes leafRightSway {
  0%, 100% { transform: rotate(40deg) skewX(-5deg); }
  50% { transform: rotate(35deg) skewX(-5deg); }
}

.mini-tomato {
  position: relative;
  width: 160px;
  height: 160px;
  border-radius: 50%;
  background: linear-gradient(145deg, #ff7043 0%, #ff5722 20%, #e53935 50%, #d32f2f 80%, #c62828 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 20px rgba(213, 47, 47, 0.5), inset 0 -10px 30px rgba(0, 0, 0, 0.2), inset 0 10px 20px rgba(255, 255, 255, 0.1);
  z-index: 2;
}

.mini-timer-container {
  position: relative;
  width: 130px;
  height: 130px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mini-progress-ring {
  position: absolute;
  width: 130px;
  height: 130px;
  transform: rotate(-90deg);
}

.mini-timer-inner {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.15), rgba(255, 255, 255, 0.05));
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 0 15px rgba(0, 0, 0, 0.15);
  border: 2px solid rgba(255, 255, 255, 0.2);
}

.mini-time-display {
  font-size: 26px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  font-variant-numeric: tabular-nums;
}

.mini-seeds {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  pointer-events: none;
  z-index: 1;
}

.mini-seed {
  position: absolute;
  width: 4px;
  height: 6px;
  background: rgba(255, 255, 255, 0.6);
  border-radius: 50%;
  transform: translate(-50%, -50%);
}

.btn-expand-mini {
  position: absolute;
  bottom: 10px;
  right: 10px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: white;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
  z-index: 10;
}

.btn-expand-mini:hover {
  background: rgba(255, 255, 255, 0.35);
  transform: translateY(-2px);
}
</style>
