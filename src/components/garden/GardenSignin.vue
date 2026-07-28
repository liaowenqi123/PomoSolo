<script setup lang="ts">
/**
 * 菜园子 - 签到组件
 * 迁移自 electron/src/scripts/modules/gardenSignin.js
 *
 * 显示连续签到天数、本周签到记录、今日奖励，执行签到操作。
 */
import { computed } from "vue";
import {
  useGardenStore,
  CROP_CONFIG,
  DAILY_REWARD,
  WEEKLY_REWARDS,
  CONTINUOUS_REWARDS,
} from "@/stores/garden";

const store = useGardenStore();

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const signInData = computed(() => store.data.signIn);
const continuousDays = computed(() => signInData.value?.continuousDays ?? 0);
const totalDays = computed(() => signInData.value?.totalDays ?? 0);
const weekRecords = computed(() => signInData.value?.weekRecords ?? [false, false, false, false, false, false, false]);

const today = new Date().getDay();

const weekLabels = ["日", "一", "二", "三", "四", "五", "六"];

/** 重新排序：一~日 */
const weekDots = computed(() => {
  const result: { label: string; signed: boolean; isToday: boolean }[] = [];
  // 周一到周日：index 1,2,3,4,5,6,0
  const order = [1, 2, 3, 4, 5, 6, 0];
  for (const idx of order) {
    result.push({
      label: weekLabels[idx],
      signed: weekRecords.value[idx] ?? false,
      isToday: idx === today,
    });
  }
  return result;
});

const canSign = computed(() => store.canSignInToday);

/** 今日奖励列表 */
const todayRewards = computed(() => {
  const rewards: { icon: string; text: string; extra?: boolean }[] = [];

  // 每日基础奖励
  for (const [seedKey, count] of Object.entries(DAILY_REWARD.seeds)) {
    const crop = CROP_CONFIG[seedKey];
    if (crop) {
      rewards.push({ icon: crop.icon, text: `${crop.name}种子 x${count}` });
    }
  }
  rewards.push({ icon: "💰", text: `金币 x${DAILY_REWARD.coins}` });

  // 每周特殊奖励
  const weeklyReward = WEEKLY_REWARDS[today];
  if (weeklyReward) {
    if (weeklyReward.randomSeed) {
      rewards.push({ icon: "🎁", text: "随机种子礼包 x1", extra: true });
    } else {
      for (const [seedKey, count] of Object.entries(weeklyReward.seeds)) {
        if (count > 0) {
          const crop = CROP_CONFIG[seedKey];
          if (crop) {
            rewards.push({ icon: crop.icon, text: `${crop.name}种子 x${count}`, extra: true });
          }
        }
      }
      if (weeklyReward.coins > 0) {
        rewards.push({ icon: "💰", text: `金币 x${weeklyReward.coins}`, extra: true });
      }
    }
  }

  // 连续签到里程碑奖励
  const nextMilestone = store.getNextMilestone();
  if (nextMilestone && CONTINUOUS_REWARDS[nextMilestone]) {
    const reward = CONTINUOUS_REWARDS[nextMilestone];
    const seedKey = Object.keys(reward.seeds)[0];
    if (seedKey) {
      const crop = CROP_CONFIG[seedKey];
      if (crop) {
        rewards.push({
          icon: crop.icon,
          text: `连续${nextMilestone}天: ${crop.name}种子 x${reward.seeds[seedKey]}`,
          extra: true,
        });
      }
    }
  }

  return rewards;
});

async function handleSignIn() {
  await store.signIn();
}

function handleBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    emit("close");
  }
}
</script>

<template>
  <div v-if="props.visible" class="signin-modal" @click="handleBackdropClick">
    <div class="signin-modal__panel">
      <div class="signin-modal__header">
        <h3 class="signin-modal__title">📅 每日签到</h3>
        <button class="signin-modal__close" @click="emit('close')">✕</button>
      </div>

      <div class="signin-stats">
        <div class="signin-stat">
          <span class="signin-stat__value">{{ continuousDays }}</span>
          <span class="signin-stat__label">连续签到</span>
        </div>
        <div class="signin-stat">
          <span class="signin-stat__value">{{ totalDays }}</span>
          <span class="signin-stat__label">累计签到</span>
        </div>
      </div>

      <div class="signin-week">
        <div
          v-for="(dot, idx) in weekDots"
          :key="idx"
          class="signin-dot"
          :class="{ signed: dot.signed, today: dot.isToday }"
        >
          <span class="signin-dot__label">{{ dot.label }}</span>
          <span class="signin-dot__mark">{{ dot.signed ? "✓" : "·" }}</span>
        </div>
      </div>

      <div class="signin-rewards">
        <h4 class="signin-rewards__title">今日奖励</h4>
        <div
          v-for="(reward, idx) in todayRewards"
          :key="idx"
          class="signin-reward-item"
          :class="{ extra: reward.extra }"
        >
          <span class="signin-reward-item__icon">{{ reward.icon }}</span>
          <span class="signin-reward-item__text">{{ reward.text }}</span>
        </div>
      </div>

      <button
        class="signin-confirm-btn"
        :disabled="!canSign"
        @click="handleSignIn"
      >
        {{ canSign ? "✅ 立即签到" : "今日已签到" }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.signin-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.signin-modal__panel {
  width: 360px;
  max-width: 90vw;
  background: #1f2233;
  border-radius: 14px;
  padding: 20px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
}

.signin-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.signin-modal__title {
  margin: 0;
  font-size: 18px;
  color: #fff;
}

.signin-modal__close {
  background: none;
  border: none;
  color: #aaa;
  font-size: 18px;
  cursor: pointer;
}

.signin-stats {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.signin-stat {
  flex: 1;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10px;
  padding: 12px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.signin-stat__value {
  font-size: 24px;
  font-weight: 700;
  color: #ffd54f;
}

.signin-stat__label {
  font-size: 11px;
  color: #aaa;
}

.signin-week {
  display: flex;
  justify-content: space-between;
  margin-bottom: 18px;
  gap: 4px;
}

.signin-dot {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 2px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
}

.signin-dot.signed {
  background: rgba(76, 175, 80, 0.2);
}

.signin-dot.today {
  border: 1px solid #ffd54f;
}

.signin-dot__label {
  font-size: 11px;
  color: #aaa;
}

.signin-dot__mark {
  font-size: 14px;
  color: #888;
}

.signin-dot.signed .signin-dot__mark {
  color: #4caf50;
  font-weight: 700;
}

.signin-rewards {
  margin-bottom: 18px;
}

.signin-rewards__title {
  margin: 0 0 8px;
  font-size: 13px;
  color: #ddd;
}

.signin-reward-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  margin-bottom: 4px;
  font-size: 13px;
  color: #eee;
}

.signin-reward-item.extra {
  background: rgba(255, 213, 79, 0.1);
}

.signin-reward-item__icon {
  font-size: 16px;
}

.signin-confirm-btn {
  width: 100%;
  padding: 10px;
  border: none;
  border-radius: 10px;
  background: #e94560;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.signin-confirm-btn:disabled {
  background: #555;
  cursor: not-allowed;
  opacity: 0.6;
}
</style>
