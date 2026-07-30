<script setup lang="ts">
/**
 * 滚筒选择器
 *
 * 参照原 Electron 版 wheelPicker.js + .wheel-picker 样式：
 *   上下拖动 / 滚轮改变分钟数（1-120），居中项高亮。
 */
import { ref, computed, onMounted, onUnmounted } from "vue";

const props = withDefaults(
  defineProps<{
    modelValue: number;
    min?: number;
    max?: number;
    disabled?: boolean;
  }>(),
  {
    min: 1,
    max: 120,
    disabled: false,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: number];
}>();

const ITEM_HEIGHT = 32;
const VISIBLE_RANGE = 3;

const wheelColumn = ref<HTMLDivElement | null>(null);
const currentValue = ref(props.modelValue);
let isDragging = false;
let dragStartY = 0;
let dragStartValue = 0;
let dragVelocity = 0;
let lastDragY = 0;
let lastDragTime = 0;
let animFrameId: number | null = null;

const items = computed(() => {
  const start = Math.max(props.min, Math.round(currentValue.value) - VISIBLE_RANGE);
  const end = Math.min(props.max, Math.round(currentValue.value) + VISIBLE_RANGE);
  const arr: number[] = [];
  for (let i = start; i <= end; i++) arr.push(i);
  return arr;
});

const offset = computed(() => {
  const start = Math.max(props.min, Math.round(currentValue.value) - VISIBLE_RANGE);
  const idx = Math.round(currentValue.value) - start;
  return -idx * ITEM_HEIGHT - (currentValue.value - Math.round(currentValue.value)) * ITEM_HEIGHT;
});

function itemOpacity(val: number): number {
  const dist = Math.abs(val - currentValue.value);
  return dist < 0.5 ? 1 : Math.max(0.3, 1 - dist * 0.35);
}

function isCenter(val: number): boolean {
  return val === Math.round(currentValue.value);
}

function clamp(v: number): number {
  return Math.max(props.min, Math.min(props.max, v));
}

function commitValue() {
  const rounded = Math.round(currentValue.value);
  if (rounded !== props.modelValue) {
    emit("update:modelValue", rounded);
  }
}

// ===== 拖动 =====
function onPointerDown(e: PointerEvent) {
  if (props.disabled) return;
  isDragging = true;
  dragStartY = e.clientY;
  dragStartValue = currentValue.value;
  dragVelocity = 0;
  lastDragY = e.clientY;
  lastDragTime = Date.now();
  if (wheelColumn.value) {
    wheelColumn.value.style.transition = "none";
  }
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
}

function onPointerMove(e: PointerEvent) {
  if (!isDragging) return;
  const dy = e.clientY - dragStartY;
  const newValue = clamp(dragStartValue - dy / ITEM_HEIGHT);
  currentValue.value = newValue;
  const now = Date.now();
  const dt = now - lastDragTime;
  if (dt > 0) {
    dragVelocity = (e.clientY - lastDragY) / dt;
  }
  lastDragY = e.clientY;
  lastDragTime = now;
}

function onPointerUp() {
  if (!isDragging) return;
  isDragging = false;
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  // 应用惯性
  if (Math.abs(dragVelocity) > 0.1) {
    applyInertia();
  } else {
    snapToCenter();
  }
}

function applyInertia() {
  const friction = 0.92;
  function step() {
    if (Math.abs(dragVelocity) < 0.02) {
      snapToCenter();
      return;
    }
    currentValue.value = clamp(currentValue.value - dragVelocity * 16 / ITEM_HEIGHT);
    dragVelocity *= friction;
    animFrameId = requestAnimationFrame(step);
  }
  animFrameId = requestAnimationFrame(step);
}

function snapToCenter() {
  currentValue.value = Math.round(currentValue.value);
  if (wheelColumn.value) {
    wheelColumn.value.style.transition = "transform 0.2s ease-out";
  }
  commitValue();
}

// ===== 滚轮 =====
function onWheel(e: WheelEvent) {
  if (props.disabled) return;
  e.preventDefault();
  const delta = e.deltaY > 0 ? 1 : -1;
  currentValue.value = clamp(currentValue.value + delta);
  if (wheelColumn.value) {
    wheelColumn.value.style.transition = "transform 0.15s ease-out";
  }
  commitValue();
}

// ===== 外部值变化同步 =====
function syncFromProps() {
  if (Math.abs(currentValue.value - props.modelValue) > 0.01 && !isDragging) {
    currentValue.value = props.modelValue;
  }
}

onMounted(() => {
  syncFromProps();
});

onUnmounted(() => {
  if (animFrameId !== null) cancelAnimationFrame(animFrameId);
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
});

// 监听外部变化
import { watch } from "vue";
watch(() => props.modelValue, syncFromProps);
</script>

<template>
  <div
    class="wheel-picker"
    :class="{ disabled }"
    @pointerdown="onPointerDown"
    @wheel="onWheel"
  >
    <div
      ref="wheelColumn"
      class="wheel-picker-column"
      :style="{ transform: `translateY(${offset}px)` }"
    >
      <div
        v-for="val in items"
        :key="val"
        class="wheel-picker-item"
        :class="{ center: isCenter(val) }"
        :style="{ opacity: itemOpacity(val) }"
      >
        {{ val }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.wheel-picker {
  position: relative;
  width: 55px;
  height: 32px;
  background: rgba(255, 255, 255, 0.15);
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-radius: 8px;
  overflow: hidden;
  cursor: ns-resize;
  touch-action: none;
}

.wheel-picker-column {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  will-change: transform;
}

.wheel-picker-item {
  height: 32px;
  line-height: 32px;
  font-size: 14px;
  font-weight: 600;
  color: white;
  text-align: center;
  width: 100%;
  flex-shrink: 0;
  transition: opacity 0.1s;
}

.wheel-picker-item.center {
  color: #fff;
  text-shadow: 0 0 8px rgba(255, 255, 255, 0.3);
}

.wheel-picker::before,
.wheel-picker::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  height: 6px;
  pointer-events: none;
  z-index: var(--z-content);
}

.wheel-picker::before {
  top: 0;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.05), transparent);
}

.wheel-picker::after {
  bottom: 0;
  background: linear-gradient(to top, rgba(255, 255, 255, 0.05), transparent);
}

.wheel-picker.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.wheel-picker.disabled .wheel-picker-column {
  pointer-events: none;
}
</style>
