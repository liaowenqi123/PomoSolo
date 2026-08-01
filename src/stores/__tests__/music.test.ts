import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

// Mock api/music 模块（使用 vi.hoisted 避免 hoist 顺序问题）
const musicApi = vi.hoisted(() => ({
  musicTogglePlay: vi.fn(),
  musicNext: vi.fn(),
  musicPrev: vi.fn(),
  musicSeek: vi.fn(),
  musicSetVolume: vi.fn(),
  musicSetPlayMode: vi.fn(),
  musicGetStatus: vi.fn(),
  musicGetPlaylist: vi.fn(),
  musicGetDevices: vi.fn(),
  musicSetDevice: vi.fn(),
  musicPlaySong: vi.fn(),
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
}));
vi.mock("@/api/musicSync", () => musicSyncApi);

// Mock auth store（DJ 身份判断用当前用户 id）
vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ session: { id: "me-1", username: "me", admin: false } }),
}));

import { useMusicStore } from "../music";

describe("useMusicStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    Object.values(musicApi).forEach((fn) => fn.mockReset());
    Object.values(dataApi).forEach((fn) => fn.mockReset());
    Object.values(musicSyncApi).forEach((fn) => fn.mockReset());
    // 默认 resolve 成功
    musicApi.musicDeleteSong.mockResolvedValue({ success: true });
    musicApi.musicGetCustomTags.mockResolvedValue({ success: false });
    musicApi.musicGetStatus.mockResolvedValue(undefined);
    musicApi.musicGetPlaylist.mockResolvedValue({ songs: [] });
    musicApi.musicGetDevices.mockResolvedValue({ devices: [], current: null });
    musicSyncApi.musicSyncRequestDj.mockResolvedValue(undefined);
    musicSyncApi.musicSyncRequestState.mockResolvedValue(undefined);
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

  it("DJ 模式 next/seek/playSong 广播全量状态；setVolume 广播音量", async () => {
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
      expect(musicSyncApi.musicSyncVolume).toHaveBeenCalledWith(0.5);

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

  it("music:state play：听众端跟播（同曲目直接播放并跳转）", () => {
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
    expect(musicApi.musicTogglePlay).toHaveBeenCalled();
    expect(musicApi.musicSeek).toHaveBeenCalled();
    const seekArg = musicApi.musicSeek.mock.calls[0][0] as number;
    expect(seekArg).toBeGreaterThanOrEqual(15);
  });

  it("music:state pause：听众端暂停并跳转", () => {
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
    expect(musicApi.musicTogglePlay).toHaveBeenCalled();
    expect(musicApi.musicSeek).toHaveBeenCalled();
  });

  it("music:state seek：直接跳转到目标位置", () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.isDj = false;
    s.handleSyncWsEvent({
      type: "music:state",
      action: "seek",
      position_ms: 30000,
      timestamp_server: Date.now(),
    });
    expect(musicApi.musicSeek).toHaveBeenCalled();
  });

  it("music:state next：切歌", () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.isDj = false;
    s.handleSyncWsEvent({ type: "music:state", action: "next" });
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

  it("music:volume：听众端同步音量", async () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.isDj = false;
    s.handleSyncWsEvent({ type: "music:volume", volume: 0.4 });
    expect(s.volume).toBe(0.4);
    expect(musicApi.musicSetVolume).toHaveBeenCalledWith(0.4);
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

  it("music:state play：本地歌单含该歌 → 正常播放且不设 missingSongName", () => {
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

  it("music:state play：歌单未加载（空）时缺歌 → 直接触发 P2P 拉取", () => {
    const s = useMusicStore();
    s.setSyncEnabled(true);
    s.isDj = false;
    s.trackName = "old.mp3";
    s.playing = false;
    // playlist 为空（尚未加载完成）→ 不应误判为"本地有"，直接走 P2P 缺歌分支
    s.handleSyncWsEvent({
      type: "music:state",
      action: "play",
      position_ms: 0,
      timestamp_server: Date.now(),
      song_id: "unknown.mp3",
    });
    expect(s.missingSongName).toBe("unknown.mp3");
    expect(s.songTransfer.state).toBe("requesting");
    expect(s.songTransfer.songName).toBe("unknown.mp3");
    expect(musicSyncApi.musicSyncRequestSong).toHaveBeenCalledWith("unknown.mp3");
    // 不应尝试播放（本地未知歌曲）
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
});
