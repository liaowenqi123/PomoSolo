<script setup lang="ts">
/**
 * 音乐播放器组件
 * 迁移自 electron/src/scripts/modules/musicPlayer.js
 *
 * 播放/暂停/上一首/下一首、音量控制、进度条、播放列表。
 * 音乐播放通过 Rust 后端调用 Python 子进程，前端只管 UI 与状态同步。
 *
 * 事件监听通过 useTauriEvent 注册，组件卸载时自动取消监听。
 */
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useMusicStore } from "@/stores/music";
import { useSettingsStore } from "@/stores/settings";
import { useTauriEvent } from "@/api/events";
import MusicTagModal from "./MusicTagModal.vue";
import type {
  MusicReadyPayload,
  MusicStatus,
  MusicPlayStatePayload,
  MusicProgressPayload,
  MusicDevicesPayload,
  MusicVolumePayload,
  MusicPlayModePayload,
  MusicPlayErrorPayload,
  MusicSongMissingPayload,
  PlaylistData,
} from "@/api/music";

const store = useMusicStore();
const settings = useSettingsStore();

const emit = defineEmits<{
  (e: "charts"): void;
}>();

// ===== 局部 UI 状态 =====
const isPlaylistOpen = ref(false);
const isVolumeOpen = ref(false);
const isDeviceOpen = ref(false);

// ===== 进度条拖拽 =====
const progressBarRef = ref<HTMLDivElement | null>(null);
const isDraggingProgress = ref(false);
const dragProgress = ref(0); // 拖拽期间的临时进度（0-100）
const seekTarget = ref<number | null>(null); // seek 后等待后端确认的目标位置（秒）

function calcProgress(clientX: number): number {
  if (!progressBarRef.value) return 0;
  const rect = progressBarRef.value.getBoundingClientRect();
  const progress = (clientX - rect.left) / rect.width;
  return Math.max(0, Math.min(1, progress));
}

function handleProgressMouseDown(e: MouseEvent) {
  if (!progressBarRef.value || store.duration <= 0) return;
  isDraggingProgress.value = true;
  store.isDragging = true;
  dragProgress.value = calcProgress(e.clientX) * 100;
  // 拖拽期间阻止文本选中
  e.preventDefault();
}

function handleProgressMouseMove(e: MouseEvent) {
  if (!isDraggingProgress.value) return;
  dragProgress.value = calcProgress(e.clientX) * 100;
}

function handleProgressMouseUp(e: MouseEvent) {
  if (!isDraggingProgress.value) return;
  const progress = calcProgress(e.clientX);
  const newTime = Math.floor(progress * store.duration);
  isDraggingProgress.value = false;
  store.isDragging = false;
  // 设置 seekTarget，在 music-progress 确认到达前持续显示目标位置
  seekTarget.value = newTime;
  void store.seek(newTime);
}

// 点击（非拖拽）也跳转
function handleProgressClick(e: MouseEvent) {
  if (isDraggingProgress.value) return;
  if (!progressBarRef.value || store.duration <= 0) return;
  const progress = calcProgress(e.clientX);
  const newTime = Math.floor(progress * store.duration);
  seekTarget.value = newTime;
  void store.seek(newTime);
}

// 实际显示的进度（拖拽 > seek等待 > 实时）
const displayProgress = computed(() => {
  if (isDraggingProgress.value) return dragProgress.value;
  if (seekTarget.value !== null) {
    return store.duration > 0 ? (seekTarget.value / store.duration) * 100 : 0;
  }
  return store.progress;
});

