<script setup lang="ts">
/**
 * 窗口控制按钮（最小化 / 关闭）
 *
 * 参照原 Electron 版 .btn-minimize / .btn-close 样式：
 *   圆形按钮，半透明白色背景，右上角绝对定位。
 *   使用 × / − 字符图标。
 *
 * 最小化按钮在计时器运行时会触发迷你模式（由父组件控制）。
 */
import { closeWindow, minimizeWindow } from "../api/window";

const props = defineProps<{
  /** 最小化按钮回调（父组件可拦截进入迷你模式） */
  onMinimize?: () => void;
}>();

async function onMinimizeClick() {
  if (props.onMinimize) {
    props.onMinimize();
  } else {
    try {
      await minimizeWindow();
    } catch (e) {
      console.warn("[WindowControls] minimize failed:", e);
    }
  }
}

async function onClose() {
  try {
    await closeWindow();
  } catch (e) {
    console.warn("[WindowControls] close failed:", e);
  }
}
</script>

<template>
  <div class="window-controls">
    <button
      class="window-controls__btn window-controls__btn--minimize"
      title="最小化"
      @click="onMinimizeClick"
    >
      −
    </button>
    <button
      class="window-controls__btn window-controls__btn--close"
      title="关闭"
      @click="onClose"
    >
      ×
    </button>
  </div>
</template>

<style scoped>
.window-controls__btn {
  position: absolute;
  top: 10px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: var(--z-header-btn);
}

.window-controls__btn:hover {
  background: rgba(255, 255, 255, 0.3);
  color: white;
}

.window-controls__btn--close {
  right: 10px;
  font-size: 14px;
}

.window-controls__btn--minimize {
  right: 42px;
  font-size: 16px;
}
</style>
