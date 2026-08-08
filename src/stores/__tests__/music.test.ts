import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

// Mock api/music 模块（使用 vi.hoisted 避免 hoist 顺序问题）
const musicApi = vi.hoisted(() => ({
  musicTogglePlay: vi.fn(),
  musicNext: vi.fn(),
  musicPrev: vi.fn(),
  musicSeek: vi.fn(),
  musicSetVolume: vi.fn(),
  musicSetAutoNext: vi.fn(),
  musicSetPlayMode: vi.fn(),
  musicGetStatus: vi.fn(),
  musicGetPlaylist: vi.fn(),
  musicGetDevices: vi.fn(),
  musicSetDevice: vi.fn(),
  musicPlaySong: vi.fn(),
  musicPlaySongAt: vi.fn(),
  musicDeleteSong: vi.fn(),
  musicGetCustomTags: vi.fn(),
  musicAddCustomTag: vi.fn(),
  musicDeleteCustomTag: vi.fn(),
  musicUpdateTag: vi.fn(),
  // P2P 传歌
  musicReadSongChunk: vi.fn(),
  musicReceiveSongChunk: vi.fn(),
  musicFinalizeSong: vi.fn(),
}));
vi.mock("@/api/music", () => musicApi);

// Mock api/data 模块
const dataApi = vi.hoisted(() => ({
  readData: vi.fn(),
  writeData: vi.fn(),
}));
vi.mock("@/api/data", () => dataApi);

// Mock api/musicSync（同步听歌）
const musicSyncApi = vi.hoisted(() => ({
  musicSyncPlay: vi.fn(),
  musicSyncPause: vi.fn(),
  musicSyncSeek: vi.fn(),
  musicSyncNext: vi.fn(),
  musicSyncVolume: vi.fn(),
  musicSyncRequestDj: vi.fn(),
  // 全量状态 + P2P 传歌
  musicSyncState: vi.fn(),
  musicSyncRequestSong: vi.fn(),
  musicSyncOfferSong: vi.fn(),
  musicSyncTransferDone: vi.fn(),
  musicSyncTransferFailed: vi.fn(),
  musicSyncSetConfig: vi.fn(),
  musicSyncRequestState: vi.fn(),
  // v4.7.5 reverse 反向打洞
  musicSyncReverseRequest: vi.fn(),
  // v4.6.6 时钟对齐
  musicSyncMeasureTimeOffset: vi.fn(),
  // Phase 1 WebRTC 直传二进制分片
  musicReadSongChunkBin: vi.fn(),
  musicReceiveSongChunkBin: vi.fn(),
}));
vi.mock("@/api/musicSync", () => musicSyncApi);

// Mock p2p 模块（WebRTC 直连）
const p2pApi = vi.hoisted(() => ({
  handlePeerSignal: vi.fn(),
  p2pReceive: vi.fn<any>(() => ({ close: vi.fn() })),
  p2pSend: vi.fn<any>(() => ({ close: vi.fn() })),
}));
vi.mock("@/p2p", () => p2pApi);

// Mock auth store（DJ 身份判断用当前用户 id）
vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ session: { id: "me-1", username: "me", admin: false } }),
}));

import { useMusicStore } from "../music";

// Phase 1 P2P 直连传歌：p2pReceive/p2pSend 选项类型（测试断言用）
interface P2PReceiveOpts {
  peerId: string;
  role: string;
  onChunk: (chunk: Uint8Array, index: number, totalChunks: number) => Promise<void>;
  callbacks: { onComplete: () => void; onError: (err: string) => void; onOpen?: () => void };
}
interface P2PSendOpts {
  peerId: string;
  role: string;
  sender?: string;
  totalBytes: number;
  sendChunk: (index: number, totalChunks: number) => Promise<Uint8Array>;
  callbacks: { onComplete: () => void; onError: (err: string) => void; onOpen?: () => void };
}

