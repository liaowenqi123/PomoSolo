<script setup lang="ts">
/**
 * 左上角功能按钮列
 *
 * 参照原 Electron 版 .header-buttons 结构：
 *   始终显示：📖 教程、⚙️ 设置、▼ 展开/收起按钮
 *   展开后：🌙 深色、📈 统计、🤖 AI、👥 自习室、🌱 菜园、☁️ 登录
 * 按钮通过 settings store 的开关控制可见性。
 */
import { ref } from "vue";
import { useSettingsStore } from "../stores/settings";

const settings = useSettingsStore();

const expanded = ref(false);

const emit = defineEmits<{
  tutorial: [];
  settings: [];
  theme: [];
  stats: [];
  ai: [];
  studyRoom: [];
  garden: [];
  auth: [];
  charts: [];
}>();

function toggleExpand() {
  expanded.value = !expanded.value;
}
</script>

<template>
  <div class="header-buttons">
    <button class="btn-header" title="教程" @click="emit('tutorial')">📖</button>
    <button class="btn-header" title="设置" @click="emit('settings')">⚙️</button>

    <div class="header-buttons-hidden" :class="{ expanded }">
      <button
        v-if="settings.settings.showDarkModeBtn"
        class="btn-header"
        title="切换深色模式"
        @click="emit('theme')"
      >
        {{ settings.isDark ? "☀️" : "🌙" }}
      </button>
      <button
        v-if="settings.settings.showStatsBtn"
        class="btn-header"
        title="数据统计"
        @click="emit('stats')"
      >
        📈
      </button>
      <button
        v-if="settings.settings.showAiBtn"
        class="btn-header"
        title="AI规划助手"
        @click="emit('ai')"
      >
        🤖
      </button>
      <button
        v-if="settings.settings.showStudyRoomBtn"
        class="btn-header"
        title="自习室"
        @click="emit('studyRoom')"
      >
        👥
      </button>
      <button
        v-if="settings.settings.showGardenBtn"
        class="btn-header"
        title="菜园子"
        @click="emit('garden')"
      >
        🌱
      </button>
      <button
        v-if="settings.settings.showChartsBtn"
        class="btn-header"
        title="图表"
        @click="emit('charts')"
      >
        📊
      </button>
      <button class="btn-header" title="云端登录" @click="emit('auth')">☁️</button>
    </div>

    <button
      v-if="settings.settings.showHeaderExpandBtn"
      class="btn-header btn-expand"
      :class="{ expanded }"
      title="展开/收起"
      @click="toggleExpand"
    ></button>
  </div>
</template>

<style scoped>
.header-buttons {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  z-index: var(--z-header-btn);
}

.btn-header {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  border: none;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-shrink: 0;
}

.btn-header:hover {
  background: rgba(255, 255, 255, 0.3);
}

.header-buttons-hidden {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.3s ease, clip-path 0.3s ease, margin 0.3s ease;
  clip-path: circle(0% at center);
  margin-top: -4px;
}

.header-buttons-hidden.expanded {
  /* 容纳全部 7 个按钮：7×26 + 6×4 gap = 206px，留余量到 240px */
  max-height: 240px;
  clip-path: circle(200% at center);
  margin-top: 0;
}

.btn-expand {
  font-size: 0;
  background: rgba(255, 255, 255, 0.15);
  transform: rotate(0deg);
  transition: transform 0.3s ease, background 0.3s ease;
}

.btn-expand::after {
  content: "";
  display: block;
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 6px solid white;
}

.btn-expand:hover {
  background: rgba(255, 255, 255, 0.3);
}

.btn-expand.expanded {
  transform: rotate(180deg);
}
</style>
