<script setup lang="ts">
/**
 * 前台检测警告弹窗组件
 *
 * 参考 electron/src/scripts/modules/foregroundDetection.js。
 *
 * 功能：
 * - 监听 foreground-entertainment-detected 事件
 * - 检测到娱乐窗口时弹出警告
 * - 显示警告次数（current/max）
 * - "知道了" 按钮：增加警告次数，达到上限时触发惩罚
 * - "不是娱乐" 按钮：不增加警告次数
 *
 * 通过 v-model:visible 双向绑定，组件内部也会在事件触发时自动 visible=true。
 */
import { ref, watch, onBeforeUnmount } from "vue";
import Modal from "./Modal.vue";
import {
  onForegroundEntertainmentDetected,
  onForegroundApiKeyInvalid,
  type DetectionResult,
} from "@/api/foreground";

interface Props {
  /** 是否显示 */
  visible: boolean;
  /** 最大警告次数（达到后触发惩罚） */
  maxWarnings?: number;
}

const props = withDefaults(defineProps<Props>(), {
  maxWarnings: 3,
});

const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "dismiss"): void;
  (e: "not-entertainment", result: DetectionResult): void;
  (e: "punishment"): void;
  /** API Key 失效 */
  (e: "api-key-invalid", error: string): void;
}>();

// 当前专注周期的警告次数
const warningCount = ref(0);
// 最近一次检测结果
const lastResult = ref<DetectionResult | null>(null);
// API Key 错误弹窗（独立于主警告弹窗）
const apiKeyErrorVisible = ref(false);
const apiKeyErrorMessage = ref("");

let unlistenDetected: (() => void) | null = null;
let unlistenApiKeyInvalid: (() => void) | null = null;

async function setupListeners(): Promise<void> {
  if (unlistenDetected) return;
  try {
    const un1 = await onForegroundEntertainmentDetected((e) => {
      handleEntertainmentDetected(e.payload);
    });
    unlistenDetected = un1;
  } catch (err) {
    // Tauri 未就绪时静默
    console.warn("[ForegroundWarning] listen failed:", err);
  }

  try {
    const un2 = await onForegroundApiKeyInvalid((e) => {
      const payload = (e.payload as { error?: string }) ?? {};
      apiKeyErrorMessage.value = payload.error ?? "API Key 未配置或无效";
      apiKeyErrorVisible.value = true;
      emit("api-key-invalid", apiKeyErrorMessage.value);
    });
    unlistenApiKeyInvalid = un2;
  } catch (err) {
    console.warn("[ForegroundWarning] listen apiKeyInvalid failed:", err);
  }
}

function teardownListeners(): void {
  if (unlistenDetected) {
    unlistenDetected();
    unlistenDetected = null;
  }
  if (unlistenApiKeyInvalid) {
    unlistenApiKeyInvalid();
    unlistenApiKeyInvalid = null;
  }
}

/** 处理检测到娱乐前台的事件 */
function handleEntertainmentDetected(result: DetectionResult): void {
  // 如果弹窗已显示，不重复弹出
  if (props.visible) return;
  lastResult.value = result;
  emit("update:visible", true);
}

/** "知道了" 按钮 */
function handleDismiss(): void {
  warningCount.value += 1;
  emit("dismiss");
  emit("update:visible", false);
  if (warningCount.value >= props.maxWarnings) {
    emit("punishment");
    // 达到上限后重置计数，避免连续触发
    warningCount.value = 0;
  }
}

/** "不是娱乐" 按钮 */
function handleNotEntertainment(): void {
  if (lastResult.value) {
    emit("not-entertainment", lastResult.value);
  }
  emit("update:visible", false);
}

/** 关闭 API Key 错误弹窗 */
function closeApiKeyError(): void {
  apiKeyErrorVisible.value = false;
}

/** 重置警告次数（外部可调用，或在新专注周期开始时调用） */
function resetWarningCount(): void {
  warningCount.value = 0;
}

// 组件挂载后即开始监听（即使 visible=false）
void setupListeners();

onBeforeUnmount(() => {
  teardownListeners();
});

// 暴露重置方法给父组件
defineExpose({
  resetWarningCount,
  refreshListeners: setupListeners,
});

// 当 visible 通过外部置为 true 但没有 lastResult 时，给一个占位
watch(
  () => props.visible,
  (v) => {
    if (v && !lastResult.value) {
      lastResult.value = {
        windowTitle: "未知窗口",
        isEntertainment: true,
        source: "ai",
        keyword: "",
      };
    }
  },
);
</script>

<template>
  <!-- 主警告弹窗 -->
  <Modal
    :visible="visible"
    title="⚠️ 检测到娱乐窗口"
    :close-on-background="false"
    :show-close="false"
    width="380px"
    @update:visible="(v) => emit('update:visible', v)"
  >
    <div class="warning-content">
      <div class="warning-icon">⚠️</div>
      <p class="warning-text">
        检测到你正在使用娱乐类应用，请回到专注状态！
      </p>
      <p v-if="lastResult" class="warning-window">
        窗口：{{ lastResult.windowTitle }}
      </p>
      <p class="warning-count">
        警告次数：{{ warningCount + 1 }} / {{ maxWarnings }}
      </p>
      <p v-if="warningCount + 1 >= maxWarnings" class="warning-punishment-hint">
        再点"知道了"将触发惩罚！
      </p>
    </div>
    <template #footer>
      <button class="btn btn-secondary" @click="handleNotEntertainment">
        不是娱乐
      </button>
      <button class="btn btn-primary" @click="handleDismiss">知道了</button>
    </template>
  </Modal>

  <!-- API Key 错误弹窗 -->
  <Modal
    :visible="apiKeyErrorVisible"
    title="🔑 API Key 错误"
    :close-on-background="false"
    width="360px"
    @update:visible="(v) => (apiKeyErrorVisible = v)"
    @close="closeApiKeyError"
  >
    <p class="api-key-error-message">{{ apiKeyErrorMessage }}</p>
    <p class="api-key-error-hint">
      请前往设置配置有效的 DeepSeek API Key。
    </p>
    <template #footer>
      <button class="btn btn-primary" @click="closeApiKeyError">知道了</button>
    </template>
  </Modal>
</template>

<style scoped>
.warning-content {
  text-align: center;
  padding: 8px 0;
}

.warning-icon {
  font-size: 40px;
  margin-bottom: 12px;
}

.warning-text {
  font-size: 15px;
  margin: 0 0 12px;
  line-height: 1.5;
}

.warning-window {
  font-size: 13px;
  color: var(--text-secondary, #888);
  margin: 0 0 8px;
  word-break: break-all;
}

.warning-count {
  font-size: 13px;
  font-weight: 600;
  color: var(--accent, #e94560);
  margin: 8px 0 0;
}

.warning-punishment-hint {
  font-size: 12px;
  color: #ff6b6b;
  margin-top: 6px;
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

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--accent, #e94560);
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary, #eee);
}

.api-key-error-message {
  margin: 0 0 8px;
  font-size: 14px;
  line-height: 1.5;
}

.api-key-error-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary, #888);
}
</style>