describe("useMusicStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    Object.values(musicApi).forEach((fn) => fn.mockReset());
    Object.values(dataApi).forEach((fn) => fn.mockReset());
    Object.values(musicSyncApi).forEach((fn) => fn.mockReset());
    Object.values(p2pApi).forEach((fn) => fn.mockReset());
    p2pApi.p2pReceive.mockReturnValue({ close: vi.fn() });
    p2pApi.p2pSend.mockReturnValue({ close: vi.fn() });
    // 默认 resolve 成功
    musicApi.musicDeleteSong.mockResolvedValue({ success: true });
    musicApi.musicGetCustomTags.mockResolvedValue({ success: false });
    musicApi.musicGetStatus.mockResolvedValue(undefined);
    musicApi.musicGetPlaylist.mockResolvedValue({ songs: [] });
    musicApi.musicGetDevices.mockResolvedValue({ devices: [], current: null });
    musicApi.musicSetAutoNext.mockResolvedValue(undefined);
    musicSyncApi.musicSyncRequestDj.mockResolvedValue(undefined);
    musicSyncApi.musicSyncRequestState.mockResolvedValue(undefined);
    musicSyncApi.musicSyncReverseRequest.mockResolvedValue(undefined);
    musicApi.musicUpdateTag.mockResolvedValue({ success: true });
    dataApi.readData.mockResolvedValue({});
    dataApi.writeData.mockResolvedValue(undefined);
  });

  it("初始状态应匹配规格", () => {
    const s = useMusicStore();
    expect(s.playing).toBe(false);
    expect(s.trackName).toBe("");
    expect(s.currentTime).toBe(0);
    expect(s.duration).toBe(0);
    expect(s.volume).toBe(1.0);
    expect(s.playMode).toBe("shuffle");
    expect(s.hasMusic).toBe(true);
    expect(s.hasPrev).toBe(false);
    expect(s.playError).toBeNull();
    expect(s.isCollapsed).toBe(false);
    expect(s.isDragging).toBe(false);
    expect(s.devices).toEqual([]);
    expect(s.currentDeviceId).toBeNull();
    expect(s.playlist).toEqual([]);
    expect(s.playlistTags).toEqual({});
    expect(s.customTags).toEqual({});
  });

  it("togglePlay 调用 api 且不抛错", async () => {
    const s = useMusicStore();
    musicApi.musicTogglePlay.mockResolvedValue(undefined);
    await s.togglePlay();
    expect(musicApi.musicTogglePlay).toHaveBeenCalledTimes(1);
  });

  it("next 调用 api", async () => {
    const s = useMusicStore();
    await s.next();
    expect(musicApi.musicNext).toHaveBeenCalledTimes(1);
  });

  it("prev 调用 api", async () => {
    const s = useMusicStore();
    await s.prev();
    expect(musicApi.musicPrev).toHaveBeenCalledTimes(1);
  });

  it("seek 调用 api 并传秒数", async () => {
    const s = useMusicStore();
    await s.seek(123);
    expect(musicApi.musicSeek).toHaveBeenCalledWith(123);
  });

  it("setVolume 设置 volume 并调用 api", async () => {
    const s = useMusicStore();
    await s.setVolume(0.5);
    expect(s.volume).toBe(0.5);
    expect(musicApi.musicSetVolume).toHaveBeenCalledWith(0.5);
  });

  it("cyclePlayMode: shuffle -> order -> loop -> shuffle", async () => {
    const s = useMusicStore();
    s.playMode = "shuffle";
    await s.cyclePlayMode();
    expect(musicApi.musicSetPlayMode).toHaveBeenCalledWith("order");

    s.playMode = "order";
    await s.cyclePlayMode();
    expect(musicApi.musicSetPlayMode).toHaveBeenCalledWith("loop");

    s.playMode = "loop";
    await s.cyclePlayMode();
    expect(musicApi.musicSetPlayMode).toHaveBeenCalledWith("shuffle");
  });

  it("setDevice 设置 currentDeviceId 并调用 api", async () => {
    const s = useMusicStore();
    await s.setDevice(7);
    expect(s.currentDeviceId).toBe(7);
    expect(musicApi.musicSetDevice).toHaveBeenCalledWith(7);
  });

  it("playSong: 相同曲名不调用 api", async () => {
    const s = useMusicStore();
    s.trackName = "a.mp3";
    await s.playSong("a.mp3");
    expect(musicApi.musicPlaySong).not.toHaveBeenCalled();
  });

  it("playSong: 不同曲名调用 api", async () => {
    const s = useMusicStore();
    s.trackName = "a.mp3";
    await s.playSong("b.mp3");
    expect(musicApi.musicPlaySong).toHaveBeenCalledWith("b.mp3");
  });

  it("deleteSong: 成功时调用 requestPlaylist 并返回 true", async () => {
    const s = useMusicStore();
    musicApi.musicDeleteSong.mockResolvedValue({ success: true });
    const ok = await s.deleteSong("x.mp3");
    expect(musicApi.musicDeleteSong).toHaveBeenCalledWith("x.mp3");
    expect(musicApi.musicGetPlaylist).toHaveBeenCalled();
    expect(ok).toBe(true);
  });

  it("deleteSong: 失败时不调用 requestPlaylist 并返回 false", async () => {
    const s = useMusicStore();
    musicApi.musicDeleteSong.mockResolvedValue({ success: false });
    const ok = await s.deleteSong("x.mp3");
    expect(musicApi.musicGetPlaylist).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });

  it("deleteSong: 异常时返回 false 不抛错", async () => {
    const s = useMusicStore();
    musicApi.musicDeleteSong.mockRejectedValue(new Error("boom"));
    const ok = await s.deleteSong("x.mp3");
    expect(ok).toBe(false);
  });

  it("progress getter: duration>0 返回百分比，否则 0", () => {
    const s = useMusicStore();
    expect(s.progress).toBe(0);
    s.duration = 200;
    s.currentTime = 50;
    expect(s.progress).toBe(25);
    s.duration = 0;
    expect(s.progress).toBe(0);
  });

  it("currentTimeText / durationText 格式化为 m:ss 或 --:--", () => {
    const s = useMusicStore();
    s.currentTime = 65;
    expect(s.currentTimeText).toBe("1:05");
    s.currentTime = 0;
    expect(s.currentTimeText).toBe("0:00");
    s.currentTime = 125;
    expect(s.currentTimeText).toBe("2:05");
    s.duration = 125;
    expect(s.durationText).toBe("2:05");
    s.duration = 0;
    expect(s.durationText).toBe("0:00");
  });

  it("currentTimeText 负数返回 --:--", () => {
    const s = useMusicStore();
    s.currentTime = -5;
    expect(s.currentTime).toBe(-5);
    expect(s.currentTimeText).toBe("--:--");
  });

  it("durationText 负数返回 --:--", () => {
    const s = useMusicStore();
    s.duration = -1;
    expect(s.duration).toBe(-1);
    expect(s.durationText).toBe("--:--");
  });

  it("volumeIcon: 4 个等级", () => {
    const s = useMusicStore();
    s.volume = 0;
    expect(s.volumeIcon).toBe("🔇");
    s.volume = 0.2;
    expect(s.volumeIcon).toBe("🔈");
    s.volume = 0.5;
    expect(s.volumeIcon).toBe("🔉");
    s.volume = 0.8;
    expect(s.volumeIcon).toBe("🔊");
  });

  it("playModeIcon / playModeTitle 映射正确", () => {
    const s = useMusicStore();
    s.playMode = "shuffle";
    expect(s.playModeIcon).toBe("🔀");
    expect(s.playModeTitle).toContain("随机播放");
    s.playMode = "order";
    expect(s.playModeIcon).toBe("🔁");
    expect(s.playModeTitle).toContain("顺序播放");
    s.playMode = "loop";
    expect(s.playModeIcon).toBe("🔂");
    expect(s.playModeTitle).toContain("单曲循环");
  });

  it("toggleCollapse 翻转 isCollapsed", () => {
    const s = useMusicStore();
    expect(s.isCollapsed).toBe(false);
    s.toggleCollapse();
    expect(s.isCollapsed).toBe(true);
    s.toggleCollapse();
    expect(s.isCollapsed).toBe(false);
  });

  it("handleProgress: 拖拽时跳过更新", () => {
    const s = useMusicStore();
    s.isDragging = true;
    s.handleProgress({ current: 50, duration: 200 });
    expect(s.currentTime).toBe(0);
    expect(s.duration).toBe(0);
    s.isDragging = false;
    s.handleProgress({ current: 50, duration: 200 });
    expect(s.currentTime).toBe(50);
    expect(s.duration).toBe(200);
  });

  it("handleReady 更新曲名/时长/hasPrev 并清错", () => {
    const s = useMusicStore();
    s.playError = "old";
    s.handleReady({ name: "song.mp3", duration: 180, has_prev: true });
    expect(s.trackName).toBe("song.mp3");
    expect(s.duration).toBe(180);
    expect(s.currentTime).toBe(0);
    expect(s.playing).toBe(false);
    expect(s.hasPrev).toBe(true);
    expect(s.playError).toBeNull();
  });

  it("handleStatus 更新全部状态字段", () => {
    const s = useMusicStore();
    s.handleStatus({
      playing: true,
      name: "x.mp3",
      current: 10,
      duration: 100,
      has_prev: true,
      play_mode: "loop",
    });
    expect(s.playing).toBe(true);
    expect(s.trackName).toBe("x.mp3");
    expect(s.currentTime).toBe(10);
    expect(s.duration).toBe(100);
    expect(s.hasPrev).toBe(true);
    expect(s.playMode).toBe("loop");
  });

  it("handlePlayState 更新 playing，播放时清错", () => {
    const s = useMusicStore();
    s.playError = "err";
    s.handlePlayState({ playing: true });
    expect(s.playing).toBe(true);
    expect(s.playError).toBeNull();
    s.handlePlayState({ playing: false });
    expect(s.playing).toBe(false);
  });

  it("handleDevices 更新设备列表与当前设备", () => {
    const s = useMusicStore();
    s.handleDevices({
      devices: [{ id: 1, name: "D", hostapi: "x" }],
      current: 1,
    });
    expect(s.devices).toHaveLength(1);
    expect(s.currentDeviceId).toBe(1);
  });

  it("handleVolumeChange 更新 volume", () => {
    const s = useMusicStore();
    s.handleVolumeChange({ volume: 0.3 });
    expect(s.volume).toBe(0.3);
  });

  it("handlePlayModeChange 更新 playMode", () => {
    const s = useMusicStore();
    s.handlePlayModeChange({ mode: "order" });
    expect(s.playMode).toBe("order");
  });

  it("handleTrackChange 更新曲名/时长", () => {
    const s = useMusicStore();
    s.handleTrackChange({ name: "new.mp3", duration: 90, has_prev: false });
    expect(s.trackName).toBe("new.mp3");
    expect(s.duration).toBe(90);
    expect(s.currentTime).toBe(0);
  });

  it("handleNoMusic 重置为无音乐状态", () => {
    const s = useMusicStore();
    s.playing = true;
    s.trackName = "a.mp3";
    s.handleNoMusic();
    expect(s.hasMusic).toBe(false);
    expect(s.playing).toBe(false);
    expect(s.trackName).toBe("");
    expect(s.currentTime).toBe(0);
    expect(s.duration).toBe(0);
  });

  it("handlePlayError 设置错误并暂停", () => {
    const s = useMusicStore();
    s.handlePlayError({ message: "boom" });
    expect(s.playing).toBe(false);
    expect(s.playError).toBe("boom");
  });

  it("handlePlaylist 解析字符串数组并设置 current_song", () => {
    const s = useMusicStore();
    s.handlePlaylist({ songs: ["a.mp3", "b.mp3"], current_song: "b.mp3" });
    expect(s.playlist).toEqual(["a.mp3", "b.mp3"]);
    expect(s.trackName).toBe("b.mp3");
  });

  it("handlePlaylist 解析对象数组并提取 tag", () => {
    const s = useMusicStore();
    s.handlePlaylist({
      songs: [
        { name: "a.mp3", tag: "jazz", tagColor: "#fff" },
        { name: "b.mp3" },
      ],
    });
    expect(s.playlist).toEqual(["a.mp3", "b.mp3"]);
    expect(s.playlistTags["a.mp3"]).toEqual({ name: "jazz", color: "#fff" });
    expect(s.playlistTags["b.mp3"]).toEqual({ name: "自定义", color: null });
  });

  it("handleSongMissing 设置错误信息", () => {
    const s = useMusicStore();
    s.handleSongMissing({ message: "消失" });
    expect(s.playError).toBe("消失");
    s.handleSongMissing({});
    expect(s.playError).toBe("原歌曲已消失");
  });

  it("requestStatus / requestDevices / requestPlaylist 调用对应 api", async () => {
    const s = useMusicStore();
    await s.requestStatus();
    expect(musicApi.musicGetStatus).toHaveBeenCalled();
    await s.requestDevices();
    expect(musicApi.musicGetDevices).toHaveBeenCalled();
    await s.requestPlaylist();
    expect(musicApi.musicGetPlaylist).toHaveBeenCalled();
  });

  it("loadSavedVolume: 有保存值时设置 volume 并调用 api", async () => {
    const s = useMusicStore();
    dataApi.readData.mockResolvedValue({ musicVolume: 0.4 });
    await s.loadSavedVolume();
    expect(s.volume).toBe(0.4);
    expect(musicApi.musicSetVolume).toHaveBeenCalledWith(0.4);
  });

  it("loadSavedVolume: 无保存值时不修改 volume", async () => {
    const s = useMusicStore();
    s.volume = 1.0;
    dataApi.readData.mockResolvedValue({});
    await s.loadSavedVolume();
    expect(s.volume).toBe(1.0);
    expect(musicApi.musicSetVolume).not.toHaveBeenCalled();
  });

  // ===== 同步听歌 =====

  it("setSyncEnabled(true) 开启同步；关闭时复位 DJ 状态", () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    expect(s.syncEnabled).toBe(true);
    // 模拟已成为 DJ 后关闭同步
    s.isDj = true;
    s.djName = "me";
    s.djUserId = "me-1";
    s.setSyncEnabled(false);
    expect(s.syncEnabled).toBe(false);
    expect(s.isDj).toBe(false);
    expect(s.djName).toBe("");
    expect(s.djUserId).toBeNull();
  });

  it("自动切歌开关：开启同步（听众）禁用，关闭同步恢复", async () => {
    const s = useMusicStore();
    musicApi.musicSetAutoNext.mockResolvedValue(undefined);
    // 默认（未开同步）：自动切歌开启
    await s.applyAutoNext();
    expect(musicApi.musicSetAutoNext).toHaveBeenLastCalledWith(true);
    // 开启同步且非 DJ（听众）：禁用自动切歌，播完等待 DJ 信号
    s.isDj = false;
    s.setSyncEnabled(true);
    expect(musicApi.musicSetAutoNext).toHaveBeenLastCalledWith(false);
    // 关闭同步：恢复自动切歌
    s.setSyncEnabled(false);
    expect(musicApi.musicSetAutoNext).toHaveBeenLastCalledWith(true);
  });

  it("自动切歌开关：同步中成为 DJ 恢复自动切歌；退为听众再禁用", async () => {
    const s = useMusicStore();
    musicApi.musicSetAutoNext.mockResolvedValue(undefined);
    s.setSyncEnabled(true);
    expect(musicApi.musicSetAutoNext).toHaveBeenLastCalledWith(false);
    // 成为 DJ：恢复自动切歌（DJ 需要自然切歌并广播）
    s.handleSyncWsEvent({ type: "music:dj_changed", dj_user_id: "me-1", dj_username: "me" });
    expect(s.isDj).toBe(true);
    expect(musicApi.musicSetAutoNext).toHaveBeenLastCalledWith(true);
    // DJ 切换为他人：退为听众，禁用自动切歌
    s.handleSyncWsEvent({ type: "music:dj_changed", dj_user_id: "other-1", dj_username: "bob" });
    expect(s.isDj).toBe(false);
    expect(musicApi.musicSetAutoNext).toHaveBeenLastCalledWith(false);
  });

  it("requestDj 调用 musicSyncRequestDj", async () => {
    const s = useMusicStore();
    await s.requestDj();
    expect(musicSyncApi.musicSyncRequestDj).toHaveBeenCalledTimes(1);
  });

  it("DJ 模式 togglePlay：广播全量状态（songId + 位置 + 音量 + 方案）", async () => {
    vi.useFakeTimers();
    try {
      const s = useMusicStore();
      s.setSyncEnabled(true);
      s.isDj = true;
      s.trackName = "a.mp3";
      s.currentTime = 30;
      s.volume = 0.6;
      musicApi.musicTogglePlay.mockResolvedValue(undefined);
      await s.togglePlay();
      vi.advanceTimersByTime(200);
      expect(musicSyncApi.musicSyncState).toHaveBeenCalledWith({
        songId: "a.mp3",
        playing: false,
        positionMs: 30000,
        volume: 0.6,
        transferMode: "immediate",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("未开启同步或非 DJ 时播放操作不广播全量状态", async () => {
    const s = useMusicStore();
    // 开启同步但非 DJ
    s.setSyncEnabled(true);
    s.isDj = false;
    await s.togglePlay();
    expect(musicSyncApi.musicSyncState).not.toHaveBeenCalled();
    expect(musicSyncApi.musicSyncPlay).not.toHaveBeenCalled();
    // 未开启同步（isDj 随之复位）
    s.setSyncEnabled(false);
    s.isDj = true;
    await s.togglePlay();
    expect(musicSyncApi.musicSyncState).not.toHaveBeenCalled();
  });

  it("DJ 模式 next/seek/playSong 广播全量状态；setVolume 不广播音量（音量本地化）", async () => {
    vi.useFakeTimers();
    try {
      const s = useMusicStore();
      s.setSyncEnabled(true);
      s.isDj = true;
      s.trackName = "a.mp3";
      musicApi.musicNext.mockResolvedValue(undefined);
      await s.next();
      vi.advanceTimersByTime(300);
      expect(musicSyncApi.musicSyncState).toHaveBeenCalledTimes(1);

      await s.seek(120);
      vi.advanceTimersByTime(300);
      expect(musicSyncApi.musicSyncState).toHaveBeenCalledTimes(2);

      await s.setVolume(0.5);
      // 音量纯本地：DJ 不广播音量，听众不会被控制
      expect(musicSyncApi.musicSyncVolume).not.toHaveBeenCalled();

      s.trackName = "old.mp3";
      musicApi.musicPlaySong.mockResolvedValue(undefined);
      await s.playSong("new.mp3");
      vi.advanceTimersByTime(300);
      expect(musicSyncApi.musicSyncState).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("music:dj_changed：DJ 是自己时 isDj 为 true", () => {
    const s = useMusicStore();
    s.handleSyncWsEvent({
      type: "music:dj_changed",
      dj_user_id: "me-1",
      dj_username: "me",
    });
    expect(s.djUserId).toBe("me-1");
    expect(s.djName).toBe("me");
    expect(s.isDj).toBe(true);
  });

  it("music:dj_changed：DJ 是他人时 isDj 为 false", () => {
    const s = useMusicStore();
    s.handleSyncWsEvent({
      type: "music:dj_changed",
      dj_user_id: "other-1",
      dj_username: "bob",
    });
    expect(s.djUserId).toBe("other-1");
    expect(s.djName).toBe("bob");
    expect(s.isDj).toBe(false);
  });

  it("music:state play：听众端跟播（同曲目直接播放并跳转）", async () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.isDj = false;
    s.trackName = "a.mp3";
    s.playing = false;
    s.handleSyncWsEvent({
      type: "music:state",
      action: "play",
      position_ms: 15000,
      timestamp_server: Date.now(),
      song_id: "a.mp3",
    });
    // 播放器副作用经 DJ 操作串行队列异步执行，等待队列推进
    await new Promise((r) => setTimeout(r, 0));
    expect(musicApi.musicTogglePlay).toHaveBeenCalled();
    expect(musicApi.musicSeek).toHaveBeenCalled();
    const seekArg = musicApi.musicSeek.mock.calls[0][0] as number;
    expect(seekArg).toBeGreaterThanOrEqual(15);
  });

  it("music:state pause：听众端暂停并跳转", async () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.isDj = false;
    s.playing = true;
    s.handleSyncWsEvent({
      type: "music:state",
      action: "pause",
      position_ms: 20000,
      timestamp_server: Date.now(),
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(musicApi.musicTogglePlay).toHaveBeenCalled();
    expect(musicApi.musicSeek).toHaveBeenCalled();
  });

  it("music:state seek：直接跳转到目标位置", async () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.isDj = false;
    s.handleSyncWsEvent({
      type: "music:state",
      action: "seek",
      position_ms: 30000,
      timestamp_server: Date.now(),
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(musicApi.musicSeek).toHaveBeenCalled();
  });

  it("music:state next：切歌", async () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.isDj = false;
    s.handleSyncWsEvent({ type: "music:state", action: "next" });
    await new Promise((r) => setTimeout(r, 0));
    expect(musicApi.musicNext).toHaveBeenCalled();
  });

  it("music:state：DJ 自身忽略避免回环", () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.isDj = true;
    s.handleSyncWsEvent({ type: "music:state", action: "pause" });
    expect(musicApi.musicTogglePlay).not.toHaveBeenCalled();
  });

  it("music:state：未开启同步时忽略", () => {
    const s = useMusicStore();
    s.handleSyncWsEvent({
      type: "music:state",
      action: "play",
      position_ms: 0,
      timestamp_server: Date.now(),
      song_id: "a.mp3",
    });
    expect(musicApi.musicTogglePlay).not.toHaveBeenCalled();
    expect(musicApi.musicPlaySong).not.toHaveBeenCalled();
  });

  it("music:volume：听众端忽略音量广播（音量本地化）", async () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.isDj = false;
    s.volume = 0.8;
    s.handleSyncWsEvent({ type: "music:volume", volume: 0.4 });
    // DJ 不控制听众音量：本地音量保持不变，也不调用后端
    expect(s.volume).toBe(0.8);
    expect(musicApi.musicSetVolume).not.toHaveBeenCalled();
  });

  it("music:playlist_updated：刷新播放列表", async () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.handleSyncWsEvent({ type: "music:playlist_updated" });
    expect(musicApi.musicGetPlaylist).toHaveBeenCalled();
  });

  it("handleSyncWsEvent 忽略无效负载", () => {
    const s = useMusicStore();
    expect(() => s.handleSyncWsEvent(null)).not.toThrow();
    expect(() => s.handleSyncWsEvent("str")).not.toThrow();
    expect(() => s.handleSyncWsEvent({ type: "unknown" })).not.toThrow();
  });

  it("music:state play：本地歌单不含该歌 → 设置 missingSongName（无这首歌）", () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.isDj = false;
    s.trackName = "old.mp3";
    s.playing = false;
    // 先加载本地歌单（不含 dj 播放的歌）
    s.handlePlaylist({ songs: ["a.mp3", "b.mp3"] });
    s.handleSyncWsEvent({
      type: "music:state",
      action: "play",
      position_ms: 0,
      timestamp_server: Date.now(),
      song_id: "dj-only.mp3",
    });
    expect(s.missingSongName).toBe("dj-only.mp3");
    // 不应尝试播放
    expect(musicApi.musicPlaySong).not.toHaveBeenCalled();
  });

  it("music:state play：本地歌单含该歌 → 正常播放且不设 missingSongName", async () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.isDj = false;
    s.trackName = "old.mp3";
    s.playing = false;
    s.handlePlaylist({ songs: ["a.mp3", "b.mp3"] });
    s.handleSyncWsEvent({
      type: "music:state",
      action: "play",
      position_ms: 0,
      timestamp_server: Date.now(),
      song_id: "a.mp3",
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(s.missingSongName).toBeNull();
    expect(musicApi.musicPlaySong).toHaveBeenCalledWith("a.mp3");
  });

  it("music:state play：歌单刷新后缺失的本地歌再次播放 → 不再误判缺歌（localHasSongs 已填充）", () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.isDj = false;
    s.trackName = "old.mp3";
    s.playing = false;
    // 先加载歌单（本地存在 a.mp3 / b.mp3），触发 localHasSongs 填充
    s.handlePlaylist({ songs: ["a.mp3", "b.mp3"] });
    // 歌单随后刷新为空（延迟/失败）→ 但 localHasSongs 仍标记本地已有
    s.handlePlaylist({ songs: [] });
    s.handleSyncWsEvent({
      type: "music:state",
      action: "play",
      position_ms: 0,
      timestamp_server: Date.now(),
      song_id: "a.mp3",
    });
    expect(s.missingSongName).toBeNull();
    expect(s.songTransfer.state).toBe("idle");
    expect(musicSyncApi.musicSyncRequestSong).not.toHaveBeenCalled();
  });

  it("music:state play：歌单未加载时不做缺歌判定 → 不触发 P2P（本地已有的歌不被误下载）", () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.isDj = false;
    s.trackName = "old.mp3";
    s.playing = false;
    // playlist 为空（歌单尚未加载）→ 不能据此判定"缺歌"触发下载，
    // 等歌单加载完成后由 handlePlaylist 重取状态/后续广播驱动
    s.handleSyncWsEvent({
      type: "music:state",
      action: "play",
      position_ms: 0,
      timestamp_server: Date.now(),
      song_id: "unknown.mp3",
    });
    expect(s.missingSongName).toBeNull();
    expect(s.songTransfer.state).toBe("idle");
    expect(musicSyncApi.musicSyncRequestSong).not.toHaveBeenCalled();
    // 不应尝试播放（未知歌曲，等歌单加载后判定）
    expect(musicApi.musicPlaySong).not.toHaveBeenCalled();
  });

  it("playSong 失败 → 不触发 P2P 下载（避免本地已有歌被重复下载）", async () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.isDj = false;
    musicApi.musicPlaySong.mockRejectedValue(new Error("song_missing"));
    await s.playSong("ghost.mp3");
    // 缺歌场景由 sync_state 缺歌分支驱动，playSong 失败不应直接触发下载
    expect(musicSyncApi.musicSyncRequestSong).not.toHaveBeenCalled();
    expect(s.songTransfer.state).toBe("idle");
  });

  it("playSong 成功 → 清除 missingSongName", async () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.isDj = false;
    s.missingSongName = "ghost.mp3";
    musicApi.musicPlaySong.mockResolvedValue(undefined);
    await s.playSong("a.mp3");
    expect(s.missingSongName).toBeNull();
  });

  it("handlePlaylist 刷新后缺歌已出现 → 清除 missingSongName", () => {
    const s = useMusicStore();
    s.missingSongName = "ghost.mp3";
    s.handlePlaylist({ songs: ["a.mp3", "ghost.mp3"] });
    expect(s.missingSongName).toBeNull();
  });

  it("handleReady / handleStatus 清除 missingSongName", () => {
    const s = useMusicStore();
    s.missingSongName = "ghost.mp3";
    s.handleReady({ name: "a.mp3", duration: 100, has_prev: false });
    expect(s.missingSongName).toBeNull();
    s.missingSongName = "ghost.mp3";
    s.handleStatus({ playing: true, name: "b.mp3", current: 0, duration: 200 });
    expect(s.missingSongName).toBeNull();
  });

  // ===== Bug 1：歌单未加载误判缺歌 / 提前加载 =====

  it("music:sync_state：歌单未加载时缺歌不做判定 → 不触发 P2P", () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.isDj = false;
    s.trackName = "old.mp3";
    s.handleSyncWsEvent({
      type: "music:sync_state",
      song_id: "a.mp3",
      playing: true,
      position_ms: 0,
      timestamp_server: Date.now(),
    });
    expect(s.missingSongName).toBeNull();
    expect(musicSyncApi.musicSyncRequestSong).not.toHaveBeenCalled();
    expect(musicApi.musicPlaySong).not.toHaveBeenCalled();
  });

  it("setSyncEnabled(true) 提前加载本地歌单（预加载，避免同步广播先到时误判缺歌）", () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    expect(musicApi.musicGetPlaylist).toHaveBeenCalled();
  });

  it("handlePlaylist 首次加载完成且同步已开启 → 主动重取 DJ 状态对齐", () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.isDj = false;
    s.handlePlaylist({ songs: ["a.mp3"] });
    expect(musicSyncApi.musicSyncRequestState).toHaveBeenCalled();
  });

  it("handlePlaylist 非首次刷新不再重取状态", () => {
    const s = useMusicStore();
    s.handlePlaylist({ songs: ["a.mp3"] }); // 首次，未开同步 → 不重取
    expect(musicSyncApi.musicSyncRequestState).not.toHaveBeenCalled();
    s.setSyncEnabled(true); // 开启同步本身会重取一次（清掉计数）
    musicSyncApi.musicSyncRequestState.mockClear();
    s.handlePlaylist({ songs: ["a.mp3", "b.mp3"] }); // 非首次 → 不重取
    expect(musicSyncApi.musicSyncRequestState).not.toHaveBeenCalled();
  });

  // ===== Bug 2：切歌打断下载不及时 / 旧歌迟到传输事件特判 =====

  it("handleTransferDone：切歌打断后旧歌的迟到 transfer_done 被忽略", async () => {
    const s = useMusicStore();
    // 当前正在传输 b.mp3（DJ 已切歌），此时到达旧歌 a.mp3 的 transfer_done
    s.songTransfer = { state: "downloading", songName: "b.mp3", received: 3, total: 10, startedAt: Date.now(), retryCount: 0, channel: null };
    s.handleSyncWsEvent({ type: "music:transfer_done", song_id: "a.mp3", total_chunks: 10 });
    await new Promise((r) => setTimeout(r, 0));
    expect(musicApi.musicFinalizeSong).not.toHaveBeenCalled();
    expect(musicApi.musicPlaySong).not.toHaveBeenCalled();
    // 当前传输状态不被破坏
    expect(s.songTransfer.songName).toBe("b.mp3");
    expect(s.songTransfer.state).toBe("downloading");
  });

  it("handleTransferDone：正常完成 → 合并、标记本地已有；立即起播 + 并行请求状态精调", async () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.songTransfer = { state: "downloading", songName: "a.mp3", received: 10, total: 10, startedAt: Date.now(), retryCount: 0, channel: null };
    s.djName = "bob";
    musicApi.musicFinalizeSong.mockResolvedValue({ success: true });
    s.handleSyncWsEvent({ type: "music:transfer_done", song_id: "a.mp3", total_chunks: 10 });
    await new Promise((r) => setTimeout(r, 0));
    expect(musicApi.musicFinalizeSong).toHaveBeenCalledWith("a.mp3", 10);
    expect(s.missingSongName).toBeNull();
    expect(s.songTransfer.state).toBe("idle");
    // 合并完成后立即起播（v4.7.6：不再串行等 sync_state 网络往返，消除下载后 1s+ 预期外延迟）
    expect(musicApi.musicPlaySong).toHaveBeenCalledWith("a.mp3");
    // 并行请求 DJ 最新状态精调（sync_state 到达后同歌分支 seekIfFar，带 2s 容忍度）
    expect(musicSyncApi.musicSyncRequestState).toHaveBeenCalled();
  });

  it("下载完成即播：合并后立即起播，sync_state 回发后校准到 DJ 进度", async () => {
    vi.useFakeTimers();
    try {
      const s = useMusicStore();
      s.setSyncEnabled(true);
      s.isDj = false;
      s.songTransfer = { state: "downloading", songName: "a.mp3", received: 10, total: 10, startedAt: Date.now(), retryCount: 0, channel: null };
      s.trackName = "old.mp3";
      s.playing = false;
      musicApi.musicFinalizeSong.mockResolvedValue({ success: true });
      musicApi.musicPlaySong.mockResolvedValue(undefined);
      musicApi.musicSeek.mockResolvedValue(undefined);
      // 下载完成：立即起播（无暂存 DJ 进度 → 从头播，等 sync_state 精调），不等网络往返
      s.handleSyncWsEvent({ type: "music:transfer_done", song_id: "a.mp3", total_chunks: 10 });
      await vi.advanceTimersByTimeAsync(0);
      expect(musicApi.musicPlaySong).toHaveBeenCalledWith("a.mp3");
      expect(musicSyncApi.musicSyncRequestState).toHaveBeenCalled();
      // 歌单已含 a.mp3（finalize 后 requestPlaylist 已刷新）
      s.handlePlaylist({ songs: ["a.mp3"] });
      // DJ 回发 sync_state → 切歌/同歌分支校准到 DJ 进度
      s.handleSyncWsEvent({
        type: "music:sync_state",
        song_id: "a.mp3",
        playing: true,
        position_ms: 22000,
        timestamp_server: Date.now(),
      });
      await vi.advanceTimersByTimeAsync(0);
      // 校准到 DJ 进度
      await vi.advanceTimersByTimeAsync(900);
      expect(musicApi.musicSeek).toHaveBeenCalled();
      const seekArg = musicApi.musicSeek.mock.calls[0][0] as number;
      expect(seekArg).toBeGreaterThanOrEqual(22);
    } finally {
      vi.useRealTimers();
    }
  });

  it("下载完成即播：用暂存 DJ 广播重算当前位置 playSongAt 直接起播（不等 sync_state 网络往返）", async () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.isDj = false;
    s.trackName = "old.mp3";
    s.playing = false;
    // 歌单已加载且不含 a.mp3
    s.handlePlaylist({ songs: [] });
    musicSyncApi.musicSyncRequestSong.mockResolvedValue(undefined);
    musicApi.musicFinalizeSong.mockResolvedValue({ success: true });
    musicApi.musicPlaySongAt.mockResolvedValue(undefined);
    // DJ 广播：正在播 a.mp3（本地缺歌）→ 触发下载 + 暂存 DJ 原始进度（位置 10s）
    const djBroadcastTs = Date.now();
    s.handleSyncWsEvent({
      type: "music:sync_state",
      song_id: "a.mp3",
      playing: true,
      position_ms: 10000,
      dj_server_time: djBroadcastTs,
      timestamp_server: djBroadcastTs,
    });
    expect(musicSyncApi.musicSyncRequestSong).toHaveBeenCalled();
    expect(s.songTransfer.songName).toBe("a.mp3");
    // 传输完成 → 合并 → 用暂存原始数据重算 DJ 当前进度 → playSongAt 直接起播
    s.handleSyncWsEvent({ type: "music:transfer_done", song_id: "a.mp3", total_chunks: 2 });
    await new Promise((r) => setTimeout(r, 0));
    expect(musicApi.musicPlaySongAt).toHaveBeenCalled();
    const playAtArg = musicApi.musicPlaySongAt.mock.calls[0] as [string, number];
    expect(playAtArg[0]).toBe("a.mp3");
    expect(playAtArg[1]).toBeGreaterThanOrEqual(10);
    // 起播不依赖 sync_state 往返：状态请求仍并行发出（到达后同歌分支精调）
    expect(musicSyncApi.musicSyncRequestState).toHaveBeenCalled();
  });

  it("DJ 操作串行队列：并发 sync_state 堆积舍去中间，只执行最新操作", async () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.isDj = false;
    s.trackName = "a.mp3";
    s.playing = true;
    s.duration = 200;
    s.currentTime = 0;
    const base = Date.now();
    // 三条 DJ 广播几乎同时进入（同歌，位置 10s/30s/50s，ts 递增）：
    // 第一条立即入队执行（在途），后两条堆积为"最新"（30s 被 50s 覆盖，中间舍去）
    s.handleSyncWsEvent({ type: "music:sync_state", song_id: "a.mp3", playing: true, position_ms: 10000, timestamp_server: base });
    s.handleSyncWsEvent({ type: "music:sync_state", song_id: "a.mp3", playing: true, position_ms: 30000, timestamp_server: base + 1000 });
    s.handleSyncWsEvent({ type: "music:sync_state", song_id: "a.mp3", playing: true, position_ms: 50000, timestamp_server: base + 2000 });
    // 等待队列推进：在途操作完成 → 只执行堆积中的最新（50s），10s/30s 被舍去
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(musicApi.musicSeek).toHaveBeenCalledTimes(1);
    expect(musicApi.musicSeek.mock.calls[0][0]).toBeGreaterThanOrEqual(50);
  });

  it("DJ 操作串行队列：seek 在途时新广播只堆积，完成后才执行最新", async () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.isDj = false;
    s.trackName = "a.mp3";
    s.playing = true;
    s.duration = 200;
    s.currentTime = 0;
    // 第一次 seek 挂起（模拟播放器操作在途，队列上锁）；后续调用直接 resolve
    let releaseSeek: () => void = () => {};
    let seekCall = 0;
    musicApi.musicSeek.mockImplementation(() => {
      seekCall += 1;
      if (seekCall === 1) return new Promise<void>((res) => { releaseSeek = res; });
      return Promise.resolve();
    });
    const base = Date.now();
    // 第一条广播触发 seek(10s) 在途挂起
    s.handleSyncWsEvent({ type: "music:sync_state", song_id: "a.mp3", playing: true, position_ms: 10000, timestamp_server: base });
    await new Promise((r) => setTimeout(r, 0));
    expect(musicApi.musicSeek).toHaveBeenCalledTimes(1);
    // 在途期间新广播到达（30s/50s）→ 只堆积为最新（50s，覆盖 30s）
    s.handleSyncWsEvent({ type: "music:sync_state", song_id: "a.mp3", playing: true, position_ms: 30000, timestamp_server: base + 1000 });
    s.handleSyncWsEvent({ type: "music:sync_state", song_id: "a.mp3", playing: true, position_ms: 50000, timestamp_server: base + 2000 });
    await new Promise((r) => setTimeout(r, 0));
    expect(musicApi.musicSeek).toHaveBeenCalledTimes(1); // 仍在途，未执行堆积
    // 释放 → 执行最新（50s），30s 中间操作被舍去
    releaseSeek();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(musicApi.musicSeek).toHaveBeenCalledTimes(2);
    expect(musicApi.musicSeek.mock.calls[1][0]).toBeGreaterThanOrEqual(50);
  });

  it("DJ 操作串行队列：迟到的旧广播（ts 更小）不覆盖已应用的新状态", async () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.isDj = false;
    s.trackName = "a.mp3";
    s.playing = true;
    s.duration = 200;
    s.currentTime = 0;
    const base = Date.now();
    // 先应用新广播（位置 50s）
    s.handleSyncWsEvent({ type: "music:sync_state", song_id: "a.mp3", playing: true, position_ms: 50000, timestamp_server: base + 2000 });
    await new Promise((r) => setTimeout(r, 0));
    const firstCalls = musicApi.musicSeek.mock.calls.length;
    expect(musicApi.musicSeek.mock.calls[firstCalls - 1][0]).toBeGreaterThanOrEqual(50);
    // 迟到的旧广播（位置 10s，ts 更小）→ 队列/时间戳双重过滤，不执行
    s.handleSyncWsEvent({ type: "music:sync_state", song_id: "a.mp3", playing: true, position_ms: 10000, timestamp_server: base });
    await new Promise((r) => setTimeout(r, 0));
    expect(musicApi.musicSeek.mock.calls.length).toBe(firstCalls);
  });

  it("handleTransferFailed：旧歌的迟到失败事件不打断当前传输", () => {
    const s = useMusicStore();
    s.trackName = "b.mp3";
    s.songTransfer = { state: "downloading", songName: "b.mp3", received: 2, total: 10, startedAt: Date.now(), retryCount: 0, channel: null };
    s.handleSyncWsEvent({ type: "music:transfer_failed", song_id: "a.mp3" });
    expect(s.songTransfer.state).toBe("downloading");
    expect(s.songTransfer.songName).toBe("b.mp3");
    expect(s.missingSongName).toBeNull();
  });

  it("handleTransferFailed：当前传输失败 → 复位并提示无这首歌", () => {
    const s = useMusicStore();
    s.trackName = "a.mp3";
    s.songTransfer = { state: "downloading", songName: "a.mp3", received: 2, total: 10, startedAt: Date.now(), retryCount: 0, channel: null };
    s.handleSyncWsEvent({ type: "music:transfer_failed", song_id: "a.mp3" });
    expect(s.songTransfer.state).toBe("idle");
    expect(s.missingSongName).toBe("a.mp3");
  });

  // ===== Bug 修复（v4.5.12）：音量 UI 跟随实际音量 + 进度条超界防护 =====

  it("handleStatus 携带 volume → 音量 UI 跟随播放器实际音量", () => {
    const s = useMusicStore();
    s.volume = 1.0;
    s.handleStatus({ playing: false, name: "x.mp3", current: 0, duration: 100, volume: 0.3 });
    expect(s.volume).toBe(0.3);
  });

  it("handleStatus 无 volume 字段 → 不覆盖当前音量", () => {
    const s = useMusicStore();
    s.volume = 0.3;
    s.handleStatus({ playing: false, name: "x.mp3", current: 0, duration: 100 });
    expect(s.volume).toBe(0.3);
  });

  it("seek 目标超过当前歌曲时长 → 钳制到时长（防进度条超界）", async () => {
    const s = useMusicStore();
    s.duration = 120;
    await s.seek(500);
    expect(musicApi.musicSeek).toHaveBeenCalledWith(120);
    await s.seek(-5);
    expect(musicApi.musicSeek).toHaveBeenCalledWith(0);
  });

  it("seek 目标在时长内 → 原样透传", async () => {
    const s = useMusicStore();
    s.duration = 120;
    await s.seek(60);
    expect(musicApi.musicSeek).toHaveBeenCalledWith(60);
  });

  it("applySyncState：DJ 位置超过当前歌曲时长 → 忽略不跳转（旧 DJ 信息不干扰新歌）", () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.isDj = false;
    s.duration = 60;
    s.trackName = "a.mp3";
    s.playing = true;
    // DJ 广播位置 120s > 当前歌曲 60s（旧歌信息覆盖/堆积）
    s.handleSyncWsEvent({
      type: "music:sync_state",
      song_id: "a.mp3",
      playing: true,
      position_ms: 120000,
      timestamp_server: Date.now(),
    });
    expect(musicApi.musicSeek).not.toHaveBeenCalled();
  });

  it("handleProgress 上报位置超过时长 → 钳制到时长", () => {
    const s = useMusicStore();
    s.duration = 100;
    s.handleProgress({ current: 150, duration: 100 });
    expect(s.currentTime).toBe(100);
  });

  it("progress getter：currentTime 超过 duration 时钳制为 100%", () => {
    const s = useMusicStore();
    s.duration = 100;
    s.currentTime = 150;
    expect(s.progress).toBe(100);
  });

  // ===== Phase 1：WebRTC 直连传歌 =====

  it("startSongTransfer：知道 DJ 身份且首次传输 → 挂起 P2P 接收 + 请求带 p2p 标志", async () => {
    const s = useMusicStore();
    s.djUserId = "dj-1";
    musicSyncApi.musicSyncRequestSong.mockResolvedValue(undefined);
    await s.startSongTransfer("song-x", 0);
    expect(p2pApi.p2pReceive).toHaveBeenCalledTimes(1);
    const opts = p2pApi.p2pReceive.mock.calls[0][0] as P2PReceiveOpts;
    expect(opts.peerId).toBe("dj-1");
    expect(opts.role).toBe("answerer");
    expect(musicSyncApi.musicSyncRequestSong).toHaveBeenCalledWith("song-x", 0, true);
  });

  it("startSongTransfer：不知道 DJ 身份 → 不挂 P2P + 不带 p2p 标志", async () => {
    const s = useMusicStore();
    s.djUserId = null;
    musicSyncApi.musicSyncRequestSong.mockResolvedValue(undefined);
    await s.startSongTransfer("song-x", 0);
    expect(p2pApi.p2pReceive).not.toHaveBeenCalled();
    expect(musicSyncApi.musicSyncRequestSong).toHaveBeenCalledWith("song-x", 0, false);
  });

  it("startSongTransfer：断点续传（fromChunk>0）不走 P2P（续传走成熟的服务器中转）", async () => {
    const s = useMusicStore();
    s.djUserId = "dj-1";
    musicSyncApi.musicSyncRequestSong.mockResolvedValue(undefined);
    await s.startSongTransfer("song-x", 5);
    expect(p2pApi.p2pReceive).not.toHaveBeenCalled();
    expect(musicSyncApi.musicSyncRequestSong).toHaveBeenCalledWith("song-x", 5, false);
  });

  it("听众 P2P 分片落盘 + 收齐 → 直接合并（不经服务器 transfer_done）", async () => {
    const s = useMusicStore();
    s.djUserId = "dj-1";
    musicSyncApi.musicSyncRequestSong.mockResolvedValue(undefined);
    musicApi.musicFinalizeSong.mockResolvedValue({ success: true });
    musicApi.musicGetPlaylist.mockResolvedValue({ songs: [] });
    musicSyncApi.musicSyncRequestState.mockResolvedValue(undefined);
    musicSyncApi.musicReceiveSongChunkBin.mockResolvedValue({ success: true });
    await s.startSongTransfer("song-x", 0);
    const opts = p2pApi.p2pReceive.mock.calls[0][0] as P2PReceiveOpts;
    // 模拟 3 片收齐
    await opts.onChunk(new Uint8Array([1]), 0, 3);
    await opts.onChunk(new Uint8Array([2]), 1, 3);
    await opts.onChunk(new Uint8Array([3]), 2, 3);
    expect(musicSyncApi.musicReceiveSongChunkBin).toHaveBeenCalledTimes(3);
    expect(s.songTransfer.received).toBe(3);
    expect(s.songTransfer.total).toBe(3);
    opts.callbacks.onComplete();
    await vi.waitFor(() => {
      expect(musicApi.musicFinalizeSong).toHaveBeenCalledWith("song-x", 3);
    });
    expect(s.songTransfer.state).toBe("idle");
    expect(musicSyncApi.musicSyncTransferDone).not.toHaveBeenCalled(); // 不经服务器
  });

  it("听众 P2P 失败 → 挂起关闭，服务器中转路径继续（不中断请求状态）", async () => {
    const s = useMusicStore();
    s.djUserId = "dj-1";
    musicSyncApi.musicSyncRequestSong.mockResolvedValue(undefined);
    await s.startSongTransfer("song-x", 0);
    const opts = p2pApi.p2pReceive.mock.calls[0][0] as P2PReceiveOpts;
    opts.callbacks.onError("P2P 建连超时");
    // 请求已在途：状态保持 requesting，等服务器 song_chunk 继续下载
    expect(s.songTransfer.state).toBe("requesting");
  });

  it("P2P 建连成功 → channel 标记为 p2p（前端可观察）", async () => {
    const s = useMusicStore();
    s.djUserId = "dj-1";
    musicSyncApi.musicSyncRequestSong.mockResolvedValue(undefined);
    await s.startSongTransfer("song-x", 0);
    const opts = p2pApi.p2pReceive.mock.calls[0][0] as P2PReceiveOpts;
    // 初始未确定
    expect(s.songTransfer.channel).toBeNull();
    opts.callbacks.onOpen?.();
    expect(s.songTransfer.channel).toBe("p2p");
  });

  it("P2P 建连失败 → 尝试 reverse 反向打洞（v4.7.5），reverse 也失败才回退服务器中转", async () => {
    const s = useMusicStore();
    s.djUserId = "dj-1";
    musicSyncApi.musicSyncRequestSong.mockResolvedValue(undefined);
    await s.startSongTransfer("song-x", 0);
    const opts = p2pApi.p2pReceive.mock.calls[0][0] as P2PReceiveOpts;
    // 正常方向（DJ offerer）建连失败 → 通知 DJ 挂 answerer+sender，本机作 offerer 反打
    opts.callbacks.onError("P2P 建连超时");
    // tryReverseReceive 异步：等待 reverse 请求 resolve 后本机才作 offerer 反打
    await vi.waitFor(() => {
      // v4.7.7：reverse 默认并行 K=2（绕开单连接 SCTP 流控窗口）
      expect(musicSyncApi.musicSyncReverseRequest).toHaveBeenCalledWith("dj-1", "song-x", undefined, 2);
      expect(p2pApi.p2pSend).toHaveBeenCalledTimes(2);
    });
    // reverse 在途：尚未标记 server 中转
    expect(s.songTransfer.channel).not.toBe("server");
    const sendOpts = p2pApi.p2pSend.mock.calls[0][0] as P2PSendOpts;
    expect(sendOpts.peerId).toBe("dj-1");
    expect(sendOpts.role).toBe("offerer");
    expect(sendOpts.sender).toBe("answerer"); // reverse：本机打洞，DJ 在 channel 上发数据
    // 并行连接失败一条 → 其余连接仍可能推进，不立即回退（v4.7.7 修复：
    // 之前任一条失败即整体从 0 重传，实测"传到一半被死连接拖垮"的根因）
    sendOpts.callbacks.onError("reverse 并行打洞失败");
    expect(s.songTransfer.channel).not.toBe("server");
    expect(musicSyncApi.musicSyncReverseRequest).toHaveBeenCalledTimes(1);
    // 第二条并行连接也失败 → 全部失败才回退单连接 reverse 再试一次
    const sendOpts1 = p2pApi.p2pSend.mock.calls[1][0] as P2PSendOpts;
    sendOpts1.callbacks.onError("reverse 并行打洞失败");
    await vi.waitFor(() => {
      expect(musicSyncApi.musicSyncReverseRequest).toHaveBeenLastCalledWith("dj-1", "song-x", undefined, 1);
      expect(p2pApi.p2pSend).toHaveBeenCalledTimes(3);
    });
    const singleOpts = p2pApi.p2pSend.mock.calls[2][0] as P2PSendOpts;
    // 单连接也失败 → 回退服务器中转
    singleOpts.callbacks.onError("reverse 单连接也失败");
    expect(s.songTransfer.channel).toBe("server");
  });

  it("reverse 反向打洞成功 → channel 标记 p2p，收齐后直接合并", async () => {
    const s = useMusicStore();
    s.djUserId = "dj-1";
    musicSyncApi.musicSyncRequestSong.mockResolvedValue(undefined);
    musicApi.musicFinalizeSong.mockResolvedValue({ success: true });
    musicSyncApi.musicReceiveSongChunkBin.mockResolvedValue({ success: true });
    await s.startSongTransfer("song-x", 0);
    const opts = p2pApi.p2pReceive.mock.calls[0][0] as P2PReceiveOpts;
    opts.callbacks.onError("P2P 建连超时"); // 正常方向失败 → reverse
    await vi.waitFor(() => {
      // v4.7.7：reverse 并行 K=2 建两条连接
      expect(p2pApi.p2pSend).toHaveBeenCalledTimes(2);
    });
    const sendOpts0 = p2pApi.p2pSend.mock.calls[0][0] as P2PSendOpts & {
      onChunk: (chunk: Uint8Array, index: number, total: number, base?: number, globalChunks?: number) => Promise<void>;
    };
    const sendOpts1 = p2pApi.p2pSend.mock.calls[1][0] as P2PSendOpts & {
      onChunk: (chunk: Uint8Array, index: number, total: number, base?: number, globalChunks?: number) => Promise<void>;
    };
    sendOpts0.callbacks.onOpen?.();
    expect(s.songTransfer.channel).toBe("p2p");
    // 两条并行连接各自收齐一段：段0 全局 0..2，段1 全局 2..4（baseChunk 由 meta 携带；
    // 4.7.8 持有端各段 meta 同时声明 globalChunks=4 → 收齐判定用权威总数，不提前合并）
    await sendOpts0.onChunk(new Uint8Array([1]), 0, 2, 0, 4);
    await sendOpts0.onChunk(new Uint8Array([2]), 1, 2, 0, 4);
    sendOpts0.callbacks.onComplete();
    await sendOpts1.onChunk(new Uint8Array([3]), 0, 2, 2, 4);
    await sendOpts1.onChunk(new Uint8Array([4]), 1, 2, 2, 4);
    sendOpts1.callbacks.onComplete();
    // 全部段收齐 → 直接合并（全局 total = 4）
    await vi.waitFor(() => {
      expect(musicApi.musicFinalizeSong).toHaveBeenCalledWith("song-x", 4);
    });
  });

  it("reverse 并行：一条连接传完全部数据（旧持有端单连接场景），另一条迟到失败 → 不丢弃已收数据直接合并", async () => {
    const s = useMusicStore();
    s.djUserId = "dj-1";
    musicSyncApi.musicSyncRequestSong.mockResolvedValue(undefined);
    musicApi.musicFinalizeSong.mockResolvedValue({ success: true });
    musicSyncApi.musicReceiveSongChunkBin.mockResolvedValue({ success: true });
    await s.startSongTransfer("song-x", 0);
    const opts = p2pApi.p2pReceive.mock.calls[0][0] as P2PReceiveOpts;
    opts.callbacks.onError("P2P 建连超时"); // 正常方向失败 → reverse
    await vi.waitFor(() => expect(p2pApi.p2pSend).toHaveBeenCalledTimes(2));
    const sendOpts0 = p2pApi.p2pSend.mock.calls[0][0] as P2PSendOpts & {
      onChunk: (chunk: Uint8Array, index: number, total: number, base?: number, globalChunks?: number) => Promise<void>;
    };
    const sendOpts1 = p2pApi.p2pSend.mock.calls[1][0] as P2PSendOpts & {
      onChunk: (chunk: Uint8Array, index: number, total: number, base?: number, globalChunks?: number) => Promise<void>;
    };
    sendOpts0.callbacks.onOpen?.();
    expect(s.songTransfer.channel).toBe("p2p");
    // 旧持有端（4.7.6）忽略 parallel → 只有一条连接被匹配，传完全部 0..3 片（meta totalChunks=4，
    // 无 globalChunks → 退回 max 估算；单连接场景估算即真实总数，不会提前合并）
    await sendOpts0.onChunk(new Uint8Array([1]), 0, 4);
    await sendOpts0.onChunk(new Uint8Array([2]), 1, 4);
    await sendOpts0.onChunk(new Uint8Array([3]), 2, 4);
    await sendOpts0.onChunk(new Uint8Array([4]), 3, 4);
    // 数据收齐即合并，不等第二条死连接（v4.7.7 修复：之前等 doneCount>=K，死连接超时才把
    // 已传完的数据弃掉整体从 0 重传 → 实测"传到一半卡住→标签消失→从0开始"）
    await vi.waitFor(() => {
      expect(musicApi.musicFinalizeSong).toHaveBeenCalledWith("song-x", 4);
    });
    // 第二条连接（offer 无匹配被丢弃）迟到超时失败 → 已完成的传输不受影响，不重启
    sendOpts1.callbacks.onError("reverse 连接超时");
    expect(p2pApi.p2pSend).toHaveBeenCalledTimes(2);
    expect(musicSyncApi.musicSyncReverseRequest).toHaveBeenCalledTimes(1);
  });

  it("reverse 并行：received 钳制到全局上界，不累计越界（百分比不超 100）", async () => {
    const s = useMusicStore();
    s.djUserId = "dj-1";
    musicSyncApi.musicSyncRequestSong.mockResolvedValue(undefined);
    musicApi.musicFinalizeSong.mockResolvedValue({ success: true });
    musicSyncApi.musicReceiveSongChunkBin.mockResolvedValue({ success: true });
    await s.startSongTransfer("song-x", 0);
    const opts = p2pApi.p2pReceive.mock.calls[0][0] as P2PReceiveOpts;
    opts.callbacks.onError("P2P 建连超时");
    await vi.waitFor(() => expect(p2pApi.p2pSend).toHaveBeenCalledTimes(2));
    const sendOpts0 = p2pApi.p2pSend.mock.calls[0][0] as P2PSendOpts & {
      onChunk: (chunk: Uint8Array, index: number, total: number, base?: number, globalChunks?: number) => Promise<void>;
    };
    sendOpts0.callbacks.onOpen?.();
    // 段0：全局 0..1（base 0）；段1 meta 未到前 received 不会超过已确认的上界
    await sendOpts0.onChunk(new Uint8Array([1]), 0, 2, 0, 4);
    await sendOpts0.onChunk(new Uint8Array([2]), 1, 2, 0, 4);
    expect(s.songTransfer.received).toBeLessThanOrEqual(s.songTransfer.total);
  });

  it("收到服务器中转分片 → channel 标记为 server（前端可观察）", async () => {
    const s = useMusicStore();
    s.djUserId = "dj-1";
    musicSyncApi.musicSyncRequestSong.mockResolvedValue(undefined);
    await s.startSongTransfer("song-x", 0);
    musicApi.musicReceiveSongChunk.mockResolvedValue({ success: true });
    s.handleSyncWsEvent({
      type: "music:song_chunk",
      song_id: "song-x",
      chunk_index: 0,
      total_chunks: 2,
      chunk_size: 128,
      data_base64: "AQ==",
    });
    // handleSongChunk 为异步执行（void 分发），需等待落盘完成再断言
    await vi.waitFor(() => {
      expect(s.songTransfer.channel).toBe("server");
      expect(s.songTransfer.received).toBe(1);
    });
  });

  it("DJ 收到带 p2p+requester_user_id 的请求 → 先 P2P 直传，完成通知服务器清理", async () => {
    const s = useMusicStore();
    s.trackName = "song-x";
    musicSyncApi.musicReadSongChunkBin.mockResolvedValue({ success: true, total_chunks: 2, chunk_size: 1024, data: [1] });
    musicSyncApi.musicSyncTransferDone.mockResolvedValue(undefined);
    s.handleSyncWsEvent({ type: "music:song_requested", song_id: "song-x", requester_user_id: "listener-1", p2p: true });
    await vi.waitFor(() => {
      expect(p2pApi.p2pSend).toHaveBeenCalledTimes(1);
    });
    const sendOpts = p2pApi.p2pSend.mock.calls[0][0] as P2PSendOpts;
    expect(sendOpts.peerId).toBe("listener-1");
    expect(sendOpts.role).toBe("offerer");
    expect(sendOpts.totalBytes).toBe(2048);
    // 直传完成 → transfer_done 清理服务器传输状态（含 wait_all 检查）
    sendOpts.callbacks.onComplete();
    await vi.waitFor(() => {
      expect(musicSyncApi.musicSyncTransferDone).toHaveBeenCalledWith("song-x");
    });
    // 媒体数据不经服务器中转
    expect(musicSyncApi.musicSyncOfferSong).not.toHaveBeenCalled();
  });

  it("DJ P2P 直传失败 → 自动回退服务器中转分片循环", async () => {
    const s = useMusicStore();
    s.trackName = "song-x";
    musicSyncApi.musicReadSongChunkBin.mockResolvedValue({ success: true, total_chunks: 1, chunk_size: 10, data: [1] });
    musicApi.musicReadSongChunk.mockResolvedValue({ success: true, total_chunks: 1, chunk_size: 10, data_base64: "AQ==" });
    musicSyncApi.musicSyncOfferSong.mockResolvedValue(undefined);
    musicSyncApi.musicSyncTransferDone.mockResolvedValue(undefined);
    s.handleSyncWsEvent({ type: "music:song_requested", song_id: "song-x", requester_user_id: "listener-1", p2p: true });
    await vi.waitFor(() => expect(p2pApi.p2pSend).toHaveBeenCalledTimes(1));
    // P2P 失败 → 回退服务器中转（musicSyncOfferSong 开始回传分片）
    const sendOpts = p2pApi.p2pSend.mock.calls[0][0] as P2PSendOpts;
    sendOpts.callbacks.onError("P2P 建连超时");
    await vi.waitFor(() => {
      expect(musicSyncApi.musicSyncOfferSong).toHaveBeenCalled();
    });
  });

  it("DJ 收到无 p2p 标志的请求（老客户端）→ 直接服务器中转，不尝试 P2P", async () => {
    const s = useMusicStore();
    s.trackName = "song-x";
    musicApi.musicReadSongChunk.mockResolvedValue({ success: true, total_chunks: 1, chunk_size: 10, data_base64: "AQ==" });
    musicSyncApi.musicSyncOfferSong.mockResolvedValue(undefined);
    musicSyncApi.musicSyncTransferDone.mockResolvedValue(undefined);
    s.handleSyncWsEvent({ type: "music:song_requested", song_id: "song-x" });
    await vi.waitFor(() => {
      expect(musicSyncApi.musicSyncOfferSong).toHaveBeenCalled();
    });
    expect(p2pApi.p2pSend).not.toHaveBeenCalled();
  });
});
