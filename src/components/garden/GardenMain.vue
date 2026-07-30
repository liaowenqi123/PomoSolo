<script setup lang="ts">
/**
 * 菜园子 - 主界面组件
 * 迁移自 electron/src/scripts/modules/garden.js
 *
 * 协调土地格子、商店、背包、签到、成就墙、种植轮盘子组件。
 * 所有数据操作通过 useGardenStore 调用后端。
 */
import { ref, onMounted } from "vue";
import { useGardenStore } from "@/stores/garden";
import { hideGardenWindow } from "@/api/window";
import GardenPlot from "./GardenPlot.vue";
import GardenShop from "./GardenShop.vue";
import GardenBag from "./GardenBag.vue";
import GardenSignin from "./GardenSignin.vue";
import GardenAchievement from "./GardenAchievement.vue";
import GardenPlantWheel from "./GardenPlantWheel.vue";

const store = useGardenStore();

// ===== 弹窗状态 =====
const shopVisible = ref(false);
const signinVisible = ref(false);
const achievementVisible = ref(false);

// ===== 种植轮盘状态 =====
const wheelVisible = ref(false);
const wheelX = ref(0);
const wheelY = ref(0);
const wheelPlotIndex = ref(-1);

// ===== 生命周期 =====
onMounted(async () => {
  await store.load();
});

// ===== 事件处理 =====

/** 点击空地种植 */
function handlePlant(plotIndex: number, clientX: number, clientY: number) {
  if (store.plantWheelMode) {
    // 轮盘模式：显示种植轮盘
    wheelPlotIndex.value = plotIndex;
    wheelX.value = clientX;
    wheelY.value = clientY;
    wheelVisible.value = true;
  } else {
    // 传统模式：使用选中的种子
    if (store.selectedSeed) {
      void store.plant(plotIndex, store.selectedSeed);
    } else {
      store.tip = "请先选择一个种子";
    }
  }
}

/** 轮盘选中种子 */
async function handleWheelSelect(seedKey: string) {
  wheelVisible.value = false;
  if (wheelPlotIndex.value >= 0) {
    await store.plant(wheelPlotIndex.value, seedKey);
  }
  wheelPlotIndex.value = -1;
}

/** 关闭轮盘 */
function handleWheelClose() {
  wheelVisible.value = false;
  wheelPlotIndex.value = -1;
}

/** 收获作物 */
async function handleHarvest(plotIndex: number) {
  await store.harvest(plotIndex);
}

/** 解锁土地 */
async function handleUnlock(plotIndex: number) {
  await store.unlockPlot(plotIndex);
}

/** 关闭菜园子窗口 */
function handleClose() {
  void hideGardenWindow();
}
</script>

<template>
  <div class="garden-frame" :class="{ 'wheel-mode': store.plantWheelMode }">
    <!-- 顶部拖动区 -->
    <div class="garden-draggable" data-tauri-drag-region></div>
    <!-- 关闭按钮 -->
    <button class="garden-close-btn" title="关闭" @click="handleClose">×</button>
    <div class="garden-header">
      <div class="garden-header__coins">
        💰 <span class="garden-header__coin-count">{{ store.coins }}</span>
      </div>
      <h2 class="garden-header__title">🌱 菜园子</h2>
      <div class="garden-header__actions">
        <button
          class="garden-nav-btn"
          :class="{ signed: !store.canSignInToday }"
          title="每日签到"
          @click="signinVisible = true"
        >
          📅
        </button>
        <button class="garden-nav-btn" title="商店" @click="shopVisible = true">
          🛒
        </button>
        <button class="garden-nav-btn" title="成就墙" @click="achievementVisible = true">
          🏆
        </button>
      </div>
    </div>

    <GardenPlot
      @plant="handlePlant"
      @harvest="handleHarvest"
      @unlock="handleUnlock"
    />

    <div class="garden-bag-area">
      <GardenBag :show-seed-selection="!store.plantWheelMode" />
    </div>

    <div class="garden-tip" :title="store.tip">{{ store.tip }}</div>

    <!-- 商店弹窗 -->
    <GardenShop :visible="shopVisible" @close="shopVisible = false" />

    <!-- 签到弹窗 -->
    <GardenSignin :visible="signinVisible" @close="signinVisible = false" />

    <!-- 成就墙弹窗 -->
    <GardenAchievement :visible="achievementVisible" @close="achievementVisible = false" />

    <!-- 种植轮盘 -->
    <GardenPlantWheel
      :visible="wheelVisible"
      :x="wheelX"
      :y="wheelY"
      :seeds="store.seeds"
      @select="handleWheelSelect"
      @close="handleWheelClose"
    />
  </div>
</template>

<style scoped>
/* 菜园子框架 - 添加圆角，配合透明无边框窗口 */
.garden-frame {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: linear-gradient(135deg, #2d5a27 0%, #1a3a15 100%);
  color: #fff;
  position: relative;
  overflow: hidden;
  border-radius: 16px;
}

/* 顶部拖动区 */
.garden-draggable {
  -webkit-app-region: drag;
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 30px;
  z-index: var(--z-base);
}

/* 关闭按钮 */
.garden-close-btn {
  position: absolute;
  top: 4px;
  right: 8px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: #fff;
  font-size: 18px;
  cursor: pointer;
  z-index: var(--z-sidebar-btn);
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-app-region: no-drag;
  transition: background 0.2s ease;
}

.garden-close-btn:hover {
  background: rgba(255, 100, 100, 0.6);
}

.garden-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  padding-top: 34px;
  background: rgba(0, 0, 0, 0.25);
}

.garden-header__coins {
  font-size: 16px;
  color: #ffd54f;
  font-weight: 600;
}

.garden-header__coin-count {
  font-variant-numeric: tabular-nums;
}

.garden-header__title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.garden-header__actions {
  display: flex;
  gap: 6px;
}

.garden-nav-btn {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
  font-size: 18px;
  cursor: pointer;
  transition: background 0.2s ease, transform 0.15s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.garden-nav-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  transform: translateY(-1px);
}

.garden-nav-btn.signed {
  background: rgba(76, 175, 80, 0.3);
}

.garden-bag-area {
  padding: 12px 16px;
  /* 保持自然高度，让 garden-grid 占据剩余空间并可滚动 */
  flex-shrink: 0;
}

.garden-tip {
  padding: 8px 16px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  background: rgba(0, 0, 0, 0.3);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
