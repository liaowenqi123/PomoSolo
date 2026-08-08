<script setup lang="ts">
/**
 * 菜园子 - 土地格子组件
 * 迁移自 electron/src/scripts/modules/gardenPlot.js
 *
 * 显示 12 块土地，根据状态渲染：锁定 / 空地 / 已种植（含进度）。
 * 点击空地触发 plant 事件，点击成熟作物触发 harvest，点击锁定土地触发 unlock。
 */
import { computed } from "vue";
import {
  useGardenStore,
  CROP_CONFIG,
  PLOT_UNLOCK_CONFIG,
  type Plot,
} from "@/stores/garden";
import CropSprite from "./CropSprite.vue";

const store = useGardenStore();

const props = defineProps<{
  /** 当前选中的格子索引（高亮用） */
  selectedPlotIndex?: number | null;
}>();

const emit = defineEmits<{
  /** 点击空地种植（带鼠标坐标用于轮盘定位） */
  (e: "plant", plotIndex: number, clientX: number, clientY: number): void;
  /** 点击成熟作物收获 */
  (e: "harvest", plotIndex: number): void;
  /** 解锁土地 */
  (e: "unlock", plotIndex: number): void;
}>();

const plots = computed<Plot[]>(() => store.plots);

/** 计算格子进度百分比 */
function getProgress(plot: Plot): number {
  if (!plot.crop) return 0;
  const config = CROP_CONFIG[plot.crop];
  if (!config) return 0;
  return Math.min(100, (plot.progress / config.growTime) * 100);
}

/** 是否成熟 */
function isMature(plot: Plot): boolean {
  return getProgress(plot) >= 100;
}

/**
 * 生长阶段：0-33% 幼苗，33-66% 成株，66%+ 成熟。
 * 由 CropSprite 渲染对应阶段的 SVG 造型。
 */
function getStage(plot: Plot): 1 | 2 | 3 {
  if (!plot.crop) return 1;
  const config = CROP_CONFIG[plot.crop];
  if (!config) return 1;
  const pct = plot.progress / config.growTime;
  if (pct >= 0.66) return 3;
  if (pct >= 0.33) return 2;
  return 1;
}

/**
 * 处理格子点击。
 *
 * 空地：直接呼出种植轮盘（不再自动快捷种植，修复"有种子时轮盘呼不出"）。
 * 同时 stopPropagation 阻止 click 冒泡到 document——
 * 种植轮盘打开后监听 document click 用于点击外部关闭，
 * 若不阻止，本次点击空地会立即把刚打开的轮盘关掉。
 */
function handleClick(plot: Plot, index: number, event: MouseEvent) {
  if (plot.locked) return;

  // 枯萎作物：提示需要专注救活
  if (plot.wilted) {
    store.tip = "🌱 作物枯萎了，完成一个番茄钟救活它";
    return;
  }

  // 有作物：成熟则收获，未成熟提示
  if (plot.crop) {
    if (isMature(plot)) {
      emit("harvest", index);
    } else {
      store.tip = "作物还未成熟，无法收获";
    }
    return;
  }

  // 空地：呼出种植轮盘（带鼠标坐标用于轮盘定位）
  event.stopPropagation();
  emit("plant", index, event.clientX, event.clientY);
}

/** 解锁按钮点击 */
function handleUnlock(index: number, event: MouseEvent) {
  event.stopPropagation();
  emit("unlock", index);
}

/** 判断锁定土地是否满足解锁条件 */
function canUnlock(index: number): boolean {
  const cfg = PLOT_UNLOCK_CONFIG[index];
  if (!cfg) return false;
  if (cfg.type === "coins") {
    return store.coins >= (cfg.price ?? 0);
  }
  if (cfg.type === "achievement") {
    const ach = store.data.achievements || {};
    return !!ach[cfg.achievementId ?? ""]?.unlocked;
  }
  return false;
}
</script>

<template>
  <div class="garden-grid">
    <div
      v-for="(plot, index) in plots"
      :key="plot.id"
      class="garden-plot"
      :class="{
        locked: plot.locked,
        empty: !plot.locked && !plot.crop && !plot.wilted,
        'has-crop': !plot.locked && !!plot.crop,
        wilted: !plot.locked && !!plot.wilted,
        mature: !plot.locked && !!plot.crop && isMature(plot) && !plot.wilted,
        selected: props.selectedPlotIndex === index,
      }"
      @click="!plot.locked ? handleClick(plot, index, $event) : undefined"
    >
      <!-- 锁定土地 -->
      <template v-if="plot.locked">
        <div class="lock-content">
          <span class="lock-icon">🔒</span>
          <template v-if="PLOT_UNLOCK_CONFIG[index]?.type === 'coins'">
            <span class="lock-price">💰{{ PLOT_UNLOCK_CONFIG[index]?.price }}</span>
            <button
              class="unlock-btn"
              :class="{ disabled: !canUnlock(index) }"
              :disabled="!canUnlock(index)"
              @click="handleUnlock(index, $event)"
            >
              {{ canUnlock(index) ? "解锁" : "金币不足" }}
            </button>
          </template>
          <template v-else-if="PLOT_UNLOCK_CONFIG[index]?.type === 'achievement'">
            <span class="lock-condition">{{ PLOT_UNLOCK_CONFIG[index]?.description }}</span>
            <button
              class="unlock-btn"
              :class="{ disabled: !canUnlock(index) }"
              :disabled="!canUnlock(index)"
              @click="handleUnlock(index, $event)"
            >
              {{ canUnlock(index) ? "解锁" : "未达成" }}
            </button>
          </template>
        </div>
      </template>

      <!-- 枯萎作物（v3：可被专注救活） -->
      <template v-else-if="plot.wilted">
        <span class="plot-wilted-icon">🥀</span>
        <span class="plot-wilted-text">专注救活</span>
      </template>

      <!-- 已种植作物 -->
      <template v-else-if="plot.crop">
        <Transition name="crop" mode="out-in">
          <div
            :key="plot.crop"
            class="crop-wrap"
            :class="{ mature: isMature(plot) }"
          >
            <CropSprite :crop="plot.crop" :stage="getStage(plot)" />
          </div>
        </Transition>
        <div class="plot-progress">
          <div class="plot-progress-fill" :style="{ width: getProgress(plot) + '%' }"></div>
        </div>
        <span class="plot-progress-text" :class="{ mature: isMature(plot) }">
          {{ isMature(plot) ? "🌾 可收获" : `${plot.progress}/${CROP_CONFIG[plot.crop]?.growTime}分钟` }}
        </span>
      </template>

      <!-- 空地 -->
      <template v-else>
        <span class="plot-empty-icon">+</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.garden-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  padding: 12px;
  max-width: 400px;
  margin: 0 auto;
  /* 在 400x520 窗口内允许纵向滚动，避免菜地被切割 */
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.25) transparent;
}

