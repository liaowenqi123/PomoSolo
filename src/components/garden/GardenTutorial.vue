<script setup lang="ts">
/**
 * 菜园子教程面板
 *
 * 按"行为里程碑"渐进解锁（见 gardenTutorial.ts）：
 * - 已解锁的卡片：显示图标/简介，点击展开详情
 * - 未解锁的卡片：灰显 + 🔒 + 解锁方式提示，引导用户"再专注一点就解锁"
 */
import { ref, computed } from "vue";
import Modal from "../Modal.vue";
import { useGardenStore } from "@/stores/garden";
import { buildTutorialCards } from "./gardenTutorial";

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
}>();

const store = useGardenStore();

const cards = computed(() =>
  buildTutorialCards().map((c) => ({
    ...c,
    isUnlocked: c.unlocked(store.data),
  })),
);

const unlockedCount = computed(() => cards.value.filter((c) => c.isUnlocked).length);

const expandedKey = ref<string | null>(null);

function toggle(key: string): void {
  expandedKey.value = expandedKey.value === key ? null : key;
}

function close(): void {
  emit("update:visible", false);
}

/** Modal 关闭回调（点击背景 / 关闭按钮时） */
function onModalVisibleChange(v: boolean): void {
  emit("update:visible", v);
}
</script>

<template>
  <Modal
    :visible="visible"
    title="📖 菜园子教程"
    :close-on-background="false"
    width="400px"
    @update:visible="onModalVisibleChange"
  >
    <div class="tutorial-content">
      <div class="tutorial-progress">
        <span class="tutorial-progress__text">
          已解锁 {{ unlockedCount }} / {{ cards.length }} 项知识
        </span>
        <div class="tutorial-progress__bar">
          <div
            class="tutorial-progress__fill"
            :style="{ width: (unlockedCount / cards.length) * 100 + '%' }"
          ></div>
        </div>
        <p class="tutorial-progress__hint">
          多用几次菜园子，教程会随着你的成长逐步解锁。
        </p>
      </div>

      <div class="tutorial-list">
        <div
          v-for="card in cards"
          :key="card.key"
          class="tutorial-card"
          :class="{
            unlocked: card.isUnlocked,
            locked: !card.isUnlocked,
            expanded: expandedKey === card.key,
          }"
          :title="card.isUnlocked ? '点击查看详情' : ''"
          @click="card.isUnlocked && toggle(card.key)"
        >
          <div class="tutorial-card__head">
            <span class="tutorial-card__icon">{{ card.isUnlocked ? card.icon : "🔒" }}</span>
            <div class="tutorial-card__texts">
              <span class="tutorial-card__title">{{ card.title }}</span>
              <span v-if="card.isUnlocked" class="tutorial-card__desc">{{ card.desc }}</span>
              <span v-else class="tutorial-card__hint">{{ card.unlockHint }}</span>
            </div>
            <span v-if="card.isUnlocked" class="tutorial-card__arrow">
              {{ expandedKey === card.key ? "▾" : "▸" }}
            </span>
          </div>
          <ul v-if="card.isUnlocked && expandedKey === card.key" class="tutorial-card__details">
            <li v-for="(d, i) in card.details" :key="i" class="tutorial-card__detail">
              {{ d }}
            </li>
          </ul>
        </div>
      </div>
    </div>

    <template #footer>
      <button class="tutorial-close-btn" @click="close">知道了</button>
    </template>
  </Modal>
</template>

<style scoped>
.tutorial-content {
  padding: 4px 0;
}

/* 顶部进度 */
.tutorial-progress {
  margin-bottom: 12px;
  text-align: center;
}
.tutorial-progress__text {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
}
.tutorial-progress__bar {
  height: 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
  overflow: hidden;
  margin: 6px 0 4px;
}
.tutorial-progress__fill {
  height: 100%;
  background: linear-gradient(90deg, #66bb6a, #ffd54f);
  transition: width 0.4s ease;
}
.tutorial-progress__hint {
  margin: 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
}

/* 卡片列表 */
.tutorial-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 300px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.25) transparent;
}

.tutorial-card {
  border-radius: 8px;
  overflow: hidden;
  transition: background 0.2s ease;
}
.tutorial-card.unlocked {
  background: rgba(255, 255, 255, 0.06);
  cursor: pointer;
}
.tutorial-card.unlocked:hover {
  background: rgba(255, 255, 255, 0.1);
}
.tutorial-card.locked {
  background: rgba(255, 255, 255, 0.03);
  opacity: 0.6;
  cursor: default;
}

.tutorial-card__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
}
.tutorial-card__icon {
  font-size: 18px;
  flex-shrink: 0;
  width: 24px;
  text-align: center;
}
.tutorial-card__texts {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.tutorial-card__title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
}
.tutorial-card__desc {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.6);
  line-height: 1.4;
}
.tutorial-card__hint {
  font-size: 11px;
  color: rgba(255, 213, 79, 0.85);
}
.tutorial-card__arrow {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  flex-shrink: 0;
}

/* 展开详情 */
.tutorial-card__details {
  list-style: none;
  margin: 0;
  padding: 0 10px 10px 44px;
}
.tutorial-card__detail {
  font-size: 12px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.78);
  position: relative;
  padding-left: 12px;
}
.tutorial-card__detail::before {
  content: "";
  position: absolute;
  left: 0;
  top: 8px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #ffd54f;
  opacity: 0.7;
}

.tutorial-close-btn {
  padding: 9px 16px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  background: var(--accent, #e94560);
  color: #fff;
}
.tutorial-close-btn:hover {
  opacity: 0.9;
}
</style>