// 实际显示的时间文本
const displayTimeText = computed(() => {
  if (isDraggingProgress.value) {
    const seconds = Math.floor((dragProgress.value / 100) * store.duration);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  if (seekTarget.value !== null) {
    const seconds = seekTarget.value;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return store.currentTimeText;
});

// 监听后端进度更新，到达 seekTarget 附近时清除（让进度条恢复实时跟随）
watch(
  () => store.currentTime,
  (current) => {
    if (seekTarget.value === null) return;
    // 后端进度到达目标 ±2 秒内，或者超过目标（说明已跳过），清除 seekTarget
    if (Math.abs(current - seekTarget.value) <= 2 || current >= seekTarget.value) {
      seekTarget.value = null;
    }
  },
);

// 切歌时清除 seekTarget
watch(
  () => store.trackName,
  () => {
    seekTarget.value = null;
    isDraggingProgress.value = false;
  },
);

// ===== 播放列表 =====
function togglePlaylist() {
  isPlaylistOpen.value = !isPlaylistOpen.value;
  if (isPlaylistOpen.value) {
    void store.requestPlaylist();
  }
}

function handleSongClick(songName: string) {
  if (songName !== store.trackName) {
    void store.playSong(songName);
  }
}

async function handleDeleteSong(songName: string, e: MouseEvent) {
  e.stopPropagation();
  if (songName === store.trackName) return;
  await store.deleteSong(songName);
}

// ===== 标签编辑 =====
const tagModalVisible = ref(false);
const tagEditSong = ref<string>("");
const tagEditCurrent = ref<{ name: string; color: string | null } | null>(null);

// ===== Toast 提示 =====
const toastMessage = ref("");
const toastVisible = ref(false);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string) {
  toastMessage.value = message;
  toastVisible.value = true;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastVisible.value = false;
  }, 2000);
}

// 颜色工具：hex 转 rgba
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// 颜色工具：hex 变亮
function lightenColor(hex: string, amount: number): string {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + Math.round(255 * amount));
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + Math.round(255 * amount));
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + Math.round(255 * amount));
  return `rgb(${r}, ${g}, ${b})`;
}

// 计算标签 span 的内联样式：优先用 playlistTags 的 color，其次用 customTags 的颜色
function tagStyle(songName: string): Record<string, string> {
  const tagData = store.playlistTags[songName];
  if (!tagData) return {};
  const tagName = tagData.name || "自定义";
  const tagColor = tagData.color;
  if (tagColor) {
    return {
      background: hexToRgba(tagColor, 0.3),
      color: lightenColor(tagColor, 0.3),
    };
  }
  // 自定义标签使用定义的颜色
  const customColor = store.customTags[tagName];
  if (customColor) {
    return {
      background: hexToRgba(customColor, 0.3),
      color: lightenColor(customColor, 0.3),
    };
  }
  return {};
}

// 点击标签：检查内置歌曲，弹出标签选择弹窗
function handleTagClick(songName: string, e: MouseEvent) {
  e.stopPropagation();
  const name = displayName(songName);
  if (name.endsWith(" - 番茄钟")) {
    showToast("内置歌曲标签不可更改");
    return;
  }
  tagEditSong.value = songName;
  const tagData = store.playlistTags[songName];
  tagEditCurrent.value = tagData
    ? { name: tagData.name || "自定义", color: tagData.color ?? null }
    : null;
  tagModalVisible.value = true;
}

// 选择预设/已有标签
async function onTagSelect(tag: string, color: string | null) {
  const ok = await store.updateSongTag(tagEditSong.value, tag, color);
  if (ok) {
    showToast("标签已更新");
  } else {
    showToast("更新失败");
  }
}

// 添加自定义标签
async function onTagAdd(name: string, color: string) {
  const ok = await store.addCustomTag(name, color);
  if (ok) {
    // 选中新添加的标签
    const ok2 = await store.updateSongTag(tagEditSong.value, name, color);
    if (ok2) {
      showToast("标签已添加");
    } else {
      showToast("标签已添加，但应用失败");
    }
  } else {
    showToast("添加失败");
  }
}

// 删除自定义标签
async function onTagDelete(name: string) {
  const ok = await store.deleteCustomTag(name);
  if (ok) {
    showToast("标签已删除");
  } else {
    showToast("删除失败");
  }
}

// 去掉扩展名的显示名
function displayName(name: string): string {
  return name.replace(/\.[^/.]+$/, "");
}

// ===== 音量控制 =====
function handleVolumeInput(e: Event) {
  const target = e.target as HTMLInputElement;
  const v = parseInt(target.value, 10) / 100;
  void store.setVolume(v);
}

// ===== 设备选择 =====
function toggleDeviceList() {
  isDeviceOpen.value = !isDeviceOpen.value;
  if (isDeviceOpen.value) {
    void store.requestDevices();
  }
}

