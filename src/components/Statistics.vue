<script setup lang="ts">
/**
 * 统计面板
 *
 * 显示今日番茄数、总专注分钟数，用 Chart.js 绘制最近 7 天的专注时长柱状图。
 * 参考 electron/src/scripts/modules/statistics.js。
 */
import { ref, watch, onMounted, onUnmounted, nextTick } from "vue";
import Chart from "chart.js/auto";
import type { Chart as ChartType, ChartConfiguration } from "chart.js";
import { useStatsStore } from "../stores/stats";

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const stats = useStatsStore();

const canvasRef = ref<HTMLCanvasElement | null>(null);
let chartInstance: ChartType | null = null;

function buildConfig(): ChartConfiguration {
  const data = stats.last7Days;
  return {
    type: "bar",
    data: {
      labels: data.map((d) => d.label),
      datasets: [
        {
          label: "专注时长（分钟）",
          data: data.map((d) => d.minutes),
          backgroundColor: "rgba(233, 69, 96, 0.6)",
          borderColor: "rgba(233, 69, 96, 1)",
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: "#eee", font: { size: 12 } },
        },
      },
      scales: {
        x: {
          ticks: { color: "#888" },
          grid: { color: "rgba(255,255,255,0.05)" },
        },
        y: {
          ticks: { color: "#888" },
          grid: { color: "rgba(255,255,255,0.05)" },
          beginAtZero: true,
        },
      },
    },
  };
}

async function renderChart(): Promise<void> {
  if (!canvasRef.value) return;
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
  chartInstance = new Chart(canvasRef.value, buildConfig());
}

function updateChart(): void {
  if (!chartInstance) return;
  const data = stats.last7Days;
  chartInstance.data.labels = data.map((d) => d.label);
  chartInstance.data.datasets[0].data = data.map((d) => d.minutes);
  chartInstance.update();
}

// 面板打开时渲染图表
watch(
  () => props.visible,
  async (visible) => {
    if (visible) {
      await nextTick();
      await renderChart();
    } else {
      if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
      }
    }
  },
);

watch(
  () => stats.last7Days,
  () => {
    if (props.visible) updateChart();
  },
  { deep: true },
);

onMounted(async () => {
  if (props.visible) {
    await nextTick();
    await renderChart();
  }
});

onUnmounted(() => {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
});

function onBackdropClick(): void {
  emit("close");
}

function onContentClick(e: MouseEvent): void {
  e.stopPropagation();
}
</script>

<template>
  <Transition name="panel">
    <div
      v-if="props.visible"
      class="stats-overlay"
      @click="onBackdropClick"
    >
      <div class="stats-panel" @click="onContentClick">
        <div class="stats-panel__header">
          <h2 class="stats-panel__title">统计</h2>
          <button class="stats-panel__close" @click="emit('close')">
            ×
          </button>
        </div>

        <div class="stats-panel__body">
          <!-- 概览卡片 -->
          <div class="stats-cards">
            <div class="stats-card">
              <div class="stats-card__value">{{ stats.todayCount }}</div>
              <div class="stats-card__label">今日番茄</div>
            </div>
            <div class="stats-card">
              <div class="stats-card__value">{{ stats.todayMinutes }}</div>
              <div class="stats-card__label">今日专注（分钟）</div>
            </div>
            <div class="stats-card">
              <div class="stats-card__value">{{ stats.totalMinutes }}</div>
              <div class="stats-card__label">累计专注（分钟）</div>
            </div>
          </div>

          <!-- 图表 -->
          <div class="stats-chart-container">
            <canvas ref="canvasRef"></canvas>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.stats-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
}

.stats-panel {
  width: 520px;
  max-width: 90vw;
  max-height: 80vh;
  background: var(--bg-secondary, #16213e);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
}

.stats-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.stats-panel__title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.stats-panel__close {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  font-size: 20px;
  color: var(--text-secondary);
  transition: all 0.15s ease;
}

.stats-panel__close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.stats-panel__body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.stats-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.stats-card {
  background: rgba(255, 255, 255, 0.04);
  border-radius: 12px;
  padding: 16px;
  text-align: center;
}

.stats-card__value {
  font-size: 28px;
  font-weight: 700;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
}

.stats-card__label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.stats-chart-container {
  height: 240px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 12px;
  padding: 12px;
}

/* Transition */
.panel-enter-active,
.panel-leave-active {
  transition: opacity 0.2s ease;
}

.panel-enter-from,
.panel-leave-to {
  opacity: 0;
}
</style>
