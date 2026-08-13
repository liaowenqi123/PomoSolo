<script setup lang="ts">
/**
 * 下载队列弹窗组件
 *
 * 替代原来「单首下载 → 一直 loading」的弹窗：
 * - 输入歌曲名/歌手，点「加入队列」即可，可连续添加多首；
 * - 队列串行下载，每首显示状态 + 虚假进度条（随时间缓慢前进）；
 * - 关闭弹窗后下载仍在后台继续（队列由全局 store 持有）。
 *
 * 样式参照 Modal.vue，使用全局 .app-modal-overlay 类。
 */
import { ref, watch, nextTick } from "vue";
import { useDownloadQueue, type DownloadTask } from "@/stores/downloadQueue";

const props = defineProps<{
  visible: boolean;
  /** 打开弹窗时预填的歌曲名 */
  initialTitle?: string;
  /** 打开弹窗时预填的歌手名 */
  initialArtist?: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const queue = useDownloadQueue();

const title = ref("");
const artist = ref("");
const justEnqueued = ref(false);
const titleInput = ref<HTMLInputElement | null>(null);

let justEnqueuedTimer: ReturnType<typeof setTimeout> | null = null;

// 弹窗打开时重置状态并预填
watch(
  () => props.visible,
  async (v) => {
    if (v) {
      title.value = props.initialTitle ?? "";
      artist.value = props.initialArtist ?? "";
      justEnqueued.value = false;
      await nextTick();
      titleInput.value?.focus();
    }
  },
);

function statusText(task: DownloadTask): string {
  switch (task.status) {
    case "queued":
      return "排队中";
    case "downloading":
      return "下载中";
    case "downloaded":
      return "✅ 完成";
    case "exists":
      return "已存在";
    case "no_video":
      return "未找到";
    case "no_instrumental":
      return "无纯音乐";
    case "failed":
      return "❌ 失败";
    default:
      return "";
  }
}

function statusClass(task: DownloadTask): string {
  switch (task.status) {
    case "queued":
      return "queued";
    case "downloading":
      return "downloading";
    case "downloaded":
    case "exists":
      return "success";
    default:
      return "error";
  }
}

function handleAdd() {
  const trimmedTitle = title.value.trim();
  if (!trimmedTitle) {
    justEnqueued.value = false;
    return;
  }
  const id = queue.enqueue(trimmedTitle, artist.value.trim());
  if (id !== null) {
    title.value = "";
    justEnqueued.value = true;
    if (justEnqueuedTimer) clearTimeout(justEnqueuedTimer);
    justEnqueuedTimer = setTimeout(() => {
      justEnqueued.value = false;
    }, 2000);
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    emit("close");
  }
}

function handleBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    emit("close");
  }
}
</script>

<template>
  <div
    v-if="visible"
    class="app-modal-overlay download-dialog-overlay"
    @click="handleBackdropClick"
    @keydown="handleKeydown"
  >
    <div class="download-dialog" role="dialog" aria-modal="true">
      <div class="download-dialog__header">
        <h3 class="download-dialog__title">📥 下载队列</h3>
        <button
          class="download-dialog__close"
          type="button"
          aria-label="关闭"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>

      <div class="download-dialog__body">
        <div class="download-dialog__fields">
          <label class="download-dialog__field">
            <span class="download-dialog__label">歌曲名称 <em>*</em></span>
            <input
              ref="titleInput"
              v-model="title"
              type="text"
              class="download-dialog__input"
              placeholder="请输入歌曲名称"
              @keydown.enter="handleAdd"
            />
          </label>

          <label class="download-dialog__field">
            <span class="download-dialog__label">歌手（可选）</span>
            <input
              v-model="artist"
              type="text"
              class="download-dialog__input"
              placeholder="请输入歌手名"
              @keydown.enter="handleAdd"
            />
          </label>
        </div>

        <div v-if="justEnqueued" class="download-dialog__hint download-dialog__hint--ok">
          ✅ 已加入下载队列
        </div>

        <div class="download-dialog__queue">
          <div v-if="queue.tasks.length === 0" class="download-dialog__queue-empty">
            暂无下载任务，输入歌曲名后点击「加入队列」
          </div>
          <div
            v-for="task in queue.tasks"
            :key="task.id"
            class="download-queue__item"
          >
            <div class="download-queue__meta">
              <span class="download-queue__title" :title="task.title">{{ task.title }}</span>
              <span class="download-queue__status" :class="statusClass(task)">
                {{ statusText(task) }}
              </span>
            </div>
            <div class="download-queue__bar">
              <div
                class="download-queue__bar-fill"
                :class="{ error: task.status === 'failed' || task.status === 'no_video' || task.status === 'no_instrumental' }"
                :style="{ width: task.progress + '%' }"
              />
            </div>
            <div v-if="task.error" class="download-queue__error">{{ task.error }}</div>
          </div>
        </div>
      </div>

      <div class="download-dialog__footer">
        <button
          v-if="queue.tasks.length > 0"
          class="download-dialog__btn download-dialog__btn--ghost"
          type="button"
          @click="queue.clearFinished()"
        >
          清除已完成
        </button>
        <button
          class="download-dialog__btn download-dialog__btn--cancel"
          type="button"
          @click="emit('close')"
        >
          关闭
        </button>
        <button
          class="download-dialog__btn download-dialog__btn--download"
          type="button"
          :disabled="!title.trim()"
          @click="handleAdd"
        >
          ➕ 加入队列
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.download-dialog-overlay {
  z-index: var(--z-modal-upper); /* 高于 Charts 弹窗 */
}