// ===== 注册后端事件监听 =====
useTauriEvent<MusicReadyPayload>("music-ready", (e) => {
  store.handleReady(e.payload);
});
useTauriEvent<MusicStatus>("music-status", (e) => {
  store.handleStatus(e.payload);
});
useTauriEvent<MusicPlayStatePayload>("music-play-state", (e) => {
  store.handlePlayState(e.payload);
});
useTauriEvent<MusicProgressPayload>("music-progress", (e) => {
  store.handleProgress(e.payload);
});
useTauriEvent<MusicDevicesPayload>("music-devices", (e) => {
  store.handleDevices(e.payload);
});
useTauriEvent<MusicVolumePayload>("music-volume-change", (e) => {
  store.handleVolumeChange(e.payload);
});
useTauriEvent<MusicPlayModePayload>("music-play-mode", (e) => {
  store.handlePlayModeChange(e.payload);
});
useTauriEvent<MusicReadyPayload>("music-track-change", (e) => {
  store.handleTrackChange(e.payload);
});
useTauriEvent<unknown>("music-no-music", () => {
  store.handleNoMusic();
});
useTauriEvent<MusicPlayErrorPayload>("music-play-error", (e) => {
  store.handlePlayError(e.payload);
});
useTauriEvent<PlaylistData>("music-playlist", (e) => {
  store.handlePlaylist(e.payload);
});
useTauriEvent<MusicSongMissingPayload>("music-song-missing", (e) => {
  store.handleSongMissing(e.payload);
});

// 自习室同步听歌：WS 推送的 music:* 事件（dj_changed / state / volume / playlist_updated）
useTauriEvent<unknown>("ws-event", (e) => {
  store.handleSyncWsEvent(e.payload);
});

// ===== 初始化 =====
onMounted(async () => {
  await store.loadSavedVolume();
  await store.loadCustomTags();
  void store.requestStatus();
  void store.requestDevices();
  // 注册全局拖拽事件（mouseup/mousemove 需在 document 上监听，避免拖出进度条后失效）
  if (typeof document !== "undefined") {
    document.addEventListener("mousemove", handleProgressMouseMove);
    document.addEventListener("mouseup", handleProgressMouseUp);
  }
});

onUnmounted(() => {
  if (typeof document !== "undefined") {
    document.removeEventListener("click", handleGlobalClick);
    document.removeEventListener("mousemove", handleProgressMouseMove);
    document.removeEventListener("mouseup", handleProgressMouseUp);
  }
});

// 关闭弹层（点击外部）
function handleGlobalClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (isVolumeOpen.value && !target.closest(".music-volume")) {
    isVolumeOpen.value = false;
  }
  if (isDeviceOpen.value && !target.closest(".music-device")) {
    isDeviceOpen.value = false;
  }
  if (isPlaylistOpen.value && !target.closest(".music-playlist") && !target.closest(".music-playlist-btn")) {
    isPlaylistOpen.value = false;
  }
}

// 注册全局点击用于关闭弹层
if (typeof document !== "undefined") {
  document.addEventListener("click", handleGlobalClick);
}
</script>

