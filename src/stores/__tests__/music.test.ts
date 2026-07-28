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
}));
vi.mock("@/api/music", () => musicApi);

// Mock api/data 模块
const dataApi = vi.hoisted(() => ({
  readData: vi.fn(),
  writeData: vi.fn(),
}));
vi.mock("@/api/data", () => dataApi);

import { useMusicStore } from "../music";

describe("useMusicStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    Object.values(musicApi).forEach((fn) => fn.mockReset());
    Object.values(dataApi).forEach((fn) => fn.mockReset());
    // 默认 resolve 成功
    musicApi.musicDeleteSong.mockResolvedValue({ success: true });
    musicApi.musicGetCustomTags.mockResolvedValue({ success: false });
    musicApi.musicGetStatus.mockResolvedValue(undefined);
    musicApi.musicGetPlaylist.mockResolvedValue({ songs: [] });
    musicApi.musicGetDevices.mockResolvedValue({ devices: [], current: null });
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
});
