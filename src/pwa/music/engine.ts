/**
 * PWA 浏览器音频引擎（替代桌面端 Rust rodio 播放）
 *
 * 用单个 HTMLAudioElement 承担播放，向应用内事件总线 emit 与桌面端完全一致的事件
 * （music-ready / music-track-change / music-play-state / music-progress /
 *  music-volume-change / music-play-mode / music-playlist / music-no-music /
 *  music-play-error），复用的 MusicPlayer.vue + music store 的事件处理零改动消费。
 *
 * 模式语义：
 * - shuffle：自动播完随机下一首
 * - order：自动播完按顺序下一首（末尾回到第一首）
 * - loop：自动播完重复当前曲
 * - 手动 上一首/下一首 始终推进（shuffle 随机，其余顺序/回绕）
 *
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

import { emit as busEmit } from "../eventBus";
import type { ManifestSong } from "./types";
import { songUrl } from "./sources";
import { idbGetBlob } from "./idb";

export type PlayMode = "shuffle" | "order" | "loop";

const PROGRESS_THROTTLE_MS = 250;

class BrowserAudioEngine {
  private audio = new Audio();
  /** 歌名 → 歌曲信息 */
  private songInfo = new Map<string, ManifestSong>();
  /** 播放列表（歌名顺序） */
  private order: string[] = [];
  /** 当前播放下标 */
  private index = -1;
  private mode: PlayMode = "shuffle";
  private autoNextEnabled = true;
  /** P2P/本地收到的歌曲 object URL（IDB blob） */
  private localUrls = new Map<string, string>();
  /** 已加载曲名（避免同一首歌重复发 track-change） */
  private loadedName = "";
  /** 最近一次赋给 audio 的 src（判断"同一首歌重定位"） */
  private lastSrc = "";
  /** 自动播放被拦截后，是否已挂"点击续播"手势监听 */
  private gestureRetryBound = false;
  private lastProgressAt = 0;
  private pendingStartSec = 0;
  /** 用户自定义标签覆盖（歌名 → { name, color } | null） */
  private tagOverrides = new Map<string, { name: string; color: string | null }>();

  constructor() {
    const a = this.audio;
    a.preload = "auto";

    a.addEventListener("loadedmetadata", () => {
      const name = this.order[this.index];
      if (!name) return;
      this.loadedName = name;
      const dur = Number.isFinite(a.duration) ? Math.round(a.duration) : 0;
      busEmit("music-track-change", {
        name,
        duration: dur,
        has_prev: this.index > 0,
      });
      // startSec > 0：加载完成后立即 seek 到目标（替代桌面 skip_duration）
      if (this.pendingStartSec > 0) {
        const target = Math.min(this.pendingStartSec, dur || this.pendingStartSec);
        this.pendingStartSec = 0;
        try {
          a.currentTime = target;
        } catch {
          /* 忽略 */
        }
      }
    });

    a.addEventListener("timeupdate", () => {
      const now = Date.now();
      if (now - this.lastProgressAt < PROGRESS_THROTTLE_MS) return;
      this.lastProgressAt = now;
      const name = this.order[this.index];
      const dur = Number.isFinite(a.duration) ? Math.round(a.duration) : 0;
      busEmit("music-progress", {
        name: name || undefined,
        current: Math.floor(a.currentTime || 0),
        duration: dur,
      });
    });

    a.addEventListener("play", () => busEmit("music-play-state", { playing: true }));
    a.addEventListener("pause", () => busEmit("music-play-state", { playing: false }));

    a.addEventListener("ended", () => {
      busEmit("music-play-state", { playing: false });
      if (this.autoNextEnabled) {
        void this.advance();
      }
      // autoNext 关闭（同步听歌听众）：播完保持等待，由 DJ sync_state 驱动
    });

    a.addEventListener("error", () => {
      busEmit("music-play-error", { message: `无法播放《${this.order[this.index] ?? ""}》` });
    });
  }

  // ===== 播放列表 =====

  /** 设置歌单（manifest）并重建播放列表 */
  setPlaylist(songs: ManifestSong[]): void {
    this.songInfo.clear();
    this.order = [];
    for (const s of songs) {
      if (!s.name) continue;
      this.songInfo.set(s.name, s);
      this.order.push(s.name);
    }
    if (this.index >= this.order.length) this.index = -1;
    this.emitPlaylist();
    if (this.order.length === 0) {
      busEmit("music-no-music", undefined);
    }
  }

  get songCount(): number {
    return this.order.length;
  }

  get currentName(): string | null {
    return this.index >= 0 ? this.order[this.index] : null;
  }

  /** 查询歌曲信息（供分片读取等命令用） */
  getSongInfo(name: string): ManifestSong | undefined {
    return this.songInfo.get(name);
  }

  /** 设置用户自定义标签覆盖（music_update_tag 时调用） */
  setTagOverride(name: string, tag: { name: string; color: string | null } | null): void {
    if (tag) this.tagOverrides.set(name, tag);
    else this.tagOverrides.delete(name);
    this.emitPlaylist();
  }

  /** 解析可播放 URL：优先本地 IDB blob object URL，其次 manifest 来源 */
  private async resolveUrl(name: string): Promise<string> {
    const local = this.localUrls.get(name);
    if (local) return local;
    const info = this.songInfo.get(name);
    if (!info) throw new Error(`歌曲不存在: ${name}`);
    // P2P 收到的歌已落盘到 IDB → 用 blob URL
    const blob = await idbGetBlob(name);
    if (blob) {
      const url = URL.createObjectURL(blob);
      this.localUrls.set(name, url);
      return url;
    }
    return songUrl(name, info.source);
  }

  // ===== 播放控制 =====

  /**
   * 播放歌曲。startSec > 0 时"先定位后播放"（等价桌面端 skip_duration）：
   * - 同一首歌重定位（src 未变，loadedmetadata 不会重触发）→ 直接 seek 后播放；
   * - 换新歌 → 设置 pendingStartSec，等 loadedmetadata（其 handler 写入 currentTime）
   *   就绪后再 play()，杜绝"先播 0 再跳"（同步听歌校准的关键时序）。
   */
  async play(name: string, startSec = 0): Promise<void> {
    const idx = this.order.indexOf(name);
    if (idx < 0) throw new Error(`歌曲不在歌单中: ${name}`);
    this.index = idx;
    const url = await this.resolveUrl(name);
    const a = this.audio;
    const start = Math.max(0, startSec);
    const sameSource = this.lastSrc === url;

    if (start > 0 && sameSource) {
      // 同一首歌重定位：src 不变不会重新触发 loadedmetadata，直接 seek 后播放
      const dur = Number.isFinite(a.duration) ? a.duration : 0;
      a.currentTime = dur > 0 ? Math.min(start, dur) : start;
      await this.playNow();
      return;
    }

    this.pendingStartSec = start;
    this.lastSrc = url;
    a.src = url;
    if (start > 0) {
      // 未加载：等 metadata 就绪（loadedmetadata handler 已把 pendingStartSec 写入 currentTime）
      await this.waitForMetadata();
    }
    await this.playNow();
  }

  /** 播放（浏览器自动播放策略拦截时统一上报并抛错） */
  private async playNow(): Promise<void> {
    try {
      await this.audio.play();
    } catch (e) {
      // 自动播放策略：无用户手势的播放（如同步听歌 DJ 驱动）被浏览器拒绝。
      // 提示用户点击，并挂一次性手势监听——点击后自动续播（否则"点了也没用"）。
      if (e instanceof DOMException && e.name === "NotAllowedError") {
        busEmit("music-play-error", {
          message: "浏览器阻止了自动播放，请点击页面任意位置（点击后会自动继续）",
        });
        this.retryPlayOnGesture();
      } else {
        busEmit("music-play-error", { message: `播放失败: ${e instanceof Error ? e.message : String(e)}` });
      }
      throw e;
    }
  }

  /** 挂一次性用户手势监听：首次点击/按键后自动续播被拦截的播放 */
  private retryPlayOnGesture(): void {
    if (this.gestureRetryBound) return;
    this.gestureRetryBound = true;
    const tryResume = () => {
      this.gestureRetryBound = false;
      window.removeEventListener("pointerdown", tryResume);
      window.removeEventListener("keydown", tryResume);
      // 用户已交互 → 自动播放策略放行，续播（位置偏差由后续 sync_state 的 seekIfFar 精调）
      void this.audio.play().catch(() => {});
    };
    window.addEventListener("pointerdown", tryResume, { passive: true });
    window.addEventListener("keydown", tryResume);
  }

  /** 等待 metadata 就绪（loadedmetadata / readyState>=1 / 15s 超时兜底） */
  private waitForMetadata(timeoutMs = 15_000): Promise<void> {
    const a = this.audio;
    return new Promise((resolve) => {
      if (a.readyState >= 1) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        cleanup();
        // 超时兜底：继续播放（位置可能从 0 起，store 的 seekIfFar 会精调对齐）
        resolve();
      }, timeoutMs);
      const onMeta = () => {
        cleanup();
        resolve();
      };
      const onErr = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(timer);
        a.removeEventListener("loadedmetadata", onMeta);
        a.removeEventListener("error", onErr);
      };
      a.addEventListener("loadedmetadata", onMeta);
      a.addEventListener("error", onErr);
    });
  }

  async toggle(): Promise<void> {
    if (this.audio.paused) {
      if (!this.audio.src && this.order.length > 0) {
        await this.play(this.order[0]);
      } else {
        await this.audio.play();
      }
    } else {
      this.audio.pause();
    }
  }

  async next(): Promise<void> {
    if (this.order.length === 0) return;
    const nextIdx = this.pickNextIndex(false);
    this.index = nextIdx;
    const name = this.order[nextIdx];
    const url = await this.resolveUrl(name);
    this.pendingStartSec = 0;
    this.lastSrc = url;
    this.audio.src = url;
    try {
      await this.audio.play();
    } catch {
      /* 自动播放被拦截时保持加载态 */
    }
  }

  async prev(): Promise<void> {
    if (this.order.length === 0) return;
    // 播放超过 3s 时"上一首"回到本曲开头
    if (this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      return;
    }
    const prevIdx = this.index <= 0 ? this.order.length - 1 : this.index - 1;
    this.index = prevIdx;
    const name = this.order[prevIdx];
    const url = await this.resolveUrl(name);
    this.pendingStartSec = 0;
    this.lastSrc = url;
    this.audio.src = url;
    try {
      await this.audio.play();
    } catch {
      /* 忽略 */
    }
  }

  async seek(seconds: number): Promise<void> {
    const dur = Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
    const target = dur > 0 ? Math.min(Math.max(seconds, 0), dur) : Math.max(seconds, 0);
    this.audio.currentTime = target;
  }

  setVolume(v: number): void {
    const vol = Math.min(Math.max(v, 0), 1);
    this.audio.volume = vol;
    busEmit("music-volume-change", { volume: vol });
  }

  setPlayMode(mode: PlayMode): void {
    this.mode = mode;
    busEmit("music-play-mode", { mode });
  }

  setAutoNext(enabled: boolean): void {
    this.autoNextEnabled = enabled;
  }

  /** 自动播完推进：按模式选下一首 */
  private async advance(): Promise<void> {
    if (this.order.length === 0) return;
    const nextIdx = this.pickNextIndex(true);
    this.index = nextIdx;
    const name = this.order[nextIdx];
    const url = await this.resolveUrl(name);
    this.pendingStartSec = 0;
    this.lastSrc = url;
    this.audio.src = url;
    try {
      await this.audio.play();
    } catch {
      /* 忽略 */
    }
  }

  /** 选下一首。auto=true 遵循模式；auto=false（手动切歌）恒推进 */
  private pickNextIndex(auto: boolean): number {
    if (this.order.length === 0) return -1;
    if (auto && this.mode === "loop") return this.index;
    if (this.mode === "shuffle") {
      if (this.order.length === 1) return 0;
      let n = this.index;
      while (n === this.index) n = Math.floor(Math.random() * this.order.length);
      return n;
    }
    return (this.index + 1) % this.order.length;
  }

  // ===== 查询（fire-and-forget，通过事件回传） =====

  emitStatus(): void {
    const name = this.index >= 0 ? this.order[this.index] : "";
    const dur = Number.isFinite(this.audio.duration) ? Math.round(this.audio.duration) : 0;
    busEmit("music-status", {
      playing: !this.audio.paused && !!this.audio.src,
      name,
      current: Math.floor(this.audio.currentTime || 0),
      duration: dur,
      has_prev: this.index > 0,
      play_mode: this.mode,
      volume: this.audio.volume,
    });
  }

  emitPlaylist(): void {
    const songs = this.order.map((name) => {
      const info = this.songInfo.get(name);
      const override = this.tagOverrides.get(name);
      return {
        name,
        tag: override ? override.name : (info?.tag ?? null),
        tagColor: override ? override.color : (info?.color ?? null),
      };
    });
    const current = this.index >= 0 ? this.order[this.index] : undefined;
    busEmit("music-playlist", { songs, current_song: current });
  }

  /** 删除歌曲：清理本地缓存/IDB/object URL 并刷新歌单（服务器曲库文件本身不受影响） */
  async deleteSong(name: string): Promise<boolean> {
    const idx = this.order.indexOf(name);
    if (idx < 0) return false;
    // 先停止播放并摘除 src，再回收 URL——顺序颠倒会"正在播放的 blob URL 被 revoke"→ no supported source
    if (idx === this.index) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.index = -1;
    } else if (idx < this.index) {
      this.index--;
    }
    const { idbDeleteSong } = await import("./idb");
    await idbDeleteSong(name).catch(() => {});
    const { uncacheSong } = await import("./sources");
    const info = this.songInfo.get(name);
    if (info) await uncacheSong(songUrl(name, info.source)).catch(() => {});
    const local = this.localUrls.get(name);
    if (local) URL.revokeObjectURL(local);
    this.localUrls.delete(name);

    this.order.splice(idx, 1);
    this.songInfo.delete(name);
    this.emitPlaylist();
    return true;
  }

  /** 注册一首 P2P 收到的歌的本地 blob（finalize 后调用）：
   *  同时登记到歌曲信息与歌单——否则这首歌无法被 musicReadSongChunk
   *  （DJ 端给其他人传这首歌）读取，也无法在播放列表/删除中管理。 */
  registerLocalSong(name: string, blob: Blob): void {
    const old = this.localUrls.get(name);
    const url = URL.createObjectURL(blob);
    this.localUrls.set(name, url);
    // 只回收"当前不在用"的旧 URL：音频元素正在用旧 blob URL 加载/播放时 revoke
    // 会立刻报 MEDIA_ERR_SRC_NOT_SUPPORTED（"no supported source"），
    // 这正是"传歌成功后播放报错"的根因（同一首歌被重复传输/登记时触发）
    if (old && this.audio.src !== old) URL.revokeObjectURL(old);
    if (!this.songInfo.has(name)) {
      this.songInfo.set(name, { name, source: "local" });
      if (!this.order.includes(name)) this.order.push(name);
      this.emitPlaylist();
    }
  }
}

export const audioEngine = new BrowserAudioEngine();
