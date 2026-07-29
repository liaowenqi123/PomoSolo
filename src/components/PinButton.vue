<script setup lang="ts">
/**
 * 置顶按钮
 *
 * 参照原 Electron 版 .btn-pin 样式：
 *   右上角圆形按钮（📍），旋转 45° 默认，激活时旋转 0° + 金色背景。
 */
import { ref } from "vue";
import { setAlwaysOnTop, cancelAlwaysOnTop } from "../api/window";

const active = ref(false);

async function toggle() {
  active.value = !active.value;
  try {
    if (active.value) {
      await setAlwaysOnTop(true);
    } else {
      await cancelAlwaysOnTop();
    }
  } catch (e) {
    console.warn("[PinButton] 置顶失败:", e);
    active.value = !active.value;
  }
}
</script>

<template>
  <button
    class="btn-pin"
    :class="{ active }"
    title="始终置顶"
    @click="toggle"
  >
    📍
  </button>
</template>

<style scoped>
.btn-pin {
  position: absolute;
  top: 10px;
  right: 74px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: rgba(255, 255, 255, 0.85);
  font-size: 14px;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 100;
  transform: rotate(45deg);
}

.btn-pin:hover {
  background: rgba(255, 255, 255, 0.3);
  color: white;
}

.btn-pin.active {
  transform: rotate(0deg);
  background: rgba(255, 200, 100, 0.6);
  color: white;
  box-shadow: 0 0 8px rgba(255, 200, 100, 0.8);
}
</style>