<template>
  <div class="music-player" :class="{ collapsed: store.isCollapsed }">
    <!-- 顶部收起按钮（始终可见） -->
    <button class="music-collapse-btn" title="收起" @click="store.toggleCollapse()">
      <span class="music-collapse-icon">▼</span>
    </button>

    <!-- 收起状态：律动条 + 曲名（绝对定位，opacity 过渡） -->
    <div class="music-player__collapsed" @click="store.toggleCollapse()">
      <div class="music-visualizer">
        <span
          v-for="i in 4"
          :key="i"
          class="music-visualizer__bar"
          :class="{ playing: store.playing }"
          :style="{ animationDelay: (i - 1) * 0.15 + 's' }"
        ></span>
      </div>
      <span class="music-player__collapsed-track">{{ store.trackName || "未播放" }}</span>
    </div>

    <!-- 展开内容（max-height 过渡动画，收起时挤压上方空间） -->
    <div class="music-wrapper">
      <div class="music-player__main">
        <!-- 顶部信息行：🎵 曲名 + 音量 + 设备 + 播放列表 -->
        <div class="music-info">
          <span class="music-icon">🎵</span>
          <span
            class="music-player__track-name"
            :class="{ error: !!store.playError, empty: !store.hasMusic }"
          >
            {{ store.playError || (store.hasMusic ? (store.trackName || "未播放") : "无音乐") }}
          </span>

          <!-- 音量 -->
          <div class="music-volume">
            <button
              class="music-btn"
              :title="`音量 ${Math.round(store.volume * 100)}%`"
              @click="isVolumeOpen = !isVolumeOpen"
            >
              {{ store.volumeIcon }}
            </button>
            <div v-show="isVolumeOpen" class="music-volume__slider">
              <input
                type="range"
                min="0"
                max="100"
                :value="Math.round(store.volume * 100)"
                @input="handleVolumeInput"
              />
            </div>
          </div>

          <!-- 设备 -->
          <div class="music-device">
            <button class="music-btn" title="输出设备" @click="toggleDeviceList">🎧</button>
            <div v-show="isDeviceOpen" class="music-device__list">
              <div class="music-device__warning">⚠️ 除非你真的知道你在做什么，请不要更改此设置</div>
              <div
                v-for="device in store.devices"
                :key="device.id"
                class="music-device__item"
                :class="{ current: device.id === store.currentDeviceId }"
                @click="store.setDevice(device.id); isDeviceOpen = false"
              >
                <span class="music-device__name">{{ device.name }}</span>
                <span v-if="device.id === store.currentDeviceId" class="music-device__check">✓</span>
              </div>
            </div>
          </div>

          <!-- 播放列表 -->
          <button class="music-btn music-playlist-btn" title="播放列表" @click="togglePlaylist">
            📋
          </button>
        </div>

        <!-- 中间进度条行：当前时间 + 进度条 + 总时长 -->
        <div
          class="music-progress"
          :class="{ 'music-progress--dragging': isDraggingProgress || seekTarget !== null }"
          @click="handleProgressClick"
        >
          <span class="music-progress__time">{{ displayTimeText }}</span>
          <div ref="progressBarRef" class="music-progress__bar" @mousedown="handleProgressMouseDown">
            <div
              class="music-progress__fill"
              :style="{ width: displayProgress + '%' }"
            ></div>
            <div
              class="music-progress__handle"
              :style="{ left: displayProgress + '%' }"
            ></div>
          </div>
          <span class="music-progress__time">{{ store.durationText }}</span>
        </div>

        <!-- 底部控制行：📊榜单(左) + ⏮上一首 + ▶播放 + ⏭下一首 + 🔀模式(右) -->
        <div class="music-controls">
          <button
            v-if="settings.settings.showChartsBtn"
            class="music-btn music-btn--small music-charts-btn"
            title="热歌榜单"
            @click="emit('charts')"
          >
            📊
          </button>
          <button
            class="music-btn music-btn--prev"
            :disabled="!store.hasPrev"
            title="上一首"
            @click="store.prev()"
          >
            ⏮
          </button>
          <button
            class="music-btn music-btn--play"
            :data-playing="store.playing"
            @click="store.togglePlay()"
          >
            {{ store.playing ? "⏸" : "▶" }}
          </button>
          <button class="music-btn music-btn--next" title="下一首" @click="store.next()">
            ⏭
          </button>
          <button
            class="music-btn music-btn--mode"
            :class="{ active: store.playMode !== 'order' }"
            :title="store.playModeTitle"
            @click="store.cyclePlayMode()"
          >
            {{ store.playModeIcon }}
          </button>
        </div>

        <!-- 播放列表面板 -->
        <div v-show="isPlaylistOpen" class="music-playlist">
          <div class="music-playlist__header">
            <span>播放列表</span>
            <button class="music-playlist__refresh" @click.stop="store.requestPlaylist()">🔄</button>
          </div>
          <div class="music-playlist__items">
            <div v-if="store.playlist.length === 0" class="music-playlist__empty">暂无音乐</div>
            <div
              v-for="(song, idx) in store.playlist"
              :key="idx"
              class="music-playlist__item"
              :class="{ current: song === store.trackName }"
              @click="handleSongClick(song)"
            >
              <span
                class="music-playlist__tag"
                :data-tag="store.playlistTags[song]?.name || '自定义'"
                :style="tagStyle(song)"
                @click.stop="handleTagClick(song, $event)"
              >
                {{ store.playlistTags[song]?.name || "自定义" }}
              </span>
              <span class="music-playlist__name">{{ displayName(song) }}</span>
              <button
                v-if="song !== store.trackName"
                class="music-playlist__delete"
                @click="handleDeleteSong(song, $event)"
                title="删除"
              >
                🗑
              </button>
              <span v-else class="music-playlist__playing">▶</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 标签选择弹窗 -->
    <MusicTagModal
      v-model:visible="tagModalVisible"
      :song-name="displayName(tagEditSong)"
      :current-tag="tagEditCurrent"
      :custom-tags="store.customTags"
      :advanced-color-enabled="settings.settings.advancedColorCustomization"
      @select-tag="onTagSelect"
      @add-tag="onTagAdd"
      @delete-tag="onTagDelete"
    />

    <!-- Toast 提示 -->
    <div v-if="toastVisible" class="music-toast">{{ toastMessage }}</div>
  </div>
