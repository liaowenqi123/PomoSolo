<script setup lang="ts">
/**
 * AI 规划助手组件
 * 迁移自 electron/src/scripts/modules/aiHelper.js
 *
 * 输入工作/学习需求，调用后端（DeepSeek）生成番茄钟计划，可应用到计划模式。
 */
import { ref, computed } from "vue";
import { aiGeneratePlan, type AiPlanData, type AiPlanItem } from "@/api/ai";

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  /** 应用计划（将计划项传递给父组件处理） */
  (e: "apply", plan: AiPlanItem[]): void;
}>();

const inputValue = ref("");
const isProcessing = ref(false);
const result = ref<AiPlanData | null>(null);
const errorMsg = ref<string | null>(null);

const totalTime = computed(() => {
  if (!result.value?.plan) return 0;
  return result.value.plan.reduce((sum, item) => sum + item.minutes, 0);
});

const totalTimeText = computed(() => {
  const total = totalTime.value;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return hours > 0 ? `${hours}小时${minutes}分钟` : `${minutes}分钟`;
});

async function handleGenerate() {
  const input = inputValue.value.trim();
  if (!input) {
    errorMsg.value = "请输入您的工作或学习需求";
    return;
  }
  if (isProcessing.value) return;

  isProcessing.value = true;
  errorMsg.value = null;
  result.value = null;

  try {
    const res = await aiGeneratePlan(input);
    if (res.success && res.data) {
      result.value = res.data;
    } else {
      errorMsg.value = res.error || "生成计划失败，请重试";
    }
  } catch (e) {
    console.error("[AIHelper] 生成计划失败:", e);
    errorMsg.value = "网络错误，请检查连接后重试";
  } finally {
    isProcessing.value = false;
  }
}

function handleApply() {
  if (result.value?.plan) {
    emit("apply", result.value.plan);
    emit("close");
  }
}

function handleBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget && !isProcessing.value) {
    emit("close");
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void handleGenerate();
  }
}
</script>

<template>
  <Transition name="modal">
    <div v-if="props.visible" class="ai-modal" @click="handleBackdropClick">
      <div class="ai-modal__panel">
      <div class="ai-modal__header">
        <h3 class="ai-modal__title">🤖 AI 规划助手</h3>
        <button class="ai-modal__close" :disabled="isProcessing" @click="emit('close')">✕</button>
      </div>

      <div class="ai-input-area">
        <textarea
          v-model="inputValue"
          class="ai-input"
          placeholder="请输入您的工作或学习需求，例如：我需要复习高数，准备明天的考试"
          rows="3"
          :disabled="isProcessing"
          @keydown="handleKeydown"
        ></textarea>
        <button
          class="ai-generate-btn"
          :disabled="isProcessing || !inputValue.trim()"
          @click="handleGenerate"
        >
          {{ isProcessing ? "生成中..." : "✨ 生成计划" }}
        </button>
      </div>

      <div class="ai-result-area">
        <!-- 加载中 -->
        <div v-if="isProcessing" class="ai-loading">🤖 AI正在为您规划...</div>

        <!-- 错误 -->
        <div v-else-if="errorMsg" class="ai-error">❌ {{ errorMsg }}</div>

        <!-- 结果 -->
        <div v-else-if="result" class="ai-plan-result">
          <div v-if="result.summary" class="ai-summary">📋 {{ result.summary }}</div>

          <div v-if="result.plan && result.plan.length > 0" class="ai-plan-list">
            <div
              v-for="(item, idx) in result.plan"
              :key="idx"
              class="ai-plan-item"
              :class="item.type"
            >
              <span class="ai-plan-number">{{ idx + 1 }}</span>
              <span class="ai-plan-icon">{{ item.type === "work" ? "💼" : "☕" }}</span>
              <span class="ai-plan-type">{{ item.type === "work" ? "工作" : "休息" }}</span>
              <span class="ai-plan-time">{{ item.minutes }}分钟</span>
              <span v-if="item.description" class="ai-plan-desc">{{ item.description }}</span>
            </div>
          </div>

          <div v-if="result.plan && result.plan.length > 0" class="ai-total-time">
            ⏱️ 总计: {{ totalTimeText }}
          </div>

          <button
            v-if="result.plan && result.plan.length > 0"
            class="ai-apply-btn"
            @click="handleApply"
          >
            ✅ 应用到番茄钟
          </button>
        </div>

        <!-- 空状态 -->
        <div v-else class="ai-placeholder">
          输入您的需求，AI 将为您生成专属的番茄钟计划
        </div>
      </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.ai-modal {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.ai-modal__panel {
  width: 480px;
  max-width: 90vw;
  max-height: 80vh;
  background: #1a1a1a;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
}

.ai-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.ai-modal__title {
  margin: 0;
  font-size: 18px;
  color: #fff;
}

.ai-modal__close {
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.6);
  font-size: 18px;
  cursor: pointer;
}

.ai-modal__close:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ai-input-area {
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 120px;
}

.ai-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 10px 12px;
  color: #fff;
  font-size: 14px;
  font-family: inherit;
  resize: none;
  outline: none;
  box-sizing: border-box;
  min-height: 60px;
}

.ai-input:focus {
  border-color: #e94560;
}

.ai-input::placeholder {
  color: rgba(255, 255, 255, 0.5);
}

.ai-generate-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  background: #e94560;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.ai-generate-btn:disabled {
  background: #555;
  cursor: not-allowed;
  opacity: 0.6;
}

.ai-result-area {
  flex: 1;
  overflow-y: auto;
  padding: 0 18px 14px;
  min-height: 120px;
}

.ai-loading,
.ai-error,
.ai-placeholder {
  text-align: center;
  padding: 30px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
}

.ai-error {
  color: rgba(255, 100, 100, 0.8);
}

.ai-plan-result {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ai-summary {
  padding: 10px;
  background: rgba(233, 69, 96, 0.1);
  border-radius: 8px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
}

.ai-plan-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ai-plan-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  font-size: 12px;
  border-left: 3px solid transparent;
}

.ai-plan-item.work {
  border-left-color: #e94560;
}

.ai-plan-item.break {
  border-left-color: #4ecca3;
}

.ai-plan-number {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
  flex-shrink: 0;
}

.ai-plan-icon {
  font-size: 14px;
}

.ai-plan-type {
  color: rgba(255, 255, 255, 0.9);
  font-weight: 600;
  min-width: 32px;
}

.ai-plan-time {
  color: #ffd54f;
  font-weight: 600;
  min-width: 50px;
}

.ai-plan-desc {
  color: rgba(255, 255, 255, 0.6);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ai-total-time {
  text-align: center;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.6);
  padding: 6px;
}

.ai-apply-btn {
  padding: 10px;
  border: none;
  border-radius: 8px;
  background: #4caf50;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.ai-apply-btn:hover {
  opacity: 0.9;
}

/* Scrollbar */
::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.4);
}

/* Transition：遮罩层 opacity 0→1，内容 scale 0.92→1 */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.25s ease;
}

.modal-enter-active .ai-modal__panel,
.modal-leave-active .ai-modal__panel {
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .ai-modal__panel,
.modal-leave-to .ai-modal__panel {
  transform: scale(0.92);
}
</style>
