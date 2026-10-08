<script setup lang="ts">
/**
 * 菜园子 - 成就墙组件
 * 迁移自 deprecated/electron/src/scripts/modules/gardenAchievement.js
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

/** 每个分类下的成就数量（含"全部"），用于 tab 徽标 */
const categoryCounts = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {};
  for (const cat of ACHIEVEMENT_CATEGORIES) {
    counts[cat.key] =
      cat.key === "all"
        ? Object.keys(ACHIEVEMENT_CONFIG).length
        : Object.values(ACHIEVEMENT_CONFIG).filter((a) => a.category === cat.key).length;
  }
  return counts;
});

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
          :class="{ active: activeCategory === cat.key, all: cat.key === 'all' }"
          :data-count="categoryCounts[cat.key]"
          :title="`${cat.label} ${categoryCounts[cat.key]} 个成就`"
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
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal);
  border-radius: 16px;
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
  /* 等宽网格：每个分类按钮占用相同的可点击区域，不受标签长度影响；
     auto-fill 保证窄窗口换行后每列宽度一致（不拉伸成孤行大按钮） */
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
  gap: 6px;
  padding: 0 18px 12px;
}

.achievement-tab {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 6px 4px;
  min-height: 34px; /* 加大点击热区，精确点击不再困难 */
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid transparent;
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.75);
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  transition: all 0.2s ease;
}

/* 数量徽标：用 ::after + attr(data-count)，不进入文本内容，保证标签语义/测试文本不变 */
.achievement-tab::after {
  content: attr(data-count);
  font-size: 10px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
  font-variant-numeric: tabular-nums;
}

.achievement-tab:hover {
  background: rgba(255, 255, 255, 0.1);
}

.achievement-tab.active {
  background: rgba(233, 69, 96, 0.2);
  border-color: #e94560;
  color: #fff;
}

.achievement-tab.active::after {
  background: rgba(233, 69, 96, 0.35);
  color: #ffd9de;
}

/* 「全部」tab 独特性：琥珀金做轻微区分（汇总视图 vs 单类目，一眼可辨但不抢眼） */
.achievement-tab.all {
  background: rgba(255, 213, 79, 0.08);
}

.achievement-tab.all:hover {
  background: rgba(255, 213, 79, 0.16);
}

.achievement-tab.all.active {
  background: rgba(255, 213, 79, 0.22);
  border-color: #ffd54f;
  color: #fff;
}

.achievement-tab.all.active::after {
  background: rgba(255, 213, 79, 0.32);
  color: #fff7d6;
}

.achievement-list {
  padding: 0 18px 14px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* 最小高度：分类成就很少（如"隐藏"只有 1 个）时列表/弹窗高度不收缩，
     避免点击目标随界面高度变化而跳动 */
  min-height: 260px;
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