</template>

<style scoped>
/* 音乐播放器 - 绝对定位在 main-content 底部居中（匹配原版） */
/* z-index 使用 --z-overlay-ui(200)，高于 header-btn(100)/mode-slider(50)/sidebar-btn(10)，
   确保输出设备弹框与播放列表浮层不被侧边栏区域遮挡 */
.music-player {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  width: 100%;
  max-width: 300px;
  overflow: visible;
  z-index: var(--z-overlay-ui);
  color: #fff;
  font-size: 13px;
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
}

/* 收起按钮 - 顶部小条（紧贴播放器顶部边缘） */
.music-collapse-btn {
  position: absolute;
  top: -1px;
  left: 50%;
  transform: translateX(-50%);
  width: 60px;
  height: 8px;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-top: none;
  border-radius: 0 0 6px 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  z-index: var(--z-sidebar-btn);
}

.music-collapse-btn:hover {
  background: rgba(255, 255, 255, 0.25);
  width: 70px;
  height: 10px;
  border-radius: 0 0 9px 9px;
}

.music-collapse-icon {
  font-size: 6px;
  color: rgba(255, 255, 255, 0.6);
  transition: transform 0.45s cubic-bezier(0.5, 0, 0.5, 1);
  transform: rotate(0deg);  /* 展开状态：▼向下 */
}

/* 收起状态：图标翻转 ▲向上 */
.music-player.collapsed .music-collapse-icon {
  transform: rotate(180deg);
}

/* ============ 收起状态：律动条 + 曲名（绝对定位，opacity 过渡） ============ */
.music-player__collapsed {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  cursor: pointer;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.45s cubic-bezier(0.5, 0, 0.5, 1);
}

.music-player.collapsed .music-player__collapsed {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
}

.music-player__collapsed-track {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.music-visualizer {
  display: flex;
  gap: 2px;
  align-items: flex-end;
  height: 16px;
}

.music-visualizer__bar {
  width: 3px;
  height: 4px;
  background: rgba(255, 255, 255, 0.5);
  border-radius: 2px;
}

.music-visualizer__bar.playing {
  animation: visualizerBounce 0.8s ease-in-out infinite;
}

@keyframes visualizerBounce {
  0%, 100% { height: 4px; }
  50% { height: 14px; }
}

/* ============ 展开内容容器：max-height 过渡实现收起/展开动画 ============ */
.music-wrapper {
  overflow: visible;
  max-height: 300px;
  transition: max-height 0.45s cubic-bezier(0.5, 0, 0.5, 1);
}

.music-player.collapsed .music-wrapper {
  max-height: 0;
  overflow: hidden;
}

.music-player__main {
  display: flex;
  flex-direction: column;
  padding: 10px 14px 6px 14px;
  gap: 6px;
}

/* ============ 顶部信息行：🎵 曲名 + 音量 + 设备 + 播放列表 ============ */
.music-info {
  display: flex;
  align-items: center;
  gap: 6px;
  position: relative;
  overflow: visible;
}

.music-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.music-player__track-name {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  color: rgba(255, 255, 255, 0.95);
}

.music-player__track-name.error {
  color: rgba(255, 150, 100, 0.95);
}

.music-player__track-name.empty {
  color: rgba(255, 255, 255, 0.5);
}

/* ============ 底部控制行：榜单(左) + 上一首 + 播放 + 下一首 + 模式(右) ============ */
.music-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  position: relative;
}

