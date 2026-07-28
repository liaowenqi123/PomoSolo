<script setup lang="ts">
/**
 * 音乐榜单组件
 * 迁移自 electron/src/scripts/modules/charts.js
 *
 * 弹窗形式，展示网易云/QQ 音乐热歌榜，支持下载（通过 Rust 后端调用 Python 子进程）。
 */
import { ref, computed, watch } from "vue";
import { chartsFetch, downloadSong, type ChartSource, type ChartSong } from "@/api/charts";

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
}>();

const currentSource = ref<ChartSource>("netease");
const isLoading = ref(false);
const songs = ref<ChartSong[]>([]);
const errorMsg = ref<string | null>(null);
const downloadMode = ref(false);
const downloadingSongs = ref<Set<string>>(new Set());
const toast = ref<{ message: string; type: "success" | "error" | "info" } | null>(null);

const sourceLabel = computed(() => (currentSource.value === "netease" ? "网易云" : "QQ音乐"));

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string, type: "success" | "error" | "info" = "info") {
  toast.value = { message, type };
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = null;
  }, 3000);
}

async function fetchCharts() {
  if (isLoading.value) return;
  isLoading.value = true;
  errorMsg.value = null;
  try {
    const result = await chartsFetch(currentSource.value);
    if (result.success && result.songs && result.songs.length > 0) {
      songs.value = result.songs;
    } else {
      songs.value = [];
      errorMsg.value = result.error || "获取榜单失败";
    }
  } catch (e) {
    console.error("[Charts] 获取榜单失败:", e);
    errorMsg.value = "网络请求失败，请检查网络连接";
    songs.value = [];
  } finally {
    isLoading.value = false;
  }
}

function toggleSource() {
  currentSource.value = currentSource.value === "netease" ? "qq" : "netease";
  void fetchCharts();
}

async function handleDownload(title: string, artist: string) {
  const songKey = `${title} - ${artist}`;
  if (downloadingSongs.value.has(songKey)) return;

  downloadingSongs.value.add(songKey);
  try {
    const result = await downloadSong(title, artist);
    if (result.success) {
      if (result.status === "exists") {
        showToast(`ℹ️ "${title}" 已存在，无需下载`, "info");
      } else {
        showToast(`✅ "${title}" 下载成功`, "success");
      }
    } else {
      if (result.status === "no_video") {
        showToast(`❌ "${title}" 未找到相关视频`, "error");
      } else if (result.status === "no_instrumental") {
        showToast(`❌ "${title}" 未找到纯音乐版本`, "error");
      } else {
        showToast(`❌ ${result.error || "下载失败"}`, "error");
      }
    }
  } catch (e) {
    console.error("[Charts] 下载失败:", e);
    showToast(`❌ 下载失败`, "error");
  } finally {
    downloadingSongs.value.delete(songKey);
  }
}

function handleToggleDownloadMode() {
  if (!downloadMode.value) {
    // 开启前提示免责声明（这里简化为直接确认）
    const confirmed = window.confirm(
      "下载的音乐仅供个人学习使用，请遵守相关版权法律。是否继续开启下载模式？",
    );
    if (!confirmed) return;
  }
  downloadMode.value = !downloadMode.value;
}

function medalClass(rank: number): string {
  if (rank === 1) return "medal-gold";
  if (rank === 2) return "medal-silver";
  if (rank === 3) return "medal-bronze";
  return "";
}

function handleBackdropClick(e: MouseEvent) {
  if (e.target === e.currentTarget) {
    emit("close");
  }
}

// 弹窗打开时自动拉取
watch(
  () => props.visible,
  (v) => {
    if (v && songs.value.length === 0) {
      void fetchCharts();
    }
  },
);
</script>

