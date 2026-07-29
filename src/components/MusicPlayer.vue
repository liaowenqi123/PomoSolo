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
import { ref, computed, onMounted } from "vue";
import { useMusicStore } from "@/stores/music";
import { useSettingsStore } from "@/stores/settings";
import { useTauriEvent } from "@/api/events";
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

function handleProgressClick(e: MouseEvent) {
  if (!progressBarRef.value || store.duration <= 0) return;
  const rect = progressBarRef.value.getBoundingClientRect();
  const progress = (e.clientX - rect.left) / rect.width;
  const newTime = Math.floor(progress * store.duration);
  void store.seek(newTime);
}

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

// ===== 初始化 =====
onMounted(async () => {
  await store.loadSavedVolume();
  await store.loadCustomTags();
  void store.requestStatus();
  void store.requestDevices();
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
        <div class="music-progress" @click="handleProgressClick">
          <span class="music-progress__time">{{ store.currentTimeText }}</span>
          <div ref="progressBarRef" class="music-progress__bar">
            <div class="music-progress__fill" :style="{ width: store.progress + '%' }"></div>
            <div class="music-progress__handle" :style="{ left: store.progress + '%' }"></div>
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
                :style="{
                  background: store.playlistTags[song]?.color || undefined,
                }"
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
  </div>
</template>

<style scoped>
/* 音乐播放器 - 绝对定位在 main-content 底部居中（匹配原版） */
/* z-index 提升至 200，高于 HeaderButtons(100)/ModeSlider(50)/sidebar-collapse-btn(10)，
   确保输出设备弹框与播放列表浮层不被侧边栏区域遮挡 */
.music-player {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  width: 100%;
  max-width: 300px;
  overflow: visible;
  z-index: 200;
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
  z-index: 10;
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
}

.music-progress__fill {
  height: 100%;
  background: #e94560;
  border-radius: 2px;
  transition: width 0.2s ease;
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
}

/* ============ 音量控制 ============ */
/* 仅 .music-volume 设为 relative，让音量拨动条相对其定位 */
/* .music-device 不设 relative，让设备列表相对 .music-info 定位（参照原版） */
.music-volume {
  position: relative;
}

/* 音量拨动条：z-index 高于收起按钮（10），可暂时遮住展开/收起按钮 */
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
  z-index: 1000;
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
/* z-index 提升至 9999，确保在 .music-player 层叠上下文内高于其他浮层；
   .music-player 自身 z-index 已提升至 200，高于侧边栏与 HeaderButtons */
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
  z-index: 9999;
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
/* z-index 与设备列表一致(9999)；宽度由 200px 扩展至 240px，完整显示歌曲信息 */
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
  z-index: 9999;
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
}

.music-playlist__name {
  flex: 1;
  font-size: 10px;
  color: #ddd;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.music-playlist__delete {
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  font-size: 12px;
  padding: 2px;
}

.music-playlist__delete:hover {
  color: #e94560;
}

.music-playlist__playing {
  color: #e94560;
  font-size: 9px;
}
</style>
