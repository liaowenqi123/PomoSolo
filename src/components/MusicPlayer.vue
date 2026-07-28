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
    <!-- 收起状态：仅显示律动条和曲名 -->
    <div v-if="store.isCollapsed" class="music-player__collapsed" @click="store.toggleCollapse()">
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

    <!-- 展开状态：完整控制栏 -->
    <div v-else class="music-player__main">
      <!-- 左侧：曲名信息 -->
      <div class="music-player__track">
        <span
          class="music-player__track-name"
          :class="{ error: !!store.playError, empty: !store.hasMusic }"
        >
          {{ store.playError || (store.hasMusic ? (store.trackName || "未播放") : "无音乐") }}
        </span>
      </div>

      <!-- 中间：控制按钮 + 进度条 -->
      <div class="music-player__center">
        <div class="music-controls">
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

        <div class="music-progress" @click="handleProgressClick">
          <span class="music-progress__time">{{ store.currentTimeText }}</span>
          <div ref="progressBarRef" class="music-progress__bar">
            <div class="music-progress__fill" :style="{ width: store.progress + '%' }"></div>
            <div class="music-progress__handle" :style="{ left: store.progress + '%' }"></div>
          </div>
          <span class="music-progress__time">{{ store.durationText }}</span>
        </div>
      </div>

      <!-- 右侧：音量、设备、播放列表、收起 -->
      <div class="music-player__right">
        <!-- 音量 -->
        <div class="music-volume">
          <button class="music-btn" :title="`音量 ${Math.round(store.volume * 100)}%`" @click="isVolumeOpen = !isVolumeOpen">
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
          <button class="music-btn" title="输出设备" @click="toggleDeviceList">🔊</button>
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

        <!-- 收起 -->
        <button class="music-btn" title="收起" @click="store.toggleCollapse()">▼</button>

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
.music-player {
  width: 100%;
  background: rgba(20, 20, 30, 0.85);
  backdrop-filter: blur(10px);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  color: #eee;
  font-size: 13px;
}

.music-player__collapsed {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  cursor: pointer;
}

.music-player__collapsed-track {
  font-size: 12px;
  color: #ccc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
  background: #e94560;
  border-radius: 2px;
}

.music-visualizer__bar.playing {
  animation: visualizerBounce 0.8s ease-in-out infinite;
}

@keyframes visualizerBounce {
  0%, 100% { height: 4px; }
  50% { height: 14px; }
}

.music-player__main {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  gap: 16px;
}

.music-player__track {
  flex-shrink: 0;
  width: 140px;
  overflow: hidden;
}

.music-player__track-name {
  display: block;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.music-player__track-name.error {
  color: rgba(255, 150, 100, 0.95);
}

.music-player__track-name.empty {
  color: #666;
}

.music-player__center {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.music-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.music-btn {
  background: none;
  border: none;
  color: #ddd;
  font-size: 16px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background 0.2s ease, color 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.music-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

.music-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.music-btn--play {
  font-size: 18px;
  width: 32px;
  height: 32px;
  background: rgba(233, 69, 96, 0.2);
  border-radius: 50%;
}

.music-btn--play[data-playing="true"] {
  background: rgba(233, 69, 96, 0.4);
}

.music-btn--mode.active {
  color: #e94560;
}

.music-progress {
  display: flex;
  align-items: center;
  gap: 8px;
}

.music-progress__time {
  font-size: 11px;
  color: #999;
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

.music-player__right {
  display: flex;
  align-items: center;
  gap: 4px;
  position: relative;
}

.music-volume,
.music-device {
  position: relative;
}

.music-volume__slider {
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(30, 30, 40, 0.95);
  padding: 10px;
  border-radius: 8px;
  margin-bottom: 6px;
}

.music-volume__slider input {
  width: 100px;
  writing-mode: vertical-lr;
  direction: rtl;
}

.music-device__list {
  position: absolute;
  bottom: 100%;
  right: 0;
  background: rgba(30, 30, 40, 0.95);
  border-radius: 8px;
  padding: 6px;
  margin-bottom: 6px;
  min-width: 220px;
  max-height: 240px;
  overflow-y: auto;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
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

.music-playlist {
  position: absolute;
  bottom: 100%;
  right: 0;
  background: rgba(25, 25, 35, 0.97);
  border-radius: 10px;
  margin-bottom: 6px;
  width: 320px;
  max-height: 360px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
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

.music-playlist__empty {
  text-align: center;
  color: #666;
  padding: 24px;
}

.music-playlist__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
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
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  color: #ccc;
  flex-shrink: 0;
}

.music-playlist__name {
  flex: 1;
  font-size: 12px;
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
  font-size: 12px;
}
</style>