<template>
  <div v-if="props.visible" class="charts-modal" @click="handleBackdropClick">
    <div class="charts-modal__panel">
      <div class="charts-modal__header">
        <h3 class="charts-modal__title">🎵 音乐榜单</h3>
        <button class="charts-modal__close" @click="emit('close')">✕</button>
      </div>

      <div class="charts-toolbar">
        <div class="charts-source">
          <button
            class="charts-source__btn"
            :class="{ active: currentSource === 'netease' }"
            @click="currentSource !== 'netease' && toggleSource()"
          >
            网易云
          </button>
          <button
            class="charts-source__btn"
            :class="{ active: currentSource === 'qq' }"
            @click="currentSource !== 'qq' && toggleSource()"
          >
            QQ音乐
          </button>
        </div>

        <button
          class="charts-refresh-btn"
          :disabled="isLoading"
          @click="fetchCharts"
        >
          {{ isLoading ? "加载中..." : "🔄 刷新" }}
        </button>

        <label class="charts-download-toggle">
          <input
            type="checkbox"
            :checked="downloadMode"
            @change="handleToggleDownloadMode"
          />
          <span>下载模式</span>
        </label>
      </div>

      <div class="charts-table-container">
        <div v-if="isLoading" class="charts-loading">加载中...</div>
        <div v-else-if="errorMsg" class="charts-error">{{ errorMsg }}</div>
        <table v-else class="charts-table">
          <thead>
            <tr>
              <th class="charts-th-rank">#</th>
              <th class="charts-th-title">歌曲</th>
              <th class="charts-th-artist">歌手</th>
              <th class="charts-th-album">专辑</th>
              <th v-if="downloadMode" class="charts-th-download">下载</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="songs.length === 0">
              <td :colspan="downloadMode ? 5 : 4" class="charts-empty">暂无数据</td>
            </tr>
            <tr v-for="song in songs" :key="song.rank">
              <td class="charts-td-rank">
                <span class="charts-rank-value" :class="medalClass(song.rank)">{{ song.rank }}</span>
              </td>
              <td class="charts-td-title" :title="song.title">{{ song.title }}</td>
              <td class="charts-td-artist" :title="song.artist">{{ song.artist }}</td>
              <td class="charts-td-album" :title="song.album">{{ song.album }}</td>
              <td v-if="downloadMode" class="charts-td-download">
                <button
                  class="charts-download-btn"
                  :class="{ downloading: downloadingSongs.has(`${song.title} - ${song.artist}`) }"
                  :disabled="downloadingSongs.has(`${song.title} - ${song.artist}`)"
                  @click="handleDownload(song.title, song.artist)"
                >
                  {{ downloadingSongs.has(`${song.title} - ${song.artist}`) ? "⏳" : "⬇" }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 提示 toast -->
      <div v-if="toast" class="charts-toast" :class="toast.type">
        {{ toast.message }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.charts-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.charts-modal__panel {
  width: 640px;
  max-width: 90vw;
  max-height: 80vh;
  background: #1f2233;
  border-radius: 14px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  position: relative;
}

.charts-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.charts-modal__title {
  margin: 0;
  font-size: 18px;
  color: #fff;
}

.charts-modal__close {
  background: none;
  border: none;
  color: #aaa;
  font-size: 18px;
  cursor: pointer;
}

.charts-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.charts-source {
  display: flex;
  gap: 4px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 2px;
}

.charts-source__btn {
  padding: 4px 12px;
  border: none;
  background: none;
  color: #888;
  cursor: pointer;
  font-size: 12px;
  border-radius: 6px;
}

.charts-source__btn.active {
  background: #e94560;
  color: #fff;
}

.charts-refresh-btn {
  padding: 4px 12px;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  color: #ddd;
  cursor: pointer;
  font-size: 12px;
}

.charts-refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.charts-download-toggle {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #aaa;
  cursor: pointer;
}

.charts-table-container {
  flex: 1;
  overflow-y: auto;
  padding: 0 18px 14px;
}

.charts-loading,
.charts-error {
  text-align: center;
  padding: 40px;
  color: rgba(255, 255, 255, 0.5);
}

.charts-error {
  color: rgba(255, 100, 100, 0.8);
}

.charts-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.charts-table th {
  text-align: left;
  padding: 8px 6px;
  color: #888;
  font-weight: 600;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  position: sticky;
  top: 0;
  background: #1f2233;
}

.charts-table td {
  padding: 8px 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  color: #ddd;
  max-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.charts-empty {
  text-align: center;
  color: rgba(255, 255, 255, 0.4);
  padding: 24px;
}

.charts-rank-value {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-weight: 700;
  font-size: 12px;
}

.charts-rank-value.medal-gold {
  background: rgba(255, 215, 0, 0.2);
  color: #ffd700;
}

.charts-rank-value.medal-silver {
  background: rgba(192, 192, 192, 0.2);
  color: #c0c0c0;
}

.charts-rank-value.medal-bronze {
  background: rgba(205, 127, 50, 0.2);
  color: #cd7f32;
}

.charts-download-btn {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  color: #ddd;
  cursor: pointer;
  padding: 2px 8px;
  font-size: 14px;
}

.charts-download-btn.downloading {
  opacity: 0.6;
  cursor: not-allowed;
}

.charts-toast {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 12px;
  color: #fff;
  z-index: 10;
}

.charts-toast.success {
  background: rgba(76, 175, 80, 0.9);
}

.charts-toast.error {
  background: rgba(244, 67, 54, 0.9);
}

.charts-toast.info {
  background: rgba(33, 150, 243, 0.9);
}
</style>
