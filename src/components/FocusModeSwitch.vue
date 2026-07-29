<script setup lang="ts">
/**
 * 专注模式开关
 *
 * 参照原 Electron 版 .focus-mode-container / .focus-mode-switch 样式：
 *   胶囊开关，激活时绿色背景，滑块右移。
 *   仅在 READY 阶段可切换，运行中禁用。
 */
import { ref, watch } from "vue";

const props = defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  toggle: [active: boolean];
}>();

const active = ref(false);

function toggle() {
  if (props.disabled) return;
  active.value = !active.value;
  emit("toggle", active.value);
}

// 外部可重置
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled && active.value) {
      // 运行中不自动关闭，只是禁止切换
    }
  },
);
</script>

<template>
  <div class="focus-mode-container" :class="{ disabled }">
    <span class="focus-mode-label">专注模式</span>
    <div
      class="focus-mode-switch"
      :class="{ active }"
      @click="toggle"
    >
      <div class="focus-mode-slider"></div>
    </div>
    <span class="focus-mode-status" :class="{ active }">
      {{ active ? "开启" : "关闭" }}
    </span>
  </div>
</template>

<style scoped>
.focus-mode-container {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  transition: opacity 0.2s ease;
}

.focus-mode-container.disabled {
  opacity: 0.6;
  pointer-events: none;
}

.focus-mode-label {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  font-weight: 500;
}

.focus-mode-switch {
  width: 44px;
  height: 24px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  cursor: pointer;
  position: relative;
  transition: all 0.3s ease;
}

.focus-mode-switch:hover {
  background: rgba(255, 255, 255, 0.3);
}

.focus-mode-switch.active {
  background: rgba(76, 175, 80, 0.6);
}

.focus-mode-slider {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  background: white;
  border-radius: 50%;
  transition: all 0.3s ease;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
}

.focus-mode-switch.active .focus-mode-slider {
  left: 23px;
}

.focus-mode-status {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  min-width: 24px;
}

.focus-mode-status.active {
  color: #81c784;
}
</style>
