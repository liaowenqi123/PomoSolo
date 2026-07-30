<script setup lang="ts">
/**
 * 菜园子 - 成就墙组件
 * 迁移自 electron/src/scripts/modules/gardenAchievement.js
 *
 * 显示 25 个成就（6 个分类），含进度条、奖励、解锁状态。
 */
import { ref, computed } from "vue";
import {
  useGardenStore,
  ACHIEVEMENT_CONFIG,
  ACHIEVEMENT_CATEGORIES,
  CROP_CONFIG,
  type AchievementConfig,
} from "@/stores/garden";

const store = useGardenStore();

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const activeCategory = ref<string>("all");

const unlockedCount = computed(() => store.unlockedAchievementCount);
const totalCount = computed(() => store.totalAchievementCount);

const filteredAchievements = computed<AchievementConfig[]>(() => {
  const list = Object.values(ACHIEVEMENT_CONFIG);
  if (activeCategory.value === "all") return list;
  return list.filter((a) => a.category === activeCategory.value);
});

/** 成就是否已解锁 */
function isUnlocked(id: string): boolean {
  return !!store.data.achievements?.[id]?.unlocked;
}

/** 成就进度 */
function getProgress(config: AchievementConfig): number {
  return store.getAchievementProgress(config);
}

/** 进度百分比 */
function getProgressPercent(config: AchievementConfig): number {
  return Math.min(100, (getProgress(config) / config.target) * 100);
}

/** 格式化奖励 */
function formatRewards(config: AchievementConfig): string[] {
  const result: string[] = [];
  for (const [seedKey, count] of Object.entries(config.rewards.seeds)) {
    if (count > 0) {
      const crop = CROP_CONFIG[seedKey];
      if (crop) result.push(`${crop.icon} x${count}`);
    }
  }
  if (config.rewards.coins > 0) {
    result.push(`💰 x${config.rewards.coins}`);
  }
  return result;
}

function handleBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    emit("close");
  }
}
</script>

<template>
  <div v-if="props.visible" class="achievement-modal" @click="handleBackdropClick">
    <div class="achievement-modal__panel">
      <div class="achievement-modal__header">
        <h3 class="achievement-modal__title">🏆 成就墙</h3>
        <button class="achievement-modal__close" @click="emit('close')">✕</button>
      </div>

      <div class="achievement-summary">
        已解锁 <span class="achievement-summary__num">{{ unlockedCount }}</span>
        / {{ totalCount }}
      </div>

      <div class="achievement-tabs">
        <button
          v-for="cat in ACHIEVEMENT_CATEGORIES"
          :key="cat.key"
          class="achievement-tab"
          :class="{ active: activeCategory === cat.key }"
          @click="activeCategory = cat.key"
        >
          {{ cat.label }}
        </button>
      </div>

      <div class="achievement-list">
        <div
          v-for="ach in filteredAchievements"
          :key="ach.id"
          class="achievement-item"
          :class="{ unlocked: isUnlocked(ach.id) }"
        >
          <div class="achievement-item__icon">{{ ach.icon }}</div>
          <div class="achievement-item__body">
            <div class="achievement-item__name">{{ ach.name }}</div>
            <div class="achievement-item__desc">{{ ach.description }}</div>
            <div class="achievement-item__progress">
              <div class="achievement-progress-bar">
                <div
                  class="achievement-progress-fill"
                  :style="{ width: getProgressPercent(ach) + '%' }"
                ></div>
              </div>
              <span class="achievement-progress-text">
                {{ getProgress(ach) }}/{{ ach.target }}
              </span>
            </div>
            <div class="achievement-item__rewards">
              <span
                v-for="(reward, idx) in formatRewards(ach)"
                :key="idx"
                class="achievement-reward"
              >{{ reward }}</span>
            </div>
          </div>
          <div v-if="isUnlocked(ach.id)" class="achievement-item__badge">✓</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.achievement-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal);
}

.achievement-modal__panel {
  width: 560px;
  max-width: 90vw;
  max-height: 80vh;
  background: #1f2233;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
}

.achievement-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.achievement-modal__title {
  margin: 0;
  font-size: 18px;
  color: #fff;
}

.achievement-modal__close {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.7);
  font-size: 18px;
  cursor: pointer;
}

.achievement-summary {
  padding: 8px 18px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
}

.achievement-summary__num {
  color: #ffd54f;
  font-weight: 700;
  font-size: 15px;
}

.achievement-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 18px 10px;
}

.achievement-tab {
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid transparent;
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s ease;
}

.achievement-tab.active {
  background: rgba(233, 69, 96, 0.2);
  border-color: #e94560;
  color: #fff;
}

.achievement-list {
  padding: 0 18px 14px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.achievement-item {
  display: flex;
  gap: 12px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
  border: 1px solid transparent;
  position: relative;
}

.achievement-item.unlocked {
  background: rgba(255, 213, 79, 0.08);
  border-color: rgba(255, 213, 79, 0.3);
}

.achievement-item__icon {
  font-size: 28px;
  flex-shrink: 0;
}

.achievement-item.unlocked .achievement-item__icon {
  filter: drop-shadow(0 0 6px rgba(255, 213, 79, 0.6));
}

.achievement-item__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.achievement-item__name {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
}

.achievement-item__desc {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
}

.achievement-item__progress {
  display: flex;
  align-items: center;
  gap: 8px;
}

.achievement-progress-bar {
  flex: 1;
  height: 6px;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 3px;
  overflow: hidden;
}

.achievement-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #66bb6a, #ffd54f);
  transition: width 0.3s ease;
}

.achievement-item.unlocked .achievement-progress-fill {
  background: #ffd54f;
}

.achievement-progress-text {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.7);
  white-space: nowrap;
}

.achievement-item__rewards {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.achievement-reward {
  font-size: 11px;
  padding: 2px 6px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.85);
}

.achievement-item__badge {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #4caf50;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
}

/* ============ 统一滚动条样式 ============ */
.achievement-list::-webkit-scrollbar {
  width: 6px;
}

.achievement-list::-webkit-scrollbar-track {
  background: transparent;
}

.achievement-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

.achievement-list::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.4);
}
</style>
