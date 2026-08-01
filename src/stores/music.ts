/**
 * 音乐播放器 Pinia Store
 *
 * 迁移自 electron/src/scripts/modules/musicPlayer.js 的状态管理部分。
 * 维护播放器运行时状态，所有播放操作通过 src/api/music.ts 调用 Rust 后端
 * （后端再调用 Python 子进程 music.py），前端只管 UI。
 *
 * 事件监听由 MusicPlayer.vue 组件通过 useTauriEvent 注册，调用 store 的
 * handle* 方法更新状态，确保组件卸载时自动取消监听。
 */
import { defineStore, acceptHMRUpdate } from "pinia";
import { ref, computed } from "vue";
import {
  musicTogglePlay,
  musicNext,
  musicPrev,
  musicSeek,
  musicSetVolume,
  musicSetPlayMode,
  musicGetStatus,
  musicGetPlaylist,
  musicGetDevices,
  musicSetDevice,
  musicPlaySong,
  musicDeleteSong,
  musicGetCustomTags,
  musicAddCustomTag,
  musicDeleteCustomTag,
  musicUpdateTag,
  type PlayMode,
  type MusicDevice,
  type PlaylistSong,
  type MusicReadyPayload,
  type MusicStatus,
  type MusicPlayStatePayload,
  type MusicProgressPayload,
  type MusicDevicesPayload,
  type MusicVolumePayload,
  type MusicPlayModePayload,
  type MusicPlayErrorPayload,
  type MusicSongMissingPayload,
  type PlaylistData,
} from "@/api/music";
import {
  musicSyncPlay,
  musicSyncPause,
  musicSyncSeek,
  musicSyncNext,
  musicSyncVolume,
  musicSyncRequestDj,
} from "@/api/musicSync";
import { useAuthStore } from "@/stores/auth";
import { readData, writeData } from "@/api/data";

// ===== 工具函数 =====

/** 格式化时间（不显示分钟前导零），例如 1:05 */
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

// ===== Store =====

