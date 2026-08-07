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
  musicSetAutoNext,
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
  musicReadSongChunk,
  musicReceiveSongChunk,
  musicFinalizeSong,
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
  musicSyncRequestDj,
  musicSyncState,
  musicSyncRequestSong,
  musicSyncOfferSong,
  musicSyncTransferDone,
  musicSyncTransferFailed,
  musicSyncSetConfig,
  musicSyncRequestState,
  musicReadSongChunkBin,
  musicReceiveSongChunkBin,
} from "@/api/musicSync";
import { useAuthStore } from "@/stores/auth";
import { useSettingsStore } from "@/stores/settings";
import { readData, writeData } from "@/api/data";
import { p2pTestResult } from "@/api/p2pTest";
import {
  dispatchP2PTestResult,
  handlePeerSignal,
  p2pAcceptTest,
  p2pReceive,
  p2pSend,
  type P2PHandle,
} from "@/p2p";

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
  /**
   * 同步听歌场景下，DJ 播放的歌曲本地不存在
   * （非空时播放器曲名位置显示"无这首歌"提示；P2P 传输方案见 docs/）
   */
  const missingSongName = ref<string | null>(null);

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
  /** 当前房间 DJ 使用的传歌方案（immediate 边下边播 / wait_all 全员就绪统一播） */
  const transferMode = ref<"immediate" | "wait_all">("immediate");
  /** wait_all 模式下：服务器通知"等待其他用户下载歌曲"（DJ 与听众共用提示） */
  const waitingForSongs = ref(false);

  /** P2P 传歌进度状态（听众侧） */
  interface SongTransferState {
    state: "idle" | "requesting" | "downloading" | "failed";
    songName: string;
    received: number;
    total: number;
    /** 最近一次发出 request_song 的时间（用于超时重发） */
    startedAt: number;
    /** 已自动重试次数（0 起，UI 展示"第 n/m 次重试"） */
    retryCount: number;
    /** 实际传输通道（v4.6.0 可观察性）："p2p"=WebRTC 直连 / "server"=服务器中转 / null=未确定 */
    channel: "p2p" | "server" | null;
  }
  const songTransfer = ref<SongTransferState>({
    state: "idle",
    songName: "",
    received: 0,
    total: 0,
    startedAt: 0,
    retryCount: 0,
    channel: null,
  });
  /** 传歌状态重置为 idle（各中断/完成路径统一复位，含 channel 清空） */
  function resetSongTransfer(): void {
    songTransfer.value = {
      state: "idle",
      songName: "",
      received: 0,
      total: 0,
      startedAt: 0,
      retryCount: 0,
      channel: null,
    };
  }
  /** 传歌期间暂存的 DJ 播放进度（秒），合并完成后用于立即 seek 校准 */
  let pendingSyncPosition = 0;
  /** 未开启同步时缓存的最近一次 music:sync_state（开启同步后立即应用，解决"加入已有 DJ 的同步没反应"） */
  let lastSyncState: Record<string, unknown> | null = null;
  /** DJ/持有者侧：正在传输中的歌曲集合（防止并发 song_requested 开多个循环） */
  const activeTransfers = new Set<string>();
  /** 听众侧：最近一次成功保存分片的时间（用于下载超时兜底重试） */
  let lastChunkAt = 0;
  /** 听众侧：当前挂起的 WebRTC P2P 接收（Phase 1，DJ 直连传歌；失败/切路径时关闭） */
  let activeP2PReceive: P2PHandle | null = null;
  /** 听众侧：当前歌曲传输已重试次数（每次超时重新下载 +1，耗尽后降级"无这首歌"） */
  let transferRetry = 0;
  /** 传输无进展超时阈值（ms）：卡住超过该时长立即断点续传（3s 足够判定"卡死"，越等越卡） */
  const TRANSFER_TIMEOUT_MS = 3_000;
  /** 传输最大续传次数：次数放宽（每次从已保存分片续传，成本低），耗尽后才降级"无这首歌" */
  const TRANSFER_MAX_RETRY = 10;
  /**
   * 同步进度校准容忍度（秒）：|本地进度 - DJ 进度| 在该范围内不 seek。
   * 避免 DJ 广播 sync_state 较频繁时（切歌/传歌期间 5s 一次）反复 seek 导致
   * 播放"回跳"（听到 AABCD 重复开头）；超过 2s 才校准对齐。
   */
  const SYNC_SEEK_TOLERANCE_S = 2;
  /** 传输兜底检查定时器：requesting/downloading 超时无进展 → 自动重新下载（最多 N 次） */
  let transferWatchTimer: ReturnType<typeof setInterval> | null = null;
  /** 本地已确认存在的歌曲集合（P2P 合并成功 / playSong 成功后加入）。
   * 解决：传输完成后歌单刷新有延迟，期间 DJ 再广播 sync_state 会被误判"缺歌"
   * 而重新触发 P2P（表现为 DJ 暂停时显示"获取歌曲中 2%"，DJ 恢复才切回标题）。
   */
  const localHasSongs = new Set<string>();

  /**
   * 最近一次应用的同步广播时间戳（timestamp_server，服务器转发时附加，毫秒）。
   * 用于广播新旧判定：时间戳更小的迟到旧广播直接忽略（旧状态不覆盖新状态）；
   * 与进度位置无关——DJ 手动回退/前进都是"新广播"（ts 更大），都能正常应用。
   */
  let lastSyncTs = 0;

  // ===== DJ 操作串行队列（"原子锁"） =====
  //
  // 所有"播放器副作用"（切歌 playSong / 播放暂停 togglePlay / 进度校准 seek）
  // 统一经此队列串行执行，杜绝多条 DJ 信息同时进入时交错执行导致状态错乱：
  // - 带时间戳：ts <= 已处理最新时间戳的操作直接丢弃（迟到的旧操作不执行）
  // - 一次只做一个操作（锁）；执行中到达的新操作堆积为"最新操作"
  //   （只保留 ts 最大的，中间操作舍去）
  // - 执行完记录已完成时间戳：队列中若有更新操作（ts > 已处理）继续执行，否则整队丢弃
  let djOpBusy = false;
  let djOpQueued: { ts: number; run: () => Promise<void> | void } | null = null;
  let djOpLastTs = 0;

  function runDjOp(ts: number, run: () => Promise<void> | void): void {
    // 旧操作（已被更新操作覆盖/已完成）：直接丢弃。ts<=0（如 -1 的 seek 校准）
    // 不参与新旧判定，仅要求串行执行
    if (ts > 0 && ts <= djOpLastTs) return;
    if (djOpBusy) {
      // 在途：堆积为最新操作（ts 大者覆盖，中间操作舍去；ts 相等时后到覆盖）
      if (!djOpQueued || ts >= djOpQueued.ts) djOpQueued = { ts, run };
      return;
    }
    djOpBusy = true;
    if (ts > djOpLastTs) djOpLastTs = ts;
    void (async () => {
      try {
        await run();
      } catch (e) {
        console.warn("[MusicStore] DJ 操作执行失败:", e);
      } finally {
        djOpBusy = false;
        // 队列中最新操作比已完成的更新 → 继续执行，否则整队丢弃
        if (djOpQueued && (djOpQueued.ts <= 0 || djOpQueued.ts > djOpLastTs)) {
          const next = djOpQueued;
          djOpQueued = null;
          runDjOp(next.ts, next.run);
        } else {
          djOpQueued = null;
        }
      }
    })();
  }

  /**
   * 播放列表是否已加载完成（handlePlaylist 收到过歌单）。
   * 同步广播可能先于歌单加载到达：歌单未加载时 playlist 为空数组，
   * 不能据此判定"缺歌"触发 P2P 下载——本地可能其实有这首歌（用户明确已有的歌被误下载）。
   */
  let playlistLoaded = false;

  function ensureTransferWatch() {
    if (transferWatchTimer) return;
    transferWatchTimer = setInterval(() => {
      const t = songTransfer.value;
      const now = Date.now();
      if (t.state === "idle") return;
      const stuck =
        t.state === "requesting"
          ? now - t.startedAt > TRANSFER_TIMEOUT_MS
          : t.state === "downloading" && lastChunkAt > 0 && now - lastChunkAt > TRANSFER_TIMEOUT_MS;
      if (!stuck) return;
      if (transferRetry < TRANSFER_MAX_RETRY) {
        // 超时自动续传：从已成功保存的分片序号继续请求（断点续传），
        // 避免"完全重传"从 0 开始再次卡在同一位置（每次机会阈值低，不干等）
        transferRetry += 1;
        console.warn(
          `[MusicStore] 传歌卡住超时，从第 ${t.received} 片续传 ${transferRetry}/${TRANSFER_MAX_RETRY}:`,
          t.songName,
        );
        const songId = t.songName;
        const fromChunk = t.received; // 已成功保存的分片数 = 续传起点
        lastChunkAt = 0;
        songTransfer.value = {
          state: "requesting",
          songName: songId,
          received: fromChunk,
          total: 0,
          startedAt: now,
          retryCount: transferRetry,
          channel: null,
        };
        void musicSyncRequestSong(songId, fromChunk).catch((e) => {
          console.warn("[MusicStore] 续传请求失败:", e);
        });
      } else {
        // 重试耗尽 → 降级为"无这首歌"（不再卡住曲名）
        console.warn("[MusicStore] 传歌多次重试失败，降级为无这首歌:", t.songName);
        const songId = t.songName;
        resetSongTransfer();
        lastChunkAt = 0;
        transferRetry = 0;
        if (songId) missingSongName.value = songId;
      }
    }, 1_000);
  }

  function stopTransferWatch() {
    if (transferWatchTimer) {
      clearInterval(transferWatchTimer);
      transferWatchTimer = null;
    }
  }

  // ===== Getters =====
  const progress = computed(() => {
    if (duration.value <= 0) return 0;
    // 钳制到 100：currentTime 防御性 clamp 后仍可能有极小越界（浮点/上报顺序）
    return Math.min(100, (currentTime.value / duration.value) * 100);
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
    action: "play" | "pause" | "seek" | "next",
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
      }
    } catch (e) {
      console.warn("[MusicStore] DJ 广播失败:", e);
    }
  }

  /**
   * DJ 模式：广播全量状态快照（music:sync_state）
   *
   * 取代旧的动作消息，携带完整状态：song_id + playing + position_ms + volume + transfer_mode。
   * 听众端据此应用完整状态（切歌/暂停/进度校准/传歌方案），新听众加入也能立即对齐。
   * 服务器需将 music:sync_state 广播给房间全体（见 server-planning/API-implementation.md）。
   */
  async function broadcastSyncState() {
    if (!syncEnabled.value || !isDj.value) return;
    const settingsStore = useSettingsStore();
    try {
      await musicSyncState({
        songId: trackName.value || "",
        playing: playing.value,
        positionMs: Math.floor(currentTime.value * 1000),
        volume: volume.value,
        transferMode: settingsStore.settings.syncTransferMode,
      });
    } catch (e) {
      console.warn("[MusicStore] DJ 全量状态广播失败:", e);
    }
  }

  /** DJ 切换传歌方案并广播（immediate / wait_all） */
  async function setTransferMode(mode: "immediate" | "wait_all") {
    const settingsStore = useSettingsStore();
    await settingsStore.update("syncTransferMode", mode);
    transferMode.value = mode;
    if (syncEnabled.value && isDj.value) {
      try {
        await musicSyncSetConfig(mode);
      } catch (e) {
        console.warn("[MusicStore] 广播传歌方案失败:", e);
      }
    }
  }

  /** 切换播放/暂停 */
  async function togglePlay() {
    try {
      await musicTogglePlay();
      // 等待本地状态事件回传后广播全量状态（播放状态 + 进度）
      if (syncEnabled.value && isDj.value) {
        window.setTimeout(() => void broadcastSyncState(), 150);
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
        window.setTimeout(() => void broadcastSyncState(), 250);
      }
    } catch (e) {
      console.error("[MusicStore] next error:", e);
    }
  }

  /** 上一首 */
  async function prev() {
    try {
      await musicPrev();
      if (syncEnabled.value && isDj.value) {
        window.setTimeout(() => void broadcastSyncState(), 250);
      }
    } catch (e) {
      console.error("[MusicStore] prev error:", e);
    }
  }

  /** 跳转到指定时间 */
  async function seek(seconds: number) {
    // 目标钳制到 [0, 当前歌曲时长]：DJ 广播/下载校准的目标可能超出当前歌曲
    // 时长（旧歌信息覆盖新歌/信息堆积），超界 seek 会导致进度条超出最大值
    const dur = duration.value;
    if (dur > 0) {
      seconds = Math.min(Math.max(seconds, 0), dur);
    }
    try {
      await musicSeek(seconds);
      if (syncEnabled.value && isDj.value) {
        window.setTimeout(() => void broadcastSyncState(), 250);
      }
    } catch (e) {
      console.error("[MusicStore] seek error:", e);
    }
  }

  /**
   * 同步校准 seek（带容忍度）：|本地进度 - 目标| 超过 SYNC_SEEK_TOLERANCE_S 才跳转。
   * 用于听众端应用 DJ sync_state / music:state 时的进度对齐，
   * 避免广播频繁时反复 seek 造成播放回跳（如听到 AABCD 重复开头）。
   *
   * 走 DJ 操作串行队列：校准 seek 与切歌/播放暂停互斥（一次只做一个播放器操作），
   * 多条 DJ 信息同时进入时按"最新优先"串行执行，不会交错。
   */
  function seekIfFar(targetSec: number): void {
    // ts=-1：只参与串行执行、不参与新旧判定——校准目标的新鲜度由调用方
    // （applySyncState/applyMusicState 的 lastSyncTs 过滤 + DJ 操作 ts）保证，
    // 避免本地 Date.now() 与服务器时间戳偏差导致 DJ 广播被误判为"旧操作"丢弃
    runDjOp(-1, async () => {
      // 目标超界（DJ 位置超过当前歌曲时长）→ 视为旧歌信息覆盖新歌/信息堆积，
      // 直接忽略不跳转（DJ 信息跳转的原子防护：新歌刚加载时旧广播不干扰）
      if (duration.value > 0 && targetSec > duration.value) return;
      if (Math.abs(currentTime.value - targetSec) > SYNC_SEEK_TOLERANCE_S) {
        await seek(targetSec);
      }
    });
  }

  /** 设置音量（0-1）。音量纯本地，不同步到房间（DJ 不控制听众音量） */
  async function setVolume(v: number) {
    volume.value = v;
    try {
      await musicSetVolume(v);
      await saveVolume(v);
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
      // 播放成功：本地已确认有这首歌，清除"无这首歌"提示
      localHasSongs.add(songName);
      missingSongName.value = null;
      if (syncEnabled.value && isDj.value) {
        window.setTimeout(() => void broadcastSyncState(), 250);
      }
    } catch (e) {
      console.error("[MusicStore] playSong error:", e);
      // 不再自动触发 P2P 下载：本地缺歌场景由 applySyncState / applyMusicState 的
      // 缺歌分支驱动 startSongTransfer。这里误触发会删掉 localHasSongs 的"本地已有"
      // 标记，导致"刚下载完的歌"在 DJ 暂停时被重新判为缺歌（显示"获取歌曲中 2%"）。
      // 文件刚合并/播放器未就绪导致的播放失败应保持已有标记，等下次 sync_state 驱动重播。
    }
  }

  // ===== P2P 传歌（听众侧下载 / DJ 侧上传，服务器中转分片） =====

  /** 中断当前 P2P 传输并复位全部传输状态（DJ 切歌/主动取消时调用） */
  function abortCurrentTransfer(): void {
    activeP2PReceive?.close();
    activeP2PReceive = null;
    resetSongTransfer();
    lastChunkAt = 0;
    transferRetry = 0;
  }

  /**
   * 听众侧：请求拉取 DJ 正在播放但本地缺失的歌曲
   *
   * @param fromChunk 断点续传：从该分片序号继续请求（0 = 从头传输）。
   * 超时重试时传入已成功保存的分片数，避免"完全重传"再次卡在同一位置。
   *
   * 幂等：同一首歌的传输已在进行时不重复请求；
   * DJ 切歌后目标变了，若旧歌传输还挂着（中断/卡住），直接中断旧传输启动新歌下载，
   * 避免"DJ 切歌后这边没反应"。
   */
  async function startSongTransfer(songId: string, fromChunk = 0) {
    // 再次传输 = 视为本地暂时缺失（若之前合并过，先移除本地已有标记）
    localHasSongs.delete(songId);
    const t = songTransfer.value;
    if (t.state !== "idle") {
      if (t.songName === songId) return; // 同一首歌已在传输
      // 目标歌已变：中断旧传输（残留分片由 Rust finalize 清理，同名覆盖），启动新的
      console.warn("[MusicStore] DJ 已切歌，中断旧传输:", t.songName, "→", songId);
      abortCurrentTransfer();
    }
    transferRetry = 0;
    songTransfer.value = {
      state: "requesting",
      songName: songId,
      received: fromChunk,
      total: 0,
      startedAt: Date.now(),
      retryCount: 0,
      channel: null,
    };
    // Phase 1：首次传输（非续传）且知道 DJ 身份 → 挂起 WebRTC 直连接收。
    // DJ 侧收到 p2p 标志后优先尝试直传；失败自动回退服务器中转（music:song_chunk 路径照常）。
    const canP2P = fromChunk === 0 && !!djUserId.value;
    if (canP2P) {
      activeP2PReceive?.close();
      activeP2PReceive = p2pReceive({
        peerId: djUserId.value as string,
        role: "answerer",
        timeoutMs: 8_000,
        onChunk: async (chunk, index, totalChunks) => {
          const res = await musicReceiveSongChunkBin(songId, index, totalChunks, Array.from(chunk));
          if (!res.success) throw new Error(res.error ?? "分片落盘失败");
          songTransfer.value.state = "downloading";
          songTransfer.value.total = totalChunks;
          songTransfer.value.received += 1;
          lastChunkAt = Date.now();
        },
        callbacks: {
          // v4.6.0：WebRTC 建连成功 → 标记"P2P 直连中"，前端可明确观察到通道
          onOpen: () => {
            songTransfer.value.channel = "p2p";
          },
          onComplete: () => {
            // 直连收齐 → 关闭挂起 + 直接合并（不经服务器 transfer_done）
            const total = songTransfer.value.total;
            activeP2PReceive = null;
            void finalizeTransfer(songId, total).catch(() => {});
          },
          onError: (err) => {
            // 建连失败/通道中断 → 回退服务器中转（现有请求已在途，music:song_chunk 会继续）
            activeP2PReceive = null;
            songTransfer.value.channel = "server";
            console.warn("[MusicStore] P2P 直连失败，回退服务器中转:", err);
          },
        },
      });
    }
    try {
      await musicSyncRequestSong(songId, fromChunk, canP2P);
      // 等待服务器分配持有者：DJ 走 P2P 直传（DataChannel 分片）或服务器中转（music:song_chunk）
    } catch (e) {
      console.warn("[MusicStore] 请求传歌失败:", e);
      songTransfer.value = { state: "failed", songName: songId, received: 0, total: 0, startedAt: 0, retryCount: 0, channel: null };
    }
  }

  /** 听众侧：保存服务器转发来的歌曲分片（单片失败自动重试一次，避免永久卡进度） */
  async function handleSongChunk(evt: Record<string, unknown>) {
    // 收到服务器中转分片 → DJ 走的是服务器路径（或 P2P 失败已回退）→ 关闭挂起的 P2P 接收
    if (activeP2PReceive) {
      activeP2PReceive.close();
      activeP2PReceive = null;
    }
    const songId = typeof evt.song_id === "string" ? evt.song_id : "";
    if (!songId || songId !== songTransfer.value.songName) return;
    // v4.6.0：收到服务器分片 → 明确标记"服务器中转"通道（前端可观察）
    songTransfer.value.channel = "server";
    const chunkIndex = Number(evt.chunk_index ?? 0);
    const totalChunks = Number(evt.total_chunks ?? 0);
    const dataBase64 = typeof evt.data_base64 === "string" ? evt.data_base64 : "";
    if (!dataBase64 || totalChunks <= 0) return;
    const saveOnce = async (): Promise<boolean> => {
      try {
        const res = await musicReceiveSongChunk(songId, chunkIndex, totalChunks, dataBase64);
        return res.success;
      } catch (e) {
        console.warn("[MusicStore] 保存分片失败:", e);
        return false;
      }
    };
    let ok = await saveOnce();
    if (!ok) {
      // 单片失败重试一次
      ok = await saveOnce();
    }
    if (!ok) return;
    songTransfer.value.state = "downloading";
    songTransfer.value.total = totalChunks;
    songTransfer.value.received += 1;
    lastChunkAt = Date.now();
  }

  /**
   * 听众侧：传输完成（服务器 transfer_done 或 P2P 直连收齐）→ 合并文件 → 播放
   *
   * @param songId 目标歌曲
   * @param totalChunks 分片总数（服务器 transfer_done 携带，缺失时用已记录值）
   */
  async function finalizeTransfer(songId: string, totalChunks: number): Promise<void> {
    resetSongTransfer();
    lastChunkAt = 0;
    transferRetry = 0;
    try {
      const res = await musicFinalizeSong(songId, totalChunks);
      if (res.success) {
        missingSongName.value = null;
        // 本地已确认存在（歌单刷新有延迟，先记录避免误判缺歌重新触发 P2P）
        localHasSongs.add(songId);
        // 从 DJ 处下载的歌曲自动打上 DJ 名字标签（识别歌曲来源）
        if (djName.value) {
          void updateSongTag(songId, djName.value, null);
        }
        await requestPlaylist();
        if (transferMode.value === "wait_all") {
          // wait_all：不立即播放，等待全员就绪（服务器广播 songs_ready → DJ 从头播放 → sync_state 驱动）
          waitingForSongs.value = true;
          return;
        }
        // immediate：下载与播放分离——
        // 合并完成后【不立即 playSong】（播放器保持暂停"无感"），请求 DJ 实时状态，
        // 等 sync_state 回发后由 applySyncState 一次性切歌 + 校准。
        // 旧实现"playSong 从头播 + 800ms 后 seek(pendingSyncPosition) + 又 seekIfFar"
        // 多次驱动播放器：seek fallback 的 skip_duration 惰性跳过窗口内 sink 空缓冲
        // 会被 is_song_ended 误判"播完"自动切歌 → 跳到 DJ 进度后又跳回 2s/3s 从头播下一首。
        void musicSyncRequestState().catch(() => {});
        // 兜底：服务器长时间不回 state（旧版不支持）→ 本地直接播放 + 校准
        window.setTimeout(() => {
          if (trackName.value === songId) return; // 已由 DJ 状态驱动完成切歌
          runDjOp(-1, async () => {
            if (songId !== trackName.value) await playSong(songId);
            if (pendingSyncPosition > 0) {
              const target = pendingSyncPosition;
              pendingSyncPosition = 0;
              seekIfFar(target);
            }
          });
        }, 3000);
      } else {
        missingSongName.value = songId;
      }
    } catch (e) {
      console.warn("[MusicStore] 合并歌曲失败:", e);
      missingSongName.value = songId;
    }
  }

  /** 听众侧：传输完成（服务器 transfer_done）→ 合并 → 播放 */
  async function handleTransferDone(evt: Record<string, unknown>) {
    const songId = typeof evt.song_id === "string" ? evt.song_id : "";
    if (!songId) return;
    // 切歌打断后的迟到 transfer_done（旧歌）：当前没有这首歌的传输 → 忽略。
    // 否则会在切歌后仍 finalize 并播放旧歌，导致被同步端切歌时间与 DJ 出现时差
    // （"下载完播放旧歌"与"首首歌被误下载"同根：下载相关事件都必须按当前目标歌特判）
    if (songTransfer.value.songName !== songId) return;
    // total_chunks 以服务器 transfer_done 携带为准，缺失时回退到已记录值
    const totalChunks =
      Number(evt.total_chunks) > 0
        ? Number(evt.total_chunks)
        : songTransfer.value.total;
    await finalizeTransfer(songId, totalChunks);
  }

  /** 听众侧：传输失败 → 降级为"无这首歌"提示（切歌打断后的旧歌迟到事件不污染当前状态） */
  function handleTransferFailed(evt: Record<string, unknown>) {
    const songId = typeof evt.song_id === "string" ? evt.song_id : "";
    const t = songTransfer.value;
    // 正在传输其他歌时收到旧歌的迟到 transfer_failed：不打断当前传输、不设缺歌提示
    if (t.state !== "idle") {
      if (t.songName !== songId) return;
      songTransfer.value = { state: "idle", songName: "", received: 0, total: 0, startedAt: 0, retryCount: 0, channel: null };
    }
    // 仅当失败的是当前曲目时才提示"无这首歌"（迟到的旧歌失败不污染提示）
    if (songId && songId === trackName.value) missingSongName.value = songId;
  }

  /** DJ/持有者侧：服务器要求传歌 → 逐片读取并回传（music:offer_song） */
  async function handleSongRequested(evt: Record<string, unknown>) {
    const songId = typeof evt.song_id === "string" ? evt.song_id : "";
    if (!songId) return;
    // 并发守卫：同一首歌只开一个传输循环（服务器"一传多"时可能重复收到请求）
    if (activeTransfers.has(songId)) return;
    activeTransfers.add(songId);
    // 传歌期间每 5s 广播一次 sync_state：听众下载可能耗时较久，
    // 若不广播，听众的 pendingSyncPosition 停留在下载开始时（seek 会回到旧位置，表现为"从头播放"）
    const progressSync = setInterval(() => void broadcastSyncState(), 5000);
    try {
      const fromChunk = Number(evt.from_chunk ?? 0);
      // Phase 1：请求方支持 P2P 且非续传 → 先尝试 WebRTC 直传（媒体数据不经服务器）。
      // 失败（建连超时/切歌/读片失败）自动回退下面的服务器中转循环。
      const requesterId = typeof evt.requester_user_id === "string" ? evt.requester_user_id : "";
      if (evt.p2p && requesterId && fromChunk === 0) {
        const p2pOk = await tryP2PTransfer(songId, requesterId);
        if (p2pOk) return; // 直传完成，服务器传输状态已由 transfer_done 清理
        console.warn("[MusicStore] P2P 直传失败，回退服务器中转:", songId);
      }
      // 断点续传：服务器重试 request_song 时可能带 from_chunk（听众已保存的分片数），
      // 从该片继续读取回传，避免完全重传（听众超时续传时使用）
      let idx = fromChunk;
      let totalChunks = 0;
      while (true) {
        // 可打断：DJ 已切歌（不再播放这首）→ 立即中断上传，让服务器清理传输状态。
        // 否则旧歌会继续传完整个文件，听众端一直收到旧歌分片（切歌被下载拖住）
        if (songId !== trackName.value) {
          console.warn("[MusicStore] DJ 已切歌，中断本地上传:", songId, "→", trackName.value);
          void musicSyncTransferFailed(songId).catch(() => {});
          return;
        }
        const res = await musicReadSongChunk(songId, idx);
        if (!res.success) {
          // 歌曲不存在/读取失败 → 通知服务器传输失败
          void musicSyncTransferFailed(songId).catch(() => {});
          return;
        }
        totalChunks = res.total_chunks ?? 0;
        await musicSyncOfferSong({
          songId,
          chunkIndex: idx,
          totalChunks,
          chunkSize: res.chunk_size ?? 0,
          dataBase64: res.data_base64 ?? "",
        });
        idx += 1;
        if (totalChunks === 0 || idx >= totalChunks) break;
        // 轻微节流，避免 170KB×N 的 WS 消息瞬时堆积（传输可被打断，节流可更小）
        await new Promise((r) => setTimeout(r, 5));
      }
      await musicSyncTransferDone(songId);
    } catch (e) {
      console.warn("[MusicStore] 传歌失败:", e);
      void musicSyncTransferFailed(songId).catch(() => {});
    } finally {
      clearInterval(progressSync);
      activeTransfers.delete(songId);
    }
  }

  /**
   * Phase 1：P2P 直传（WebRTC DataChannel，媒体数据不经服务器转发）。
   * 持有者作为 offerer 推送分片；成功返回 true。
   * 失败（建连超时/通道中断/切歌/读片失败）返回 false，由调用方回退服务器中转。
   */
  async function tryP2PTransfer(songId: string, requesterId: string): Promise<boolean> {
    return new Promise((resolve) => {
      let finished = false;
      const finish = (ok: boolean) => {
        if (!finished) {
          finished = true;
          resolve(ok);
        }
      };
      void (async () => {
        try {
          // 先读第一片拿 total_chunks / chunk_size，估算文件总字节数（供 meta 通知接收端）
          const first = await musicReadSongChunkBin(songId, 0);
          if (!first.success || !first.total_chunks || !first.chunk_size) {
            finish(false);
            return;
          }
          const totalChunks = first.total_chunks;
          const chunkSize = first.chunk_size;
          p2pSend({
            peerId: requesterId,
            role: "offerer",
            totalBytes: totalChunks * chunkSize, // 估算：最后一片不满，接收端按 totalChunks 判定收齐
            chunkSize,
            timeoutMs: 8_000,
            sendChunk: async (index) => {
              // 中断守卫：DJ 已切歌 → 抛错中断（p2p 层触发 onError → 回退服务器中转）
              if (songId !== trackName.value) throw new Error("DJ 已切歌");
              const res = await musicReadSongChunkBin(songId, index);
              if (!res.success || !res.data) throw new Error(res.error ?? "读取分片失败");
              return new Uint8Array(res.data);
            },
            callbacks: {
              onComplete: () => {
                // 直传完成 → 通知服务器清理传输状态（含 wait_all 检查）
                void musicSyncTransferDone(songId).catch(() => {});
                finish(true);
              },
              onError: (err) => {
                console.warn("[MusicStore] P2P 直传失败:", err);
                finish(false);
              },
            },
          });
        } catch (e) {
          console.warn("[MusicStore] P2P 直传初始化失败:", e);
          finish(false);
        }
      })();
    });
  }

  /** wait_all 模式：服务器通知 DJ 有听众缺歌，DJ 暂停等待全员下载 */
  async function handleSongWaiting(evt: Record<string, unknown>) {
    waitingForSongs.value = true;
    // DJ 暂停播放（若正在播放），等全员就绪后统一从头播放
    if (playing.value) void togglePlay();
  }

  /** wait_all 模式：服务器通知全员就绪，DJ 从头播放并广播状态 */
  async function handleSongsReady(evt: Record<string, unknown>) {
    waitingForSongs.value = false;
    if (trackName.value && !playing.value) {
      void togglePlay();
      window.setTimeout(() => void seek(0), 300);
    }
    window.setTimeout(() => void broadcastSyncState(), 400);
  }

  /** 删除歌曲 */
  async function deleteSong(songName: string): Promise<boolean> {
    try {
      const result = await musicDeleteSong(songName);
      if (result.success) {
        // 删除成功：本地已无该歌，下次 DJ 播放时需重新 P2P
        localHasSongs.delete(songName);
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
    missingSongName.value = null;
  }

  function handleStatus(payload: MusicStatus) {
    playing.value = payload.playing;
    trackName.value = payload.name;
    currentTime.value = payload.current;
    duration.value = payload.duration;
    if (payload.has_prev !== undefined) hasPrev.value = payload.has_prev;
    if (payload.play_mode !== undefined) playMode.value = payload.play_mode;
    // 音量 UI 跟随播放器实际音量：status 是真相源，避免前端持久化
    // 丢失/被覆盖时出现"实际音量是上次的、UI 却显示满格"不一致
    if (payload.volume !== undefined) volume.value = payload.volume;
    playError.value = null;
    missingSongName.value = null;
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
    // 防御：播放位置不应超过当前歌曲时长（seek 乱序/旧信息堆积时可能越界）
    if (duration.value > 0 && currentTime.value > duration.value) {
      currentTime.value = duration.value;
    }
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
    // DJ 模式下歌自然结束自动切歌 → 尽快广播全量状态（听众端跟随切歌，而非只同步动作；
    // 100ms：trackName/duration 已就绪，广播越快听众端切歌打断下载越及时，时差越小）
    if (syncEnabled.value && isDj.value) {
      window.setTimeout(() => void broadcastSyncState(), 100);
    }
  }

  function handleNoMusic() {
    hasMusic.value = false;
    playing.value = false;
    trackName.value = "";
    currentTime.value = 0;
    duration.value = 0;
    // 同步听歌无歌可播时复位 P2P 传输状态
    songTransfer.value = { state: "idle", songName: "", received: 0, total: 0, startedAt: 0, retryCount: 0, channel: null };
  }

  function handlePlayError(payload: MusicPlayErrorPayload) {
    playing.value = false;
    playError.value = payload.message || "播放失败";
  }

  function handlePlaylist(payload: PlaylistData) {
    const firstLoad = !playlistLoaded;
    playlistLoaded = true;
    const songs = payload.songs || [];
    if (songs.length > 0 && typeof songs[0] === "object") {
      const songObjs = songs as PlaylistSong[];
      playlist.value = songObjs.map((s) => s.name);
      playlistTags.value = {};
      songObjs.forEach((s) => {
        if (s.name) {
          // 歌单 = 本地真实存在的歌曲：全部标记"本地已有"，
          // 避免应用重启后 localHasSongs 为空期间 DJ 播本地歌被误判缺歌触发下载
          localHasSongs.add(s.name);
          playlistTags.value[s.name] = {
            name: s.tag || "自定义",
            color: s.tagColor ?? null,
          };
        }
      });
    } else {
      playlist.value = songs as string[];
      (songs as string[]).forEach((n) => localHasSongs.add(n));
    }
    if (payload.current_song !== undefined) {
      trackName.value = payload.current_song;
    }
    // 歌单刷新后，之前提示"无这首歌"的歌若已出现在歌单中则清除提示
    if (missingSongName.value && playlist.value.includes(missingSongName.value)) {
      missingSongName.value = null;
    }
    // 歌单首次加载完成：同步广播可能早于歌单到达而被守卫跳过（playlist 空数组
    // 会被误判"缺歌"触发 P2P 下载），主动重取 DJ 最新状态对齐
    if (firstLoad && syncEnabled.value && !isDj.value) {
      void musicSyncRequestState().catch(() => {});
    }
  }

  function handleSongMissing(payload: MusicSongMissingPayload) {
    playError.value = payload.message || "原歌曲已消失";
  }

  // ===== 同步听歌 =====

  /**
   * 应用"自动切歌"开关：同步听歌听众端（syncEnabled && !isDj）禁用——
   * 播完保持等待，由 DJ 的 sync_state 驱动切歌；DJ / 未开同步保持自动切歌。
   *
   * 状态转换安全说明：
   * - 听众播完等待中 → 退出同步（setSyncEnabled(false)）→ 恢复自动切歌，
   *   Rust 进度任务 200ms 内检测到"播完"自动切本地下一首，无缝接续
   * - 听众播完等待中 → 成为 DJ（dj_changed）→ 恢复自动切歌（DJ 需要自然切歌并广播）
   * - DJ → 听众（dj_changed 他人/空）→ 禁用自动切歌，回归等待
   */
  function applyAutoNext() {
    const enabled = !(syncEnabled.value && !isDj.value);
    void musicSetAutoNext(enabled).catch(() => {});
  }

  /** 开启/关闭同步听歌（由自习室面板控制） */
  function setSyncEnabled(enabled: boolean) {
    syncEnabled.value = enabled;
    if (enabled) {
      // 开启同步时应用本机设置的传歌方案，并启动传输兜底检查
      const settingsStore = useSettingsStore();
      transferMode.value = settingsStore.settings.syncTransferMode;
      ensureTransferWatch();
      // 提前加载本地歌单：同步广播可能早于歌单到达，playlist 空数组会被误判
      // "缺歌"触发 P2P 下载（本地明确有的歌也被误下载）
      void requestPlaylist();
      // 应用缓存的状态快照（若加入房间时服务器已补发过 sync_state）
      if (lastSyncState) {
        const snap = lastSyncState;
        lastSyncState = null;
        if (!isDj.value) applySyncState(snap);
      }
      // 主动向服务器请求当前同步状态（服务器需支持 music:request_state）
      void musicSyncRequestState().catch(() => {});
    } else {
      // 关闭后复位 DJ 状态（服务器 DJ 由新申请者接管）与 P2P 状态
      isDj.value = false;
      djName.value = "";
      djUserId.value = null;
      waitingForSongs.value = false;
      resetSongTransfer();
      lastChunkAt = 0;
      stopTransferWatch();
    }
    // 自动切歌开关跟随同步状态：开启=听众等待 DJ；关闭=恢复本地自动播放
    applyAutoNext();
  }

  /** 申请成为 DJ */
  async function requestDj() {
    const t0 = performance.now();
    try {
      await musicSyncRequestDj();
      // 诊断打点：如果 UI 卡顿，这里耗时异常可定位到 Rust/WS 链路
      console.warn(`[MusicStore] requestDj invoke 耗时 ${(performance.now() - t0).toFixed(1)}ms`);
    } catch (e) {
      console.warn("[MusicStore] 申请 DJ 失败:", e);
    }
  }

  /** 应用服务器广播的播放动作（旧协议 music:state，听众端），含网络延迟校准 */
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
    // 广播新旧判定：时间戳更小的迟到旧广播直接忽略（旧状态不覆盖新状态）。
    // 与进度方向无关——DJ 手动回退/前进都是新广播（ts 更大），都能正常应用
    if (ts > 0 && ts < lastSyncTs) return;
    if (ts > lastSyncTs) lastSyncTs = ts;

    if (action === "play") {
      const songId = evt.song_id;
      if (typeof songId === "string" && songId && songId !== trackName.value) {
        // DJ 切歌：若正在 P2P 传输旧歌，立即中断（避免误触/快速切歌时旧歌继续下载并播出来）
        if (songTransfer.value.state !== "idle" && songTransfer.value.songName !== songId) {
          console.warn("[MusicStore] DJ 切歌，中断旧歌传输:", songTransfer.value.songName, "→", songId);
          abortCurrentTransfer();
        }
        // 歌单未加载：playlist 为空数组，不能据此判定"缺歌"（本地明确有的歌会被
        // 误判触发 P2P 下载）。等歌单加载完成后由 handlePlaylist 重取状态/后续广播驱动。
        if (!playlistLoaded) return;
        // 本地歌单不含该歌 → 触发 P2P 拉取（服务器未支持时降级为"无这首歌"）
        // 传输中的歌始终视为"缺失"：歌单刷新可能在传输完成前把该歌加入
        // localHasSongs（本地其实还没有完整文件），此时不能放弃下载去播放
        const transferring =
          songTransfer.value.state !== "idle" && songTransfer.value.songName === songId;
        if (!playlist.value.includes(songId) && (!localHasSongs.has(songId) || transferring)) {
          pendingSyncPosition = posSec;
          missingSongName.value = songId;
          // 下载与播放分离：缺歌期间播放器只收"暂停"信号（保持无感），
          // 下载完成后由 handleTransferDone 请求 DJ 状态，一次性切歌 + 校准
          if (playing.value) void togglePlay();
          void startSongTransfer(songId);
          return;
        }
        pendingSyncPosition = 0;
        missingSongName.value = null;
        // 播放器副作用入队（串行）：切歌 → 稍后校准到 DJ 进度
        runDjOp(ts, async () => {
          await playSong(songId);
          // 播放器加载需要时间，稍后跳转到目标位置（带容忍度，避免小偏差回跳）
          window.setTimeout(() => seekIfFar(posSec), 800);
        });
      } else {
        runDjOp(ts, async () => {
          if (!playing.value) await togglePlay();
          seekIfFar(posSec);
        });
      }
    } else if (action === "pause") {
      runDjOp(ts, async () => {
        if (playing.value) await togglePlay();
        seekIfFar(posSec);
      });
    } else if (action === "seek") {
      seekIfFar(posSec);
    } else if (action === "next") {
      runDjOp(ts, async () => {
        await next();
      });
    }
  }

  /** 应用 DJ 全量状态（music:sync_state），听众端：切歌 + 播放状态 + 进度 + 音量 + 传歌方案 */
  function applySyncState(evt: Record<string, unknown>) {
    const songId = evt.song_id;
    const djPlaying = evt.playing === true;
    const positionMs = Number(evt.position_ms ?? 0);
    const ts = Number(evt.timestamp_server ?? 0);
    let pos = positionMs;
    if (ts > 0) {
      pos += Math.max(0, Date.now() - ts);
    }
    const posSec = Math.floor(pos / 1000);
    // 广播新旧判定：时间戳更小的迟到旧广播直接忽略（旧状态不覆盖新状态）。
    // 与进度方向无关——DJ 手动回退/前进都是新广播（ts 更大），都能正常应用
    if (ts > 0 && ts < lastSyncTs) return;
    if (ts > lastSyncTs) lastSyncTs = ts;

    // 音量不同步：DJ 不控制听众音量，sync_state 里的 volume 字段忽略（音量纯本地）
    // 传歌方案同步
    if (evt.transfer_mode === "immediate" || evt.transfer_mode === "wait_all") {
      transferMode.value = evt.transfer_mode;
    }

    if (typeof songId === "string" && songId) {
      // DJ 切歌（本地当前歌曲不同）
      if (songId !== trackName.value) {
        // DJ 切歌：若正在 P2P 传输旧歌，立即中断（避免误触/快速切歌时旧歌继续下载并播出来）
        if (songTransfer.value.state !== "idle" && songTransfer.value.songName !== songId) {
          console.warn("[MusicStore] DJ 切歌，中断旧歌传输:", songTransfer.value.songName, "→", songId);
          abortCurrentTransfer();
        }
        // 歌单未加载：同 applyMusicState——playlist 空数组不能判定"缺歌"，
        // 等待歌单加载完成（handlePlaylist 重取状态/后续广播）再处理
        if (!playlistLoaded) return;
        // 本地缺歌 → 触发 P2P 拉取；传输期间暂存 DJ 进度，合并完成后 seek
        // 传输中的歌始终视为"缺失"：歌单刷新可能在传输完成前把该歌加入
        // localHasSongs（本地其实还没有完整文件），此时不能放弃下载去播放
        const transferring =
          songTransfer.value.state !== "idle" && songTransfer.value.songName === songId;
        if (!playlist.value.includes(songId) && (!localHasSongs.has(songId) || transferring)) {
          pendingSyncPosition = posSec;
          missingSongName.value = songId;
          if (playing.value) void togglePlay();
          void startSongTransfer(songId);
          return;
        }
        pendingSyncPosition = 0;
        missingSongName.value = null;
        waitingForSongs.value = false;
        // 播放器副作用入队（串行）：切歌 → 按 DJ 播放状态暂停/恢复 → 稍后校准。
        // 下载与播放分离：缺歌分支只发"暂停"信号，这里由 DJ 状态一次性驱动切歌，
        // 避免"从头播 + 800ms 后 seek + 又 seekIfFar"多次驱动播放器（seek fallback
        // 的 skip_duration 惰性跳过窗口会被误判"播完"自动切歌，跳回 2s/3s 从头播）
        runDjOp(ts, async () => {
          await playSong(songId);
          // 尊重 DJ 播放状态：DJ 处于暂停时只切歌不播放（避免"DJ 没放、听众却放了"）
          if (!djPlaying) {
            await new Promise((r) => setTimeout(r, 900));
            if (playing.value) await togglePlay();
          }
          // 稍后校准到 DJ 进度（带容忍度，避免反复 seek 回跳）
          window.setTimeout(() => seekIfFar(posSec), 800);
        });
      } else {
        // 同歌：校准播放状态 + 进度（DJ 开始播放，清除等待提示）
        waitingForSongs.value = false;
        runDjOp(ts, async () => {
          if (djPlaying && !playing.value) await togglePlay();
          if (!djPlaying && playing.value) await togglePlay();
          seekIfFar(posSec);
        });
      }
    } else {
      // DJ 无当前歌曲：仅同步播放状态
      runDjOp(ts, async () => {
        if (djPlaying && !playing.value) await togglePlay();
        if (!djPlaying && playing.value) await togglePlay();
      });
    }
  }

  /** 处理 WS 推送的 music:* 事件（由 MusicPlayer.vue 监听 ws-event 转发） */
  function handleSyncWsEvent(payload: unknown) {
    if (!payload || typeof payload !== "object") return;
    const evt = payload as Record<string, unknown>;
    switch (evt.type) {
      case "peer:offer":
      case "peer:answer":
      case "peer:ice":
      case "peer:bye": {
        // P2P 信令（WebRTC 牵线）：服务器定向转发，路由给 p2p 模块
        handlePeerSignal(evt);
        break;
      }
      case "p2p:test_request": {
        // { from_user_id, from_username }：有人发起 P2P 连通性测试 → 自动挂起 WebRTC 接收，
        // 测完把结果回传给发起方（目标端无需打开设置面板）
        const from = typeof evt.from_user_id === "string" ? evt.from_user_id : "";
        if (!from) break;
        const fromName = typeof evt.from_username === "string" ? evt.from_username : "";
        console.warn("[MusicStore] 收到 P2P 测试请求:", fromName || from);
        const handle = p2pAcceptTest(from, {
          onComplete: (stats) => {
            void p2pTestResult({
              toUserId: from,
              ok: true,
              ms: stats.ms,
              speedBps: stats.speedBps,
              bytes: stats.bytes,
            }).catch((e) => console.warn("[MusicStore] 回传 P2P 测试结果失败:", e));
          },
          onError: (err) => {
            void p2pTestResult({
              toUserId: from,
              ok: false,
              ms: 0,
              speedBps: 0,
              bytes: 0,
              error: err,
            }).catch((e) => console.warn("[MusicStore] 回传 P2P 测试失败结果失败:", e));
          },
        });
        // 兜底：发起方 offer 一直没来 → 15s 后关闭挂起（防残留）
        window.setTimeout(() => handle.close(), 15_000);
        break;
      }
      case "p2p:test_result": {
        // 目标端回传的结果 → 转发给发起方设置面板 UI（P2PTestPanel）
        dispatchP2PTestResult(evt);
        break;
      }
      case "music:dj_changed": {
        // { dj_user_id, dj_username }
        const t0 = performance.now();
        const uid = typeof evt.dj_user_id === "string" ? evt.dj_user_id : null;
        djUserId.value = uid;
        djName.value = typeof evt.dj_username === "string" ? evt.dj_username : "";
        const me = useAuthStore().session?.id ?? null;
        const wasDj = isDj.value;
        isDj.value = !!uid && !!me && uid === me;
        // 自动切歌跟随 DJ 身份：成为 DJ 恢复自动切歌；退为听众则播完等待 DJ 信号
        applyAutoNext();
        // 我成为 DJ → 立即广播当前全量状态，让听众对齐
        if (isDj.value && !wasDj) {
          window.setTimeout(() => void broadcastSyncState(), 300);
        }
        // 诊断打点：dj_changed 处理若 >1s 说明同步长任务在这里（UI 卡顿定位）
        console.warn(`[MusicStore] dj_changed 处理耗时 ${(performance.now() - t0).toFixed(1)}ms`);
        break;
      }
      case "music:state": {
        // DJ 本地已生效（避免回环）/ 未开启同步 → 忽略
        if (!syncEnabled.value || isDj.value) return;
        applyMusicState(evt);
        break;
      }
      case "music:sync_state": {
        // 未开启同步：缓存最近一次状态，开启同步时立即应用（解决"加入已有 DJ 的同步没反应"）
        if (!syncEnabled.value) {
          lastSyncState = evt;
          return;
        }
        // DJ 本地已生效（避免回环）→ 忽略
        if (isDj.value) return;
        applySyncState(evt);
        break;
      }
      case "music:sync_config": {
        if (!syncEnabled.value) return;
        const mode = evt.transfer_mode;
        if (mode === "immediate" || mode === "wait_all") {
          transferMode.value = mode;
        }
        break;
      }
      case "music:state_request": {
        // 服务器转达：有听众请求当前状态（下载完成/刚加入需校准位置）→
        // DJ 立即广播一次实时 sync_state，让请求者拿到 DJ 广播时刻的实时进度
        // （配合 music:request_state：服务器收到请求后转给 DJ 触发实时广播）
        if (isDj.value) void broadcastSyncState();
        break;
      }
      case "music:volume": {
        // 音量本地化：DJ 不控制听众音量，忽略服务器转发的音量广播
        break;
      }
      case "music:playlist_updated": {
        if (!syncEnabled.value) return;
        void requestPlaylist();
        break;
      }
      // ===== P2P 传歌（服务器中转分片） =====
      case "music:song_requested": {
        // 服务器要求我（持有者/DJ）传输歌曲分片
        void handleSongRequested(evt);
        break;
      }
      case "music:song_chunk": {
        // 服务器转发来的歌曲分片 → 落盘
        void handleSongChunk(evt);
        break;
      }
      case "music:transfer_done": {
        // 传输完成 → 合并 → 播放
        void handleTransferDone(evt);
        break;
      }
      case "music:transfer_failed": {
        handleTransferFailed(evt);
        break;
      }
      case "music:song_waiting": {
        // wait_all：通知 DJ 有听众缺歌（DJ 暂停等待）；听众端同样显示等待提示
        waitingForSongs.value = true;
        if (isDj.value) void handleSongWaiting(evt);
        break;
      }
      case "music:songs_ready": {
        // wait_all：全员就绪，DJ 从头播放；听众端清除等待提示
        waitingForSongs.value = false;
        if (isDj.value) void handleSongsReady(evt);
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
    missingSongName,
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
    transferMode,
    waitingForSongs,
    songTransfer,
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
    applyAutoNext,
    requestDj,
    broadcastSyncState,
    setTransferMode,
    startSongTransfer,
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
