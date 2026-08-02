<script setup lang="ts">
/**
 * 惩罚结果弹窗
 *
 * 专注模式被中断（三次警告 / 运行中重置 / 手动关闭开关）时展示损失：
 * - 有枯萎作物：列出每株作物的图标 / 名称 / 已生长分钟 + 总计损失分钟
 * - 无枯萎作物：显示"幸好没有正在生长的作物"
 *
 * 参照旧版 electron/src/scripts/modules/foregroundDetection.js 的 showPunishmentModal。
 */
import { computed } from "vue";
import Modal from "./Modal.vue";
import type { PunishmentResult } from "@/api/garden";

const props = defineProps<{
  /** 是否显示 */
  visible: boolean;
  /** 惩罚结果（null 表示尚未执行惩罚） */
  result: PunishmentResult | null;
}>();

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
}>();

function close(): void {
  emit("update:visible", false);
}

/** 是否有损失 */
const hasLoss = computed(
  () => !!props.result?.hasLoss && (props.result.losses?.length ?? 0) > 0,
);

/** 展示用损失列表（限 3 株，超出聚合为摘要，参照旧版 MAX_DISPLAY_ITEMS） */
const MAX_DISPLAY_ITEMS = 3;

const displayLosses = computed(() =>
  props.result?.losses?.slice(0, MAX_DISPLAY_ITEMS) ?? [],
);

/** 是否超过展示上限（超出时显示聚合摘要） */
const overLimit = computed(
  () => (props.result?.losses?.length ?? 0) > MAX_DISPLAY_ITEMS,
);

/** 按作物类型聚合的摘要（icon × count） */
const summaryGroups = computed(() => {
  if (!overLimit.value) return [];
  const counts = new Map<string, { name: string; icon: string; count: number }>();
  for (const loss of props.result?.losses ?? []) {
    const existing = counts.get(loss.crop);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(loss.crop, { name: loss.name, icon: loss.icon, count: 1 });
    }
  }
  return Array.from(counts.values());
});

/** 总损失专注分钟数 */
const totalMinutes = computed(() => props.result?.totalMinutes ?? 0);
</script>

<template>
  <Modal
    :visible="visible"
    title="🌱 专注模式已中断"
    :close-on-background="false"
    width="380px"
    @update:visible="close"
  >
    <div class="punishment-content">
      <div class="punishment-icon">🥀</div>
      <p class="punishment-title">专注模式中断，菜园子受到损失</p>

      <template v-if="hasLoss">
        <p class="punishment-losses-title">你的损失：</p>
        <ul v-if="!overLimit" class="punishment-loss-list">
          <li
            v-for="(loss, i) in displayLosses"
            :key="i"
            class="punishment-loss-item"
          >
            <span class="loss-icon">{{ loss.icon }}</span>
            <div class="loss-info">
              <div class="loss-name">{{ loss.name }}</div>
              <div class="loss-time">已生长 {{ loss.progress }}/{{ loss.growTime }} 分钟</div>
            </div>
          </li>
        </ul>
        <div v-else class="punishment-loss-summary">
          <span
            v-for="(group, i) in summaryGroups"
            :key="i"
            class="punishment-summary-item"
          >
            <span class="summary-icon">{{ group.icon }}</span>
            <span class="summary-count">×{{ group.count }}</span>
          </span>
        </div>
        <p v-if="overLimit" class="punishment-summary-text">
          共 {{ result?.losses?.length ?? 0 }} 株作物枯萎
        </p>

        <div class="punishment-total">
          <span class="total-label">共计损失</span>
          <span class="total-value">{{ totalMinutes }} 分钟心血</span>
        </div>
      </template>
      <p v-else class="punishment-no-loss">幸好没有正在生长的作物</p>
    </div>

    <template #footer>
      <button class="btn btn-primary" @click="close">知道了</button>
    </template>
  </Modal>
</template>

<style scoped>
.punishment-content {
  text-align: center;
  padding: 8px 0;
}

.punishment-icon {
  font-size: 40px;
  margin-bottom: 10px;
}

.punishment-title {
  font-size: 15px;
  margin: 0 0 12px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.9);
}

.punishment-losses-title {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  text-align: left;
  margin: 0 0 8px;
}

.punishment-loss-list {
  list-style: none;
  padding: 0;
  margin: 0 0 12px;
}

.punishment-loss-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  margin-bottom: 6px;
  text-align: left;
}

.loss-icon {
  font-size: 22px;
}

.loss-info {
  flex: 1;
}

.loss-name {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
}

.loss-time {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  margin-top: 2px;
}

.punishment-loss-summary {
  display: flex;
  justify-content: center;
  gap: 14px;
  margin-bottom: 8px;
}

.punishment-summary-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 8px;
}

.summary-icon {
  font-size: 18px;
}

.summary-count {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
}

.punishment-summary-text {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  margin: 0 0 10px;
}

.punishment-total {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  background: rgba(233, 69, 96, 0.12);
  border: 1px solid rgba(233, 69, 96, 0.3);
  border-radius: 8px;
}

.total-label {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.75);
}

.total-value {
  font-size: 15px;
  font-weight: 700;
  color: #ff8a8a;
}

.punishment-no-loss {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.7);
  margin: 8px 0;
}

.btn {
  padding: 9px 16px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: opacity 0.2s ease;
}

.btn-primary {
  background: var(--accent, #e94560);
  color: #fff;
}

.btn-primary:hover {
  opacity: 0.9;
}
</style>