.download-dialog {
  background: #1a1a1a;
  color: #fff;
  border-radius: 14px;
  padding: 18px 20px;
  width: 100%;
  max-width: 460px;
  max-height: 80vh;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5), 0 8px 24px rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
}

.download-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.download-dialog__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
}

.download-dialog__close {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.6);
  font-size: 14px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: color 0.2s, background 0.2s;
}

.download-dialog__close:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

.download-dialog__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

.download-dialog__fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.download-dialog__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.download-dialog__label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
}

.download-dialog__label em {
  color: #e94560;
  font-style: normal;
  margin-left: 2px;
}

.download-dialog__input {
  width: 100%;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: #fff;
  font-size: 13px;
  box-sizing: border-box;
  transition: border-color 0.2s, background 0.2s;
}

.download-dialog__input::placeholder {
  color: rgba(255, 255, 255, 0.35);
}

.download-dialog__input:focus {
  outline: none;
  border-color: #e94560;
  background: rgba(255, 255, 255, 0.08);
}

.download-dialog__hint {
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 6px;
}

.download-dialog__hint--ok {
  color: rgba(130, 220, 130, 1);
  background: rgba(76, 175, 80, 0.12);
}

.download-dialog__queue {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.download-dialog__queue-empty {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  text-align: center;
  padding: 12px 4px;
}

.download-queue__item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
}

.download-queue__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.download-queue__title {
  flex: 1;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.download-queue__status {
  font-size: 11px;
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 10px;
}

.download-queue__status.queued {
  color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.08);
}

.download-queue__status.downloading {
  color: #90caf9;
  background: rgba(33, 150, 243, 0.15);
}

.download-queue__status.success {
  color: #82dc82;
  background: rgba(76, 175, 80, 0.15);
}

.download-queue__status.error {
  color: #ff8282;
  background: rgba(244, 67, 54, 0.15);
}

.download-queue__bar {
  height: 6px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  overflow: hidden;
}

.download-queue__bar-fill {
  height: 100%;
  background: #2196f3;
  border-radius: 3px;
  transition: width 0.6s linear;
}

.download-queue__bar-fill.error {
  background: #f44336;
}

.download-queue__error {
  font-size: 11px;
  color: rgba(255, 130, 130, 0.9);
}

.download-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.download-dialog__btn {
  padding: 7px 16px;
  border: none;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s, opacity 0.2s;
}

.download-dialog__btn--ghost {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
}

.download-dialog__btn--ghost:hover {
  background: rgba(255, 255, 255, 0.14);
}

.download-dialog__btn--cancel {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
}

.download-dialog__btn--cancel:hover {
  background: rgba(255, 255, 255, 0.15);
}

.download-dialog__btn--download {
  background: #e94560;
  color: #fff;
}

.download-dialog__btn--download:hover:not(:disabled) {
  background: #d63851;
}

.download-dialog__btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
