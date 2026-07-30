<script setup lang="ts">
/**
 * 教程弹窗
 * 显示 PomoSolo 基本使用说明
 */
const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

function onBackdropClick(e: MouseEvent): void {
  if (e.target === e.currentTarget) emit("close");
}
</script>

<template>
  <Transition name="panel">
    <div v-if="props.visible" class="tutorial-overlay" @click="onBackdropClick">
      <div class="tutorial-panel">
        <div class="tutorial-header">
          <h2 class="tutorial-title">📖 使用教程</h2>
          <button class="tutorial-close" @click="emit('close')">×</button>
        </div>
        <div class="tutorial-body">
          <section class="tutorial-section">
            <h3 class="tutorial-section__title">🍅 番茄钟</h3>
            <p>点击「开始」启动专注计时，完成后自动进入休息模式。</p>
            <p>在左侧边栏选择预设时长（25/30/45/60分钟），或切换到「计划」模式自定义任务。</p>
          </section>
          <section class="tutorial-section">
            <h3 class="tutorial-section__title">⏱️ 模式切换</h3>
            <p>左上角拨杆切换三种模式：单次、计划、正向计时。</p>
            <p>正向计时从零开始累计，适合不确定时长的任务。</p>
          </section>
          <section class="tutorial-section">
            <h3 class="tutorial-section__title">🎵 音乐播放</h3>
            <p>底部音乐播放器支持播放/暂停、上一首/下一首、音量控制。</p>
            <p>将音乐文件放入 music 文件夹即可自动添加到播放列表。</p>
          </section>
          <section class="tutorial-section">
            <h3 class="tutorial-section__title">📝 备注与统计</h3>
            <p>在计时器下方输入当前任务备注，完成后自动记录到统计。</p>
            <p>点击「统计」按钮查看今日和历史的专注数据。</p>
          </section>
          <section class="tutorial-section">
            <h3 class="tutorial-section__title">🌱 菜园子</h3>
            <p>专注时间会转化为金币，用于购买种子和种植作物。</p>
            <p>每日签到可获得额外奖励，连续签到有里程碑奖励。</p>
          </section>
          <section class="tutorial-section">
            <h3 class="tutorial-section__title">⌨️ 快捷键</h3>
            <p><kbd>空格</kbd> — 开始/暂停计时</p>
            <p><kbd>Esc</kbd> — 关闭弹窗</p>
          </section>
        </div>
        <div class="tutorial-footer">
          <button class="tutorial-btn" @click="emit('close')">明白了</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.tutorial-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: var(--z-overlay-ui);
  display: flex;
  align-items: center;
  justify-content: center;
}

.tutorial-panel {
  width: 460px;
  max-width: 90vw;
  max-height: 80vh;
  background: #1a1a1a;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}

.tutorial-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.tutorial-title {
  font-size: 18px;
  font-weight: 600;
  color: #fff;
}

.tutorial-close {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  font-size: 20px;
  color: rgba(255, 255, 255, 0.6);
  transition: all 0.15s ease;
}

.tutorial-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.tutorial-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 20px;
}

.tutorial-section {
  padding: 12px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.tutorial-section:last-child {
  border-bottom: none;
}

.tutorial-section__title {
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  margin-bottom: 6px;
}

.tutorial-section p {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  line-height: 1.6;
  margin: 4px 0;
}

kbd {
  display: inline-block;
  padding: 2px 8px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  font-size: 12px;
  color: #fff;
  font-family: monospace;
}

.tutorial-footer {
  padding: 12px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  justify-content: flex-end;
}

.tutorial-btn {
  padding: 8px 24px;
  border-radius: 8px;
  background: var(--accent, #e94560);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  transition: opacity 0.15s ease;
}

.tutorial-btn:hover {
  opacity: 0.9;
}

/* Scrollbar */
.tutorial-body::-webkit-scrollbar {
  width: 6px;
}
.tutorial-body::-webkit-scrollbar-track {
  background: transparent;
}
.tutorial-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}
.tutorial-body::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.4);
}

/* Transition：遮罩层 opacity 0→1，内容 scale 0.92→1 */
.panel-enter-active,
.panel-leave-active {
  transition: opacity 0.25s ease;
}

.panel-enter-active .tutorial-panel,
.panel-leave-active .tutorial-panel {
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.panel-enter-from,
.panel-leave-to {
  opacity: 0;
}

.panel-enter-from .tutorial-panel,
.panel-leave-to .tutorial-panel {
  transform: scale(0.92);
}
</style>
