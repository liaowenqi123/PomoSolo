<script setup lang="ts">
/**
 * 通用弹窗组件
 *
 * 参考 electron/src/scripts/modules/modal.js（BaseModal / AnimatedModal）。
 *
 * 用法：
 * ```vue
 * <Modal
 *   :visible="isVisible"
 *   title="标题"
 *   :close-on-background="true"
 *   @close="isVisible = false"
 * >
 *   <p>弹窗内容</p>
 *   <template #footer>
 *     <button @click="onConfirm">确定</button>
 *   </template>
 * </Modal>
 * ```
 */
import { watch, onBeforeUnmount } from "vue";

interface Props {
  /** 是否显示 */
  visible: boolean;
  /** 标题 */
  title?: string;
  /** 是否允许点击背景关闭（默认 true） */
  closeOnBackground?: boolean;
  /** 是否显示关闭按钮（默认 true） */
  showClose?: boolean;
  /** 自定义宽度（CSS 值，例如 '420px'） */
  width?: string;
}

const props = withDefaults(defineProps<Props>(), {
  title: "",
  closeOnBackground: true,
  showClose: true,
  width: "",
});

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "close"): void;
}>();

function close(): void {
  emit("update:visible", false);
  emit("close");
}

function onBackgroundClick(e: MouseEvent): void {
  if (!props.closeOnBackground) return;
  // 仅当点击的是遮罩本身时关闭
  if (e.target === e.currentTarget) {
    close();
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Escape" && props.visible) {
    close();
  }
}

// 监听显示状态：锁定/解锁 body 滚动 & 绑定 ESC
watch(
  () => props.visible,
  (v) => {
    if (typeof document === "undefined") return;
    if (v) {
      document.body.style.overflow = "hidden";
      document.addEventListener("keydown", onKeydown);
    } else {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKeydown);
    }
  },
);

onBeforeUnmount(() => {
  if (typeof document !== "undefined") {
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKeydown);
  }
});
</script>

<template>
  <Transition name="modal">
    <div
      v-if="visible"
      class="app-modal-overlay modal-overlay"
      @click="onBackgroundClick"
    >
      <div
        class="modal-container"
        :style="width ? { maxWidth: width } : {}"
        role="dialog"
        aria-modal="true"
      >
        <div v-if="title || showClose" class="modal-header">
          <h3 class="modal-title">{{ title }}</h3>
          <button
            v-if="showClose"
            class="modal-close-btn"
            type="button"
            aria-label="关闭"
            @click="close"
          >
            ×
          </button>
        </div>
        <div class="modal-body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="modal-footer">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* 遮罩层基础样式由全局 .app-modal-overlay 类提供（position/z-index/background 等） */
/* 此处仅保留组件特有的过渡动画样式 */
.modal-overlay {
  /* position/inset/z-index/background 等由 .app-modal-overlay 全局类提供 */
}

.modal-container {
  background: #1a1a1a;
  color: #fff;
  border-radius: 16px;
  padding: 20px;
  width: 100%;
  max-width: 420px;
  max-height: 85vh;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.2);
  position: relative;
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.modal-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #fff;
}

.modal-close-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.6);
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
  transition: color 0.2s ease;
}

.modal-close-btn:hover {
  color: #fff;
}

.modal-body {
  font-size: 14px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.9);
  overflow-y: auto;
  flex: 1;
}

/* Scrollbar */
.modal-body::-webkit-scrollbar {
  width: 6px;
}
.modal-body::-webkit-scrollbar-track {
  background: transparent;
}
.modal-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}
.modal-body::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.4);
}

.modal-footer {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* Transition */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.25s ease;
}

.modal-enter-active .modal-container,
.modal-leave-active .modal-container {
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-container,
.modal-leave-to .modal-container {
  transform: scale(0.92);
}
</style>
