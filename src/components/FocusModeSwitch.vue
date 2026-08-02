<script setup lang="ts">
/**
 * 专注模式开关
 *
 * 参照原 Electron 版 .focus-mode-container / .focus-mode-switch 样式：
 *   胶囊开关，激活时绿色背景，滑块右移。
 *   仅在 READY 阶段可切换，运行中禁用。
 *
 * 受控组件（v-model）：active 状态由父组件持有，
 * 保证惩罚流程（三次警告 / 运行中重置 / 手动关闭）关闭专注模式后滑块同步归位。
 */
const props = defineProps<{
  /** 当前是否开启（v-model） */
  modelValue: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "toggle", active: boolean): void;
}>();

function toggle() {
  if (props.disabled) return;
  const next = !props.modelValue;
  emit("update:modelValue", next);
  emit("toggle", next);
}
</script>

<template>
  <div class="focus-mode-container" :class="{ disabled }">
    <span class="focus-mode-label">专注模式</span>
    <div
      class="focus-mode-switch"
      :class="{ active: modelValue }"
      @click="toggle"
    >
      <div class="focus-mode-slider"></div>
    </div>
    <span class="focus-mode-status" :class="{ active: modelValue }">
      {{ modelValue ? "开启" : "关闭" }}
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
