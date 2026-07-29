<script setup lang="ts">
/**
 * 加载进度条覆盖层
 *
 * 参照原 Electron 版 loading.html：
 *   应用启动时显示 spinner + 标题 + 进度条，加载完成后淡出。
 */
import { ref, onMounted } from "vue";

const props = defineProps<{
  visible: boolean;
}>();

const progress = ref(0);
const status = ref("正在启动...");

onMounted(() => {
  // 模拟加载进度（真实场景中等后端 ready 事件）
  const timer = setInterval(() => {
    progress.value = Math.min(progress.value + 10, 90);
    if (progress.value >= 50) {
      status.value = "正在加载...";
    }
    if (progress.value >= 90) {
      clearInterval(timer);
    }
  }, 200);
});
</script>

<template>
  <Transition name="loading-fade">
    <div v-if="props.visible" class="loading-overlay">
      <div class="loading-spinner"></div>
      <div class="loading-title">番茄钟</div>
      <div class="loading-status">{{ status }}</div>
      <div class="loading-progress-container">
        <div class="loading-progress-bar" :style="{ width: progress + '%' }"></div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.loading-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(234, 102, 102, 0.92), rgba(180, 110, 110, 0.82));
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 9999;
  border-radius: 20px;
  font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif;
}

.loading-spinner {
  width: 60px;
  height: 60px;
  border: 4px solid rgba(255, 255, 255, 0.2);
  border-top-color: rgba(255, 255, 255, 0.9);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-title {
  margin-top: 24px;
  font-size: 22px;
  color: rgba(255, 255, 255, 0.95);
  font-weight: 600;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.loading-status {
  margin-top: 12px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
}

.loading-progress-container {
  margin-top: 20px;
  width: 200px;
  height: 4px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  overflow: hidden;
}

.loading-progress-bar {
  height: 100%;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 2px;
  transition: width 0.3s ease;
}

/* Transition */
.loading-fade-leave-active {
  transition: opacity 0.4s ease;
}
.loading-fade-leave-to {
  opacity: 0;
}
</style>
