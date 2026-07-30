<script setup lang="ts">
/**
 * 菜园子 - 商店组件
 * 迁移自 electron/src/scripts/modules/gardenShop.js
 *
 * 弹窗形式，包含购买种子和出售作物两个标签页。
 */
import { ref, computed } from "vue";
import { useGardenStore, CROP_CONFIG, CROP_ORDER } from "@/stores/garden";

const store = useGardenStore();

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const activeTab = ref<"buy" | "sell">("buy");

const cropList = computed(() =>
  CROP_ORDER.map((key) => ({ key, ...CROP_CONFIG[key] })),
);

const coins = computed(() => store.coins);
const crops = computed(() => store.crops);

const hasCropsToSell = computed(() =>
  Object.values(crops.value).some((c) => (c as number) > 0),
);

async function handleBuy(seedKey: string) {
  await store.buySeed(seedKey, 1);
}

async function handleSell(cropKey: string) {
  await store.sellCrop(cropKey, 1);
}

function handleBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    emit("close");
  }
}
</script>

<template>
  <div v-if="props.visible" class="shop-modal" @click="handleBackdropClick">
    <div class="shop-modal__panel">
      <div class="shop-modal__header">
        <h3 class="shop-modal__title">🛒 商店</h3>
        <button class="shop-modal__close" @click="emit('close')">✕</button>
      </div>

      <div class="shop-modal__coins">💰 金币：{{ coins }}</div>

      <div class="shop-tabs">
        <button
          class="shop-tab"
          :class="{ active: activeTab === 'buy' }"
          @click="activeTab = 'buy'"
        >
          购买种子
        </button>
        <button
          class="shop-tab"
          :class="{ active: activeTab === 'sell' }"
          @click="activeTab = 'sell'"
        >
          出售作物
        </button>
      </div>

      <!-- 购买面板 -->
      <div v-show="activeTab === 'buy'" class="shop-panel">
        <div class="shop-grid">
          <div v-for="crop in cropList" :key="crop.key" class="shop-item">
            <div class="shop-item__icon">{{ crop.icon }}</div>
            <div class="shop-item__name">{{ crop.name }}种子</div>
            <div class="shop-item__info">⏱ {{ crop.growTime }}分钟</div>
            <div class="shop-item__price">💰 {{ crop.seedPrice }}</div>
            <button
              class="shop-item__btn"
              :disabled="coins < crop.seedPrice"
              @click="handleBuy(crop.key)"
            >
              {{ coins >= crop.seedPrice ? "购买" : "金币不足" }}
            </button>
          </div>
        </div>
      </div>

      <!-- 出售面板 -->
      <div v-show="activeTab === 'sell'" class="shop-panel">
        <div v-if="!hasCropsToSell" class="shop-empty">暂无可出售的作物</div>
        <div v-else class="shop-grid">
          <template v-for="crop in cropList" :key="crop.key">
            <div v-if="(crops[crop.key] || 0) > 0" class="shop-item">
              <div class="shop-item__icon">{{ crop.icon }}</div>
              <div class="shop-item__name">{{ crop.name }}</div>
              <div class="shop-item__info">拥有: x{{ crops[crop.key] || 0 }}</div>
              <div class="shop-item__price">💰 {{ crop.sellPrice }}</div>
              <button class="shop-item__btn sell" @click="handleSell(crop.key)">
                出售
              </button>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shop-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal);
}

.shop-modal__panel {
  width: 480px;
  max-width: 90vw;
  max-height: 80vh;
  background: #1f2233;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
}

.shop-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.shop-modal__title {
  margin: 0;
  font-size: 18px;
  color: #fff;
}

.shop-modal__close {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.7);
  font-size: 18px;
  cursor: pointer;
  padding: 4px 8px;
}

.shop-modal__close:hover {
  color: #fff;
}

.shop-modal__coins {
  padding: 8px 18px;
  font-size: 14px;
  color: #ffd54f;
  font-weight: 600;
}

.shop-tabs {
  display: flex;
  padding: 0 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.shop-tab {
  flex: 1;
  padding: 10px;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  font-size: 14px;
  border-bottom: 2px solid transparent;
  transition: color 0.2s ease, border-color 0.2s ease;
}

.shop-tab.active {
  color: #fff;
  border-bottom-color: #e94560;
}

.shop-panel {
  padding: 14px 18px;
  overflow-y: auto;
  flex: 1;
}

.shop-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 12px;
}

.shop-item {
  background: rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.shop-item__icon {
  font-size: 28px;
}

.shop-item__name {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.95);
  font-weight: 600;
}

.shop-item__info {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.7);
}

.shop-item__price {
  font-size: 13px;
  color: #ffd54f;
  font-weight: 600;
}

.shop-item__btn {
  margin-top: 6px;
  padding: 5px 16px;
  border: none;
  border-radius: 6px;
  background: #e94560;
  color: #fff;
  cursor: pointer;
  font-size: 12px;
  transition: opacity 0.2s ease;
}

.shop-item__btn.sell {
  background: #4caf50;
}

.shop-item__btn:disabled {
  background: #555;
  cursor: not-allowed;
  opacity: 0.6;
}

.shop-empty {
  text-align: center;
  color: rgba(255, 255, 255, 0.5);
  padding: 40px 0;
}

/* ============ 统一滚动条样式 ============ */
.shop-panel::-webkit-scrollbar {
  width: 6px;
}

.shop-panel::-webkit-scrollbar-track {
  background: transparent;
}

.shop-panel::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

.shop-panel::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.4);
}
</style>