export const useMusicStore = defineStore("music", () => {
  // ===== State =====
  const playing = ref(false);
  const trackName = ref("");
  const currentTime = ref(0);
  const duration = ref(0);
  const volume = ref(1.0);
  const playMode = ref<PlayMode>("shuffle");
  const hasMusic = ref(true);
  const hasPrev = ref(false);
  const playError = ref<string | null>(null);

  const devices = ref<MusicDevice[]>([]);
  const currentDeviceId = ref<number | null>(null);

  const playlist = ref<string[]>([]);
  const playlistTags = ref<Record<string, { name: string; color: string | null }>>({});
  const customTags = ref<Record<string, string>>({});

  const isDragging = ref(false);
  const isCollapsed = ref(false);

  // ===== 同步听歌状态（自习室房间内） =====
  /** 是否开启同步听歌 */
  const syncEnabled = ref(false);
  /** 我是否为当前 DJ */
  const isDj = ref(false);
  /** 当前 DJ 用户名（空 = 无 DJ） */
  const djName = ref("");
  /** 当前 DJ 用户 id */
  const djUserId = ref<string | null>(null);

  // ===== Getters =====
  const progress = computed(() => {
    if (duration.value <= 0) return 0;
    return (currentTime.value / duration.value) * 100;
  });

  const currentTimeText = computed(() => formatTime(currentTime.value));
  const durationText = computed(() => formatTime(duration.value));

  const volumeIcon = computed(() => {
    if (volume.value === 0) return "🔇";
    if (volume.value < 0.3) return "🔈";
    if (volume.value < 0.7) return "🔉";
    return "🔊";
  });

  const playModeIcon = computed(() => {
    if (playMode.value === "shuffle") return "🔀";
    if (playMode.value === "order") return "🔁";
    return "🔂";
  });

  const playModeTitle = computed(() => {
    if (playMode.value === "shuffle") return "随机播放（点击切换顺序）";
    if (playMode.value === "order") return "顺序播放（点击切换单曲循环）";
    return "单曲循环（点击切换随机播放）";
  });

  // ===== Actions =====

  /** DJ 模式：把播放动作广播到房间（仅 DJ 且已开启同步时生效） */
  async function broadcastDjAction(
    action: "play" | "pause" | "seek" | "next" | "volume",
    params: Record<string, unknown> = {},
  ) {
    if (!syncEnabled.value || !isDj.value) return;
    try {
      switch (action) {
        case "play":
          await musicSyncPlay(String(params.songId ?? ""), Number(params.positionMs ?? 0));
          break;
        case "pause":
          await musicSyncPause(Number(params.positionMs ?? 0));
          break;
        case "seek":
          await musicSyncSeek(Number(params.positionMs ?? 0));
          break;
        case "next":
          await musicSyncNext(String(params.songId ?? ""));
          break;
        case "volume":
          await musicSyncVolume(Number(params.volume ?? 0));
          break;
      }
    } catch (e) {
      console.warn("[MusicStore] DJ 广播失败:", e);
    }
  }

  /** 切换播放/暂停 */
  async function togglePlay() {
    try {
      await musicTogglePlay();
      // 乐观判断本次切换后的状态并广播（播放状态事件异步回传）
      if (syncEnabled.value && isDj.value) {
        const willPlay = !playing.value;
        await broadcastDjAction(willPlay ? "play" : "pause", {
          songId: trackName.value,
          positionMs: Math.floor(currentTime.value * 1000),
        });
      }
    } catch (e) {
      console.error("[MusicStore] togglePlay error:", e);
    }
  }

  /** 下一首 */
  async function next() {
    try {
      await musicNext();
      if (syncEnabled.value && isDj.value) {
        await broadcastDjAction("next", { songId: trackName.value });
      }
    } catch (e) {
      console.error("[MusicStore] next error:", e);
    }
  }

  /** 上一首 */
  async function prev() {
    try {
      await musicPrev();
    } catch (e) {
      console.error("[MusicStore] prev error:", e);
    }
  }

  /** 跳转到指定时间 */
  async function seek(seconds: number) {
    try {
      await musicSeek(seconds);
      if (syncEnabled.value && isDj.value) {
        await broadcastDjAction("seek", { positionMs: Math.floor(seconds * 1000) });
      }
    } catch (e) {
      console.error("[MusicStore] seek error:", e);
    }
  }

  /** 设置音量（0-1） */
  async function setVolume(v: number) {
    volume.value = v;
    try {
      await musicSetVolume(v);
      await saveVolume(v);
      if (syncEnabled.value && isDj.value) {
        await broadcastDjAction("volume", { volume: v });
      }
    } catch (e) {
      console.error("[MusicStore] setVolume error:", e);
    }
  }

  /** 循环切换播放模式：shuffle -> order -> loop -> shuffle */
  async function cyclePlayMode() {
    const nextMode: PlayMode =
      playMode.value === "shuffle" ? "order" : playMode.value === "order" ? "loop" : "shuffle";
    try {
      await musicSetPlayMode(nextMode);
    } catch (e) {
      console.error("[MusicStore] cyclePlayMode error:", e);
    }
  }

  /** 请求初始状态 */
  async function requestStatus() {
    try {
      await musicGetStatus();
    } catch (e) {
      console.error("[MusicStore] requestStatus error:", e);
    }
  }

  /** 请求设备列表 */
  async function requestDevices() {
    try {
      await musicGetDevices();
    } catch (e) {
      console.error("[MusicStore] requestDevices error:", e);
    }
  }

  /** 请求播放列表 */
  async function requestPlaylist() {
    try {
      await musicGetPlaylist();
    } catch (e) {
      console.error("[MusicStore] requestPlaylist error:", e);
    }
  }

  /** 设置输出设备 */
  async function setDevice(deviceId: number) {
    currentDeviceId.value = deviceId;
    try {
      await musicSetDevice(deviceId);
    } catch (e) {
      console.error("[MusicStore] setDevice error:", e);
    }
  }

  /** 播放指定歌曲 */
  async function playSong(songName: string) {
    if (songName === trackName.value) return;
    try {
      await musicPlaySong(songName);
      if (syncEnabled.value && isDj.value) {
        await broadcastDjAction("play", { songId: songName, positionMs: 0 });
      }
    } catch (e) {
      console.error("[MusicStore] playSong error:", e);
    }
  }

  /** 删除歌曲 */
  async function deleteSong(songName: string): Promise<boolean> {
    try {
      const result = await musicDeleteSong(songName);
      if (result.success) {
        await requestPlaylist();
      }
      return result.success;
    } catch (e) {
      console.error("[MusicStore] deleteSong error:", e);
      return false;
    }
  }

  /** 加载自定义标签 */
  async function loadCustomTags() {
    try {
      const result = await musicGetCustomTags();
      if (result.success && result.customTags) {
        customTags.value = result.customTags;
      }
    } catch (e) {
      console.error("[MusicStore] loadCustomTags error:", e);
    }
  }

  /** 添加自定义标签 */
  async function addCustomTag(tagName: string, color: string): Promise<boolean> {
    try {
      const result = await musicAddCustomTag(tagName, color);
      if (result.success) {
        customTags.value[tagName] = color;
      }
      return result.success;
    } catch (e) {
      console.error("[MusicStore] addCustomTag error:", e);
      return false;
    }
  }

  /** 删除自定义标签 */
  async function deleteCustomTag(tagName: string): Promise<boolean> {
    try {
      const result = await musicDeleteCustomTag(tagName);
      if (result.success) {
        delete customTags.value[tagName];
      }
      return result.success;
    } catch (e) {
      console.error("[MusicStore] deleteCustomTag error:", e);
      return false;
    }
  }

  /** 更新歌曲标签 */
  async function updateSongTag(
    songName: string,
    tag: string,
    color: string | null,
  ): Promise<boolean> {
    try {
      const result = await musicUpdateTag(songName, tag, color);
      if (result.success) {
        playlistTags.value[songName] = { name: tag, color };
      }
      return result.success;
    } catch (e) {
      console.error("[MusicStore] updateSongTag error:", e);
      return false;
    }
  }

  /** 切换收起状态 */
  function toggleCollapse() {
    isCollapsed.value = !isCollapsed.value;
  }

  /** 从本地存储加载保存的音量 */
  async function loadSavedVolume() {
    try {
      const data = await readData();
      if (data && data.musicVolume !== undefined) {
        volume.value = data.musicVolume as number;
        await musicSetVolume(volume.value);
      }
    } catch (e) {
      console.error("[MusicStore] loadSavedVolume error:", e);
    }
  }

  /** 保存音量到本地存储 */
  async function saveVolume(v: number) {
    try {
      const data = await readData();
      if (data && data.musicVolume !== v) {
        data.musicVolume = v;
        await writeData(data);
      }
    } catch (e) {
      console.error("[MusicStore] saveVolume error:", e);
    }
  }

  // ===== 事件处理方法（由组件通过 useTauriEvent 注册后调用） =====

  function handleReady(payload: MusicReadyPayload) {
    trackName.value = payload.name;
    duration.value = payload.duration;
    currentTime.value = 0;
    playing.value = false;
    hasPrev.value = payload.has_prev ?? false;
    playError.value = null;
  }

  function handleStatus(payload: MusicStatus) {
    playing.value = payload.playing;
    trackName.value = payload.name;
    currentTime.value = payload.current;
    duration.value = payload.duration;
    if (payload.has_prev !== undefined) hasPrev.value = payload.has_prev;
    if (payload.play_mode !== undefined) playMode.value = payload.play_mode;
    playError.value = null;
  }

  function handlePlayState(payload: MusicPlayStatePayload) {
    playing.value = payload.playing;
    if (payload.playing && playError.value) {
      playError.value = null;
    }
  }

  function handleProgress(payload: MusicProgressPayload) {
    if (isDragging.value) return;
    // 过滤切歌前的过期 progress 事件：若 payload 带了 name 且与当前曲目不符，跳过
    // （切歌时旧歌的 progress 可能比 track-change 晚到，会把进度条弹回旧位置）
    if (payload.name && trackName.value && payload.name !== trackName.value) {
      return;
    }
    currentTime.value = payload.current;
    duration.value = payload.duration;
  }

  function handleDevices(payload: MusicDevicesPayload) {
    devices.value = payload.devices || [];
    currentDeviceId.value = payload.current;
  }

  function handleVolumeChange(payload: MusicVolumePayload) {
    volume.value = payload.volume;
  }

  function handlePlayModeChange(payload: MusicPlayModePayload) {
    playMode.value = payload.mode;
  }

  function handleTrackChange(payload: MusicReadyPayload) {
    trackName.value = payload.name;
    duration.value = payload.duration;
    currentTime.value = 0;
    if (payload.has_prev !== undefined) hasPrev.value = payload.has_prev;
  }

  function handleNoMusic() {
    hasMusic.value = false;
    playing.value = false;
    trackName.value = "";
    currentTime.value = 0;
    duration.value = 0;
  }

  function handlePlayError(payload: MusicPlayErrorPayload) {
    playing.value = false;
    playError.value = payload.message || "播放失败";
  }

  function handlePlaylist(payload: PlaylistData) {
    const songs = payload.songs || [];
    if (songs.length > 0 && typeof songs[0] === "object") {
      const songObjs = songs as PlaylistSong[];
      playlist.value = songObjs.map((s) => s.name);
      playlistTags.value = {};
      songObjs.forEach((s) => {
        if (s.name) {
          playlistTags.value[s.name] = {
            name: s.tag || "自定义",
            color: s.tagColor ?? null,
          };
        }
      });
    } else {
      playlist.value = songs as string[];
    }
    if (payload.current_song !== undefined) {
      trackName.value = payload.current_song;
    }
  }

  function handleSongMissing(payload: MusicSongMissingPayload) {
    playError.value = payload.message || "原歌曲已消失";
  }

  // ===== 同步听歌 =====

  /** 开启/关闭同步听歌（由自习室面板控制） */
  function setSyncEnabled(enabled: boolean) {
    syncEnabled.value = enabled;
    if (!enabled) {
      // 关闭后复位 DJ 状态（服务器 DJ 由新申请者接管）
      isDj.value = false;
      djName.value = "";
      djUserId.value = null;
    }
  }

  /** 申请成为 DJ */
  async function requestDj() {
    try {
      await musicSyncRequestDj();
    } catch (e) {
      console.warn("[MusicStore] 申请 DJ 失败:", e);
    }
  }

  /** 应用服务器广播的播放状态（听众端），含网络延迟校准 */
  function applyMusicState(evt: Record<string, unknown>) {
    const action = evt.action;
    const positionMs = Number(evt.position_ms ?? 0);
    const ts = Number(evt.timestamp_server ?? 0);
    // 校准：服务器广播时刻 + 已流逝时间 ≈ 当前播放位置
    let pos = positionMs;
    if (ts > 0) {
      pos += Math.max(0, Date.now() - ts);
    }
    const posSec = Math.floor(pos / 1000);

    if (action === "play") {
      const songId = evt.song_id;
      if (typeof songId === "string" && songId && songId !== trackName.value) {
        void playSong(songId);
        // 播放器加载需要时间，稍后跳转到目标位置
        window.setTimeout(() => void seek(posSec), 800);
      } else {
        if (!playing.value) void togglePlay();
        void seek(posSec);
      }
    } else if (action === "pause") {
      if (playing.value) void togglePlay();
      void seek(posSec);
    } else if (action === "seek") {
      void seek(posSec);
    } else if (action === "next") {
      void next();
    }
  }

  /** 处理 WS 推送的 music:* 事件（由 MusicPlayer.vue 监听 ws-event 转发） */
  function handleSyncWsEvent(payload: unknown) {
    if (!payload || typeof payload !== "object") return;
    const evt = payload as Record<string, unknown>;
    switch (evt.type) {
      case "music:dj_changed": {
        // { dj_user_id, dj_username }
        const uid = typeof evt.dj_user_id === "string" ? evt.dj_user_id : null;
        djUserId.value = uid;
        djName.value = typeof evt.dj_username === "string" ? evt.dj_username : "";
        const me = useAuthStore().session?.id ?? null;
        isDj.value = !!uid && !!me && uid === me;
        break;
      }
      case "music:state": {
        // 未开启同步 / DJ 本地已生效（避免回环）→ 忽略
        if (!syncEnabled.value || isDj.value) return;
        applyMusicState(evt);
        break;
      }
      case "music:volume": {
        if (!syncEnabled.value || isDj.value) return;
        const v = evt.volume;
        if (typeof v === "number") void setVolume(v);
        break;
      }
      case "music:playlist_updated": {
        if (!syncEnabled.value) return;
        void requestPlaylist();
        break;
      }
      default:
        break;
    }
  }

  return {
    // state
    playing,
    trackName,
    currentTime,
    duration,
    volume,
    playMode,
    hasMusic,
    hasPrev,
    playError,
    devices,
    currentDeviceId,
    playlist,
    playlistTags,
    customTags,
    isDragging,
    isCollapsed,
    // 同步听歌状态
    syncEnabled,
    isDj,
    djName,
    djUserId,
    // getters
    progress,
    currentTimeText,
    durationText,
    volumeIcon,
    playModeIcon,
    playModeTitle,
    // actions
    togglePlay,
    next,
    prev,
    seek,
    setVolume,
    cyclePlayMode,
    requestStatus,
    requestDevices,
    requestPlaylist,
    setDevice,
    playSong,
    deleteSong,
    loadCustomTags,
    addCustomTag,
    deleteCustomTag,
    updateSongTag,
    toggleCollapse,
    loadSavedVolume,
    // 同步听歌 actions
    setSyncEnabled,
    requestDj,
    handleSyncWsEvent,
    // event handlers
    handleReady,
    handleStatus,
    handlePlayState,
    handleProgress,
    handleDevices,
    handleVolumeChange,
    handlePlayModeChange,
    handleTrackChange,
    handleNoMusic,
    handlePlayError,
    handlePlaylist,
    handleSongMissing,
  };
});

// HMR: 支持 Vite 热更新，避免 HMR 后丢失 Pinia 上下文
if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useMusicStore, import.meta.hot));
}
