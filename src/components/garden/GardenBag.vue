<script setup lang="ts">
/**
 * 菜园子 - 背包组件
 * 迁移自 electron/src/scripts/modules/gardenBag.js
 *
 * 显示拥有的种子和作物。传统模式下点击种子选中用于种植。
 */
import { computed } from "vue";
import { useGardenStore, CROP_CONFIG, CROP_ORDER } from "@/stores/garden";

const store = useGardenStore();

const props = defineProps<{
  /** 是否显示种子选择（传统模式） */
  showSeedSelection?: boolean;
}>();

const seedList = computed(() =>
  CROP_ORDER.map((key) => ({
    key,
    ...CROP_CONFIG[key],
    count: store.seeds[key] || 0,
  })),
);

const cropList = computed(() =>
  CROP_ORDER.map((key) => ({
    key,
    ...CROP_CONFIG[key],
    count: store.crops[key] || 0,
  })).filter((c) => c.count > 0),
);

const hasCrops = computed(() => cropList.value.length > 0);

function handleSeedClick(seedKey: string, count: number) {
  if (count <= 0) return;
  store.selectSeed(seedKey);
}
</script>

<template>
  <div class="garden-bag">
    <!-- 种子背包 -->
    <div v-if="props.showSeedSelection" class="bag-section">
      <h4 class="bag-section__title">🌱 种子</h4>
      <div class="bag-list">
        <div
          v-for="seed in seedList"
          :key="seed.key"
          class="seed-item"
          :class="[seed.rarity, { disabled: seed.count === 0, selected: store.selectedSeed === seed.key }]"
          @click="handleSeedClick(seed.key, seed.count)"
        >
          <span class="seed-item__icon">{{ seed.icon }}</span>
          <div class="seed-item__info">
            <span class="seed-item__name">{{ seed.name }}种子</span>
            <span class="seed-item__count">x{{ seed.count }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 作物背包 -->
    <div class="bag-section">
      <h4 class="bag-section__title">🌾 作物</h4>
      <div v-if="!hasCrops" class="bag-empty">暂无收获的作物</div>
      <div v-else class="bag-list">
        <div
          v-for="crop in cropList"
          :key="crop.key"
          class="crop-item"
          :class="crop.rarity"
        >
          <span class="crop-item__icon">{{ crop.icon }}</span>
          <div class="crop-item__info">
            <span class="crop-item__name">{{ crop.name }}</span>
            <span class="crop-item__count">x{{ crop.count }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.garden-bag {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.bag-section__title {
  margin: 0 0 8px;
  font-size: 14px;
  color: #ddd;
  font-weight: 600;
}

.bag-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.seed-item,
.crop-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  border-left: 3px solid transparent;
  cursor: pointer;
  transition: background 0.2s ease, transform 0.15s ease;
}

.seed-item:hover,
.crop-item:hover {
  background: rgba(255, 255, 255, 0.1);
  transform: translateX(2px);
}

.seed-item.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.seed-item.disabled:hover {
  transform: none;
}

.seed-item.selected {
  background: rgba(255, 213, 79, 0.18);
  border-left-color: #ffd54f;
}

.seed-item.common,
.crop-item.common {
  border-left-color: #9e9e9e;
}

.seed-item.rare,
.crop-item.rare {
  border-left-color: #42a5f5;
}

.seed-item.legend,
.crop-item.legend {
  border-left-color: #ffd54f;
}

.seed-item__icon,
.crop-item__icon {
  font-size: 20px;
}

.seed-item__info,
.crop-item__info {
  display: flex;
  flex-direction: column;
  font-size: 12px;
}

.seed-item__name,
.crop-item__name {
  color: #eee;
}

.seed-item__count,
.crop-item__count {
  color: #aaa;
  font-size: 11px;
}

.bag-empty {
  text-align: center;
  color: rgba(255, 255, 255, 0.4);
  padding: 16px;
  font-size: 13px;
}
</style>
