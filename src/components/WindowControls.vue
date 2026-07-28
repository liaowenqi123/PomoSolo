<script setup lang="ts">
/**
 * 窗口控制按钮
 *
 * 调用 src/api/window.ts 的最小化 / 关闭命令。
 * 参考 electron 旧版 titlebar minimize / close 按钮。
 */
import { minimizeWindow, closeWindow } from "../api/window";

async function onMinimize(): Promise<void> {
  try {
    await minimizeWindow();
  } catch (e) {
    // 后端未就绪时降级到浏览器 API（开发环境）
    console.warn("[WindowControls] minimizeWindow 失败:", e);
  }
}

async function onClose(): Promise<void> {
  try {
    await closeWindow();
  } catch (e) {
    console.warn("[WindowControls] closeWindow 失败:", e);
  }
}
</script>

<template>
  <div class="window-controls">
    <button
      class="window-controls__btn window-controls__btn--minimize"
      title="最小化"
      @click="onMinimize"
    >
      <svg width="12" height="12" viewBox="0 0 12 12">
        <rect x="1" y="5.5" width="10" height="1" fill="currentColor" />
      </svg>
    </button>
    <button
      class="window-controls__btn window-controls__btn--close"
      title="关闭"
      @click="onClose"
    >
      <svg width="12" height="12" viewBox="0 0 12 12">
        <path
          d="M1 1 L11 11 M11 1 L1 11"
          stroke="currentColor"
          stroke-width="1.2"
            fill="none"
        />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.window-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}

.window-controls__btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  transition: all 0.15s ease;
}

.window-controls__btn--minimize:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.window-controls__btn--close:hover {
  background: #e94560;
  color: #fff;
}
</style>