/* 左侧榜单按钮用绝对定位，不影响中间按钮居中 */
.music-controls .music-charts-btn {
  position: absolute;
  left: 0;
}

/* 右侧模式按钮用绝对定位，不影响中间按钮居中 */
.music-controls .music-btn--mode {
  position: absolute;
  right: 0;
}

/* 基础按钮（音量/设备/播放列表）：24x24 圆形，参照原版 .music-device-btn */
.music-btn {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.7);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 0;
}

.music-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.9);
  transform: scale(1.1);
}

.music-btn:active {
  transform: scale(0.95);
}

.music-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  pointer-events: none;
}

/* 小按钮（榜单/模式/播放列表）：20x20 圆形，参照原版 .music-btn-small */
.music-btn--small,
.music-btn--mode,
.music-playlist-btn {
  width: 20px;
  height: 20px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.1);
}

.music-btn--small:hover,
.music-btn--mode:hover,
.music-playlist-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.9);
  transform: scale(1.1);
}

/* 主控制按钮（上一首/下一首）：32x32 圆形，参照原版 .music-btn */
.music-btn--prev,
.music-btn--next {
  width: 32px;
  height: 32px;
  background: rgba(255, 255, 255, 0.15);
  color: #fff;
  font-size: 12px;
}

.music-btn--prev:hover,
.music-btn--next:hover {
  background: rgba(255, 255, 255, 0.25);
  transform: scale(1.05);
}

/* 播放按钮：38x38 圆形，参照原版 .music-play */
.music-btn--play {
  width: 38px;
  height: 38px;
  background: rgba(255, 255, 255, 0.25);
  color: #fff;
  font-size: 14px;
}

.music-btn--play:hover {
  background: rgba(255, 255, 255, 0.35);
  transform: scale(1.05);
}

.music-btn--play[data-playing="true"] {
  background: rgba(255, 255, 255, 0.35);
}

/* 模式按钮 active 状态：参照原版，背景变亮 */
.music-btn--mode.active {
  background: rgba(255, 255, 255, 0.3);
  color: rgba(255, 255, 255, 0.95);
}

/* ============ 进度条行 ============ */
.music-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}

.music-progress__time {
  font-size: 11px;
  color: #fff;
  font-variant-numeric: tabular-nums;
  width: 36px;
  text-align: center;
}

.music-progress__bar {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
  cursor: pointer;
  position: relative;
  user-select: none;
}

.music-progress--dragging .music-progress__bar {
  cursor: grabbing;
}

.music-progress__fill {
  height: 100%;
  background: #e94560;
  border-radius: 2px;
  transition: width 0.2s ease;
}

.music-progress--dragging .music-progress__fill {
  transition: none;
}

.music-progress__handle {
  position: absolute;
  top: 50%;
  width: 10px;
  height: 10px;
  background: #fff;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.4);
  transition: left 0.2s ease;
}

.music-progress--dragging .music-progress__handle {
  transition: none;
  width: 14px;
  height: 14px;
}

/* ============ 音量控制 ============ */
/* 仅 .music-volume 设为 relative，让音量拨动条相对其定位 */
/* .music-device 不设 relative，让设备列表相对 .music-info 定位（参照原版） */
.music-volume {
  position: relative;
}

/* 音量拨动条：z-index 使用 --z-popup，可暂时遮住展开/收起按钮 */
.music-volume__slider {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 6px;
  background: linear-gradient(145deg, rgba(255, 120, 120, 0.5), rgba(255, 100, 100, 0.4));
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  padding: 10px 6px;
  z-index: var(--z-popup);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  backdrop-filter: blur(4px);
}

/* 休息模式 - 绿色调 */
.container.break-mode .music-volume__slider {
  background: linear-gradient(145deg, rgba(100, 200, 140, 0.5), rgba(80, 180, 120, 0.4));
}

/* 竖向滑块：4px 宽 × 100px 高（参照原版） */
.music-volume__slider input {
  -webkit-appearance: none;
  appearance: none;
  width: 4px;
  height: 100px;
  background: rgba(255, 255, 255, 0.25);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
  writing-mode: vertical-lr;
  direction: rtl;
}

.music-volume__slider input::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  transition: transform 0.15s ease;
}