.garden-grid::-webkit-scrollbar {
  width: 5px;
}

.garden-grid::-webkit-scrollbar-track {
  background: transparent;
  border-radius: 3px;
}

.garden-grid::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.25);
  border-radius: 3px;
}

.garden-grid::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.4);
}

.garden-plot {
  aspect-ratio: 1;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  position: relative;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  background: rgba(86, 60, 30, 0.35);
  border: 2px solid rgba(255, 255, 255, 0.08);
  user-select: none;
}

.garden-plot:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.garden-plot.selected {
  border-color: #ffd54f;
  box-shadow: 0 0 12px rgba(255, 213, 79, 0.5);
}

.garden-plot.empty {
  background: rgba(86, 60, 30, 0.25);
}

.garden-plot.has-crop {
  background: rgba(76, 175, 80, 0.18);
}

.garden-plot.mature {
  background: rgba(255, 193, 7, 0.25);
  border-color: rgba(255, 193, 7, 0.5);
  animation: matureGlow 1.6s ease-in-out infinite;
}

/* 枯萎作物视觉（v3） */
.garden-plot.wilted {
  background: rgba(101, 67, 33, 0.35);
  border-color: rgba(139, 90, 43, 0.5);
  cursor: pointer;
}
.garden-plot.wilted .plot-wilted-icon {
  font-size: 30px;
  filter: grayscale(0.4);
  opacity: 0.8;
  margin-bottom: 2px;
}
.garden-plot.wilted .plot-wilted-text {
  font-size: 10px;
  color: rgba(255, 213, 79, 0.85);
}

@keyframes matureGlow {
  0%, 100% { box-shadow: 0 0 6px rgba(255, 193, 7, 0.3); }
  50% { box-shadow: 0 0 16px rgba(255, 193, 7, 0.6); }
}

.garden-plot.locked {
  cursor: default;
  background: rgba(20, 20, 20, 0.5);
  border-color: rgba(255, 255, 255, 0.05);
}

.garden-plot.locked:hover {
  transform: none;
  box-shadow: none;
}

.plot-empty-icon {
  opacity: 0.3;
  font-size: 24px;
  color: #fff;
}

/* ===== 作物 SVG + 生长动画（v3.1：手绘 Q 版植物） ===== */

.crop-wrap {
  width: 100%;
  height: 74%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  transform-origin: 50% 100%;
  animation: cropSway 3.5s ease-in-out infinite;
}

.crop-wrap.mature {
  animation: cropSway 3.5s ease-in-out infinite, matureGlow 1.6s ease-in-out infinite;
}

/* 种植弹入 */
.crop-enter-active {
  animation: cropPop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* 收获弹出 */
.crop-leave-active {
  animation: cropFade 0.3s ease forwards;
}

@keyframes cropPop {
  0% { transform: scale(0); opacity: 0; }
  70% { transform: scale(1.12); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}

@keyframes cropFade {
  to { transform: scale(0.5); opacity: 0; }
}

/* 生长中轻微摇曳（以根部为轴） */
@keyframes cropSway {
  0%, 100% { transform: rotate(-1.5deg); }
  50% { transform: rotate(1.5deg); }
}

/* 成熟金色光晕 */
@keyframes matureGlow {
  0%, 100% { filter: drop-shadow(0 0 2px rgba(255, 213, 79, 0.55)); }
  50% { filter: drop-shadow(0 0 9px rgba(255, 213, 79, 0.95)); }
}

.plot-progress-text.mature {
  color: #ffd54f;
  font-weight: 700;
}

.plot-progress {
  width: 80%;
  height: 6px;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 3px;
  overflow: hidden;
}

.plot-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #66bb6a, #ffd54f);
  transition: width 0.3s ease;
}

.plot-progress-text {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.7);
  margin-top: 3px;
}

.lock-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 6px;
}

.lock-icon {
  font-size: 20px;
  opacity: 0.6;
}

.lock-price,
.lock-condition {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.7);
  text-align: center;
}

.unlock-btn {
  margin-top: 2px;
  padding: 3px 10px;
  font-size: 11px;
  border: none;
  border-radius: 4px;
  background: #4caf50;
  color: #fff;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.unlock-btn.disabled {
  background: #555;
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
