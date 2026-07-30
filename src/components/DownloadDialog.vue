<script setup lang="ts">
/**
 * 下载弹窗组件
 *
 * 替代原生 window.prompt / window.confirm 的自定义弹窗：
 * - 包含歌曲名称输入框（必填）和歌手输入框（可选）
 * - 包含下载按钮和取消按钮
 * - 显示下载状态（下载中、成功、已存在、失败等）
 *
 * 样式参照 Modal.vue，使用全局 .app-modal-overlay 类。
 */
import { ref, watch, nextTick } from "vue";
import { downloadSong, type DownloadStatus } from "@/api/charts";

const props = defineProps<{
  visible: boolean;
  /** 打开弹窗时预填的歌曲名 */
  initialTitle?: string;
  /** 打开弹窗时预填的歌手名 */
  initialArtist?: string;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "downloaded", payload: { title: string; artist: string; status: DownloadStatus }): void;
}>();

const title = ref("");
const artist = ref("");
const isDownloading = ref(false);
const status = ref<DownloadStatus | null>(null);
const errorMsg = ref<string | null>(null);
const titleInput = ref<HTMLInputElement | null>(null);

// 弹窗打开时重置状态并预填
watch(
  () => props.visible,
  async (v) => {
    if (v) {
      title.value = props.initialTitle ?? "";
      artist.value = props.initialArtist ?? "";
      isDownloading.value = false;
      status.value = null;
      errorMsg.value = null;
      // 自动聚焦输入框
      await nextTick();
      titleInput.value?.focus();
    }
  },
);

function statusMessage(): string {
  if (errorMsg.value) return errorMsg.value;
  switch (status.value) {
    case "downloaded":
      return `✅ "${title.value}" 下载成功`;
    case "exists":
      return `ℹ️ "${title.value}" 已存在，无需下载`;
    case "no_video":
      return `❌ "${title.value}" 未找到相关视频`;
    case "no_instrumental":
      return `❌ "${title.value}" 未找到纯音乐版本`;
    case "failed":
      return `❌ 下载失败`;
    default:
      return "";
  }
}

function statusClass(): string {
  if (status.value === "downloaded" || status.value === "exists") return "success";
  if (status.value === null) return "";
  return "error";
}

async function handleDownload() {
  const trimmedTitle = title.value.trim();
  if (!trimmedTitle) {
    errorMsg.value = "请输入歌曲名称";
    status.value = null;
    return;
  }
  if (isDownloading.value) return;

  isDownloading.value = true;
  status.value = null;
  errorMsg.value = null;

  try {
    const result = await downloadSong(trimmedTitle, artist.value.trim());
    if (result.success) {
      // Rust 返回 "downloaded"（退出码 0）或 "exists"（退出码 2）
      status.value = (result.status as DownloadStatus) ?? "downloaded";
    } else {
      status.value = (result.status as DownloadStatus) ?? "failed";
      errorMsg.value = result.error ?? null;
    }
    emit("downloaded", {
      title: trimmedTitle,
      artist: artist.value.trim(),
      status: status.value,
    });
  } catch (e) {
    console.error("[DownloadDialog] 下载失败:", e);
    status.value = "failed";
    errorMsg.value = "下载请求失败";
  } finally {
    isDownloading.value = false;
  }
}

function handleClose() {
  if (isDownloading.value) return; // 下载中不允许关闭
  emit("close");
}

function handleBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    handleClose();
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && !isDownloading.value) {
    handleClose();
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
        <h3 class="download-dialog__title">📥 下载歌曲</h3>
        <button
          class="download-dialog__close"
          type="button"
          aria-label="关闭"
          :disabled="isDownloading"
          @click="handleClose"
        >
          ✕
        </button>
      </div>

      <div class="download-dialog__body">
        <label class="download-dialog__field">
          <span class="download-dialog__label">歌曲名称 <em>*</em></span>
          <input
            ref="titleInput"
            v-model="title"
            type="text"
            class="download-dialog__input"
            placeholder="请输入歌曲名称"
            :disabled="isDownloading"
            @keydown.enter="handleDownload"
          />
        </label>

        <label class="download-dialog__field">
          <span class="download-dialog__label">歌手（可选）</span>
          <input
            v-model="artist"
            type="text"
            class="download-dialog__input"
            placeholder="请输入歌手名"
            :disabled="isDownloading"
            @keydown.enter="handleDownload"
          />
        </label>

        <div v-if="errorMsg && !status" class="download-dialog__hint">{{ errorMsg }}</div>

        <div v-if="status" class="download-dialog__status" :class="statusClass()">
          {{ statusMessage() }}
        </div>

        <div v-if="isDownloading" class="download-dialog__progress">
          <span class="download-dialog__spinner" />
          正在下载「{{ title }}」...
        </div>
      </div>

      <div class="download-dialog__footer">
        <button
          class="download-dialog__btn download-dialog__btn--cancel"
          type="button"
          :disabled="isDownloading"
          @click="handleClose"
        >
          取消
        </button>
        <button
          class="download-dialog__btn download-dialog__btn--download"
          type="button"
          :disabled="isDownloading"
          @click="handleDownload"
        >
          {{ isDownloading ? "下载中..." : "⬇ 下载" }}
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
  max-width: 420px;
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

.download-dialog__close:hover:not(:disabled) {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

.download-dialog__close:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.download-dialog__body {
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

.download-dialog__input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.download-dialog__hint {
  font-size: 12px;
  color: rgba(255, 150, 150, 0.9);
  padding: 4px 8px;
  background: rgba(244, 67, 54, 0.1);
  border-radius: 6px;
}

.download-dialog__status {
  font-size: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  line-height: 1.4;
}

.download-dialog__status.success {
  background: rgba(76, 175, 80, 0.15);
  color: rgba(130, 220, 130, 1);
}

.download-dialog__status.error {
  background: rgba(244, 67, 54, 0.15);
  color: rgba(255, 130, 130, 1);
}

.download-dialog__progress {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.8);
  padding: 8px 10px;
  background: rgba(33, 150, 243, 0.1);
  border-radius: 8px;
}

.download-dialog__spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid rgba(33, 150, 243, 0.3);
  border-top-color: #2196f3;
  border-radius: 50%;
  animation: download-spin 0.8s linear infinite;
}

@keyframes download-spin {
  to {
    transform: rotate(360deg);
  }
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

.download-dialog__btn--cancel {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
}

.download-dialog__btn--cancel:hover:not(:disabled) {
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
