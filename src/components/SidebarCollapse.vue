<script setup lang="ts">
/**
 * 侧边栏收起按钮
 *
 * 参照原 Electron 版 .sidebar-collapse-btn 样式：
 *   侧边栏右边缘竖条按钮，点击收起/展开侧边栏。
 */
const props = defineProps<{
  collapsed: boolean;
}>();

const emit = defineEmits<{
  toggle: [];
}>();
</script>

<template>
  <button
    class="sidebar-collapse-btn"
    :class="{ collapsed: props.collapsed }"
    title="收起侧边栏"
    @click="emit('toggle')"
  >
    <span class="sidebar-collapse-icon">{{ props.collapsed ? "▶" : "◀" }}</span>
  </button>
</template>

<style scoped>
.sidebar-collapse-btn {
  position: absolute;
  left: 160px;
  top: 50%;
  transform: translateY(-50%);
  width: 8px;
  height: 50px;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-left: none;
  border-radius: 0 6px 6px 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: left 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              background 0.2s ease,
              width 0.2s ease,
              height 0.2s ease,
              border-color 0.2s ease;
  z-index: 10;
}

.sidebar-collapse-btn:hover {
  background: rgba(255, 255, 255, 0.25);
  width: 10px;
  height: 60px;
  border-radius: 0 8px 8px 0;
}

/* 收起状态：按钮移到窗口最左边，左边变成可见边界，因此补上 border-left */
.sidebar-collapse-btn.collapsed {
  left: 0;
  border-left: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 0 6px 6px 0;
}

.sidebar-collapse-icon {
  font-size: 8px;
  color: rgba(255, 255, 255, 0.6);
  transition: transform 0.3s ease;
}
</style>