.music-volume__slider input::-webkit-slider-thumb:hover {
  transform: scale(1.1);
}

.music-volume__slider input::-moz-range-thumb {
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  cursor: pointer;
  border: none;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}

/* ============ 输出设备列表 ============ */
/* z-index 使用 --z-popup，在 .music-player 层叠上下文内高于其他浮层；
   .music-player 自身 z-index 为 --z-overlay-ui(200)，高于侧边栏与 HeaderButtons */
.music-device__list {
  position: absolute;
  bottom: 100%;
  right: 0;
  margin-bottom: 4px;
  background: rgba(40, 40, 50, 0.98);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  padding: 6px;
  min-width: 220px;
  max-height: 200px;
  overflow-y: auto;
  z-index: var(--z-popup);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

/* 设备列表滚动条 */
.music-device__list::-webkit-scrollbar {
  width: 6px;
}

.music-device__list::-webkit-scrollbar-track {
  background: transparent;
}

.music-device__list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
}

.music-device__list::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.4);
}

.music-device__warning {
  font-size: 10px;
  color: rgba(255, 200, 100, 0.8);
  padding: 4px 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 4px;
}

.music-device__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
}

.music-device__item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.music-device__item.current {
  background: rgba(233, 69, 96, 0.2);
}

.music-device__name {
  color: #ddd;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.music-device__check {
  color: #4caf50;
  font-weight: 700;
}

/* ============ 播放列表面板 ============ */
/* z-index 使用 --z-popup，与设备列表一致；宽度由 200px 扩展至 240px，完整显示歌曲信息 */
.music-playlist {
  position: absolute;
  bottom: 100%;
  right: 0;
  background: rgba(40, 40, 50, 0.98);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  margin-bottom: 8px;
  width: 240px;
  max-height: 280px;
  display: flex;
  flex-direction: column;
  z-index: var(--z-popup);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.music-playlist__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 13px;
  font-weight: 600;
}

.music-playlist__refresh {
  background: none;
  border: none;
  color: #aaa;
  cursor: pointer;
  font-size: 14px;
}

.music-playlist__items {
  overflow-y: auto;
  flex: 1;
}

/* 播放列表滚动条 */
.music-playlist__items::-webkit-scrollbar {
  width: 4px;
}

.music-playlist__items::-webkit-scrollbar-track {
  background: transparent;
}

.music-playlist__items::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
}

.music-playlist__items::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.4);
}

.music-playlist__empty {
  text-align: center;
  color: #666;
  padding: 24px;
}

.music-playlist__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  min-height: 28px;
  box-sizing: border-box;
}

.music-playlist__item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.music-playlist__item.current {
  background: rgba(233, 69, 96, 0.12);
}

.music-playlist__tag {
  font-size: 8px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  color: #ccc;
  flex-shrink: 0;
  cursor: pointer;
  transition: filter 0.15s ease, transform 0.15s ease;
}

.music-playlist__tag:hover {
  filter: brightness(1.2);
  transform: scale(1.05);
}

/* 预设标签默认配色（与弹窗 .tag-option[data-tag] 一致） */
.music-playlist__tag[data-tag="学习"] {
  background: rgba(100, 180, 255, 0.3);
  color: rgba(200, 230, 255, 1);
}

.music-playlist__tag[data-tag="运动"] {
  background: rgba(255, 150, 100, 0.3);
  color: rgba(255, 210, 180, 1);
}

.music-playlist__tag[data-tag="休息"] {
  background: rgba(100, 230, 100, 0.3);
  color: rgba(200, 255, 200, 1);
}

.music-playlist__name {
  flex: 1;
  font-size: 10px;
  color: #ddd;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.music-playlist__delete,
.music-playlist__playing {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  box-sizing: border-box;
}

.music-playlist__delete {
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}

.music-playlist__delete:hover {
  color: #e94560;
}

.music-playlist__playing {
  color: #e94560;
  font-size: 10px;
}

/* ============ Toast 提示 ============ */
.music-toast {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-bottom: 12px;
  background: rgba(40, 40, 50, 0.96);
  color: #fff;
  font-size: 12px;
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  white-space: nowrap;
  z-index: var(--z-popup);
  pointer-events: none;
}
</style>
