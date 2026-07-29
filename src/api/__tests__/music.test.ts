import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock @tauri-apps/api/core 的 invoke 函数
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

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
} from "../music";

describe("api/music", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("musicTogglePlay 应调用 invoke('music_toggle_play') 无参数", async () => {
    invokeMock.mockResolvedValue(undefined);
    await musicTogglePlay();
    expect(invokeMock).toHaveBeenCalledWith("music_toggle_play");
  });

  it("musicNext 应调用 invoke('music_next')", async () => {
    invokeMock.mockResolvedValue(undefined);
    await musicNext();
    expect(invokeMock).toHaveBeenCalledWith("music_next");
  });

  it("musicPrev 应调用 invoke('music_prev')", async () => {
    invokeMock.mockResolvedValue(undefined);
    await musicPrev();
    expect(invokeMock).toHaveBeenCalledWith("music_prev");
  });

  it("musicSeek 应调用 invoke('music_seek', { seconds })", async () => {
    invokeMock.mockResolvedValue(undefined);
    await musicSeek(42);
    expect(invokeMock).toHaveBeenCalledWith("music_seek", { seconds: 42 });
  });

  it("musicSetVolume 应调用 invoke('music_set_volume', { volume })", async () => {
    invokeMock.mockResolvedValue(undefined);
    await musicSetVolume(0.5);
    expect(invokeMock).toHaveBeenCalledWith("music_set_volume", { volume: 0.5 });
  });

  it("musicSetPlayMode 应调用 invoke('music_set_play_mode', { mode })", async () => {
    invokeMock.mockResolvedValue(undefined);
    await musicSetPlayMode("loop");
    expect(invokeMock).toHaveBeenCalledWith("music_set_play_mode", { mode: "loop" });
  });

  it("musicGetStatus 应调用 invoke('music_get_status') 并返回状态", async () => {
    const status = { playing: true, name: "a.mp3", current: 5, duration: 200 };
    invokeMock.mockResolvedValue(status);
    const result = await musicGetStatus();
    expect(invokeMock).toHaveBeenCalledWith("music_get_status");
    expect(result).toEqual(status);
  });

  it("musicGetPlaylist 应调用 invoke('music_get_playlist') 并返回列表", async () => {
    const playlist = { songs: ["a.mp3", "b.mp3"], current_song: "a.mp3" };
    invokeMock.mockResolvedValue(playlist);
    const result = await musicGetPlaylist();
    expect(invokeMock).toHaveBeenCalledWith("music_get_playlist");
    expect(result).toEqual(playlist);
  });

  it("musicGetDevices 应调用 invoke('music_get_devices') 并返回设备", async () => {
    const payload = { devices: [{ id: 1, name: "Dev", hostapi: "x" }], current: 1 };
    invokeMock.mockResolvedValue(payload);
    const result = await musicGetDevices();
    expect(invokeMock).toHaveBeenCalledWith("music_get_devices");
    expect(result).toEqual(payload);
  });

  it("musicSetDevice 应调用 invoke('music_set_device', { deviceId })", async () => {
    invokeMock.mockResolvedValue(undefined);
    await musicSetDevice(3);
    expect(invokeMock).toHaveBeenCalledWith("music_set_device", { deviceId: 3 });
  });

  it("musicPlaySong 应调用 invoke('music_play_song', { songName })", async () => {
    invokeMock.mockResolvedValue(undefined);
    await musicPlaySong("song.mp3");
    expect(invokeMock).toHaveBeenCalledWith("music_play_song", { songName: "song.mp3" });
  });

  it("musicDeleteSong 应调用 invoke('music_delete_song', { songName }) 并返回结果", async () => {
    const ret = { success: true };
    invokeMock.mockResolvedValue(ret);
    const result = await musicDeleteSong("song.mp3");
    expect(invokeMock).toHaveBeenCalledWith("music_delete_song", { songName: "song.mp3" });
    expect(result).toEqual(ret);
  });

  it("musicGetCustomTags 应调用 invoke('music_get_custom_tags')", async () => {
    const ret = { success: true, customTags: { jazz: "#fff" } };
    invokeMock.mockResolvedValue(ret);
    const result = await musicGetCustomTags();
    expect(invokeMock).toHaveBeenCalledWith("music_get_custom_tags");
    expect(result).toEqual(ret);
  });

  it("musicAddCustomTag 应调用 invoke('music_add_custom_tag', { tagName, color })", async () => {
    invokeMock.mockResolvedValue({ success: true });
    await musicAddCustomTag("jazz", "#ff0000");
    expect(invokeMock).toHaveBeenCalledWith("music_add_custom_tag", {
      tagName: "jazz",
      color: "#ff0000",
    });
  });

  it("musicDeleteCustomTag 应调用 invoke('music_delete_custom_tag', { tagName })", async () => {
    invokeMock.mockResolvedValue({ success: true });
    await musicDeleteCustomTag("jazz");
    expect(invokeMock).toHaveBeenCalledWith("music_delete_custom_tag", {
      tagName: "jazz",
    });
  });

  it("musicUpdateTag 应调用 invoke('music_update_tag', { songName, tag, color })", async () => {
    invokeMock.mockResolvedValue({ success: true });
    await musicUpdateTag("song.mp3", "jazz", "#ff0000");
    expect(invokeMock).toHaveBeenCalledWith("music_update_tag", {
      songName: "song.mp3",
      tag: "jazz",
      color: "#ff0000",
    });
  });

  it("musicUpdateTag 支持 color=null", async () => {
    invokeMock.mockResolvedValue({ success: true });
    await musicUpdateTag("song.mp3", "jazz", null);
    expect(invokeMock).toHaveBeenCalledWith("music_update_tag", {
      songName: "song.mp3",
      tag: "jazz",
      color: null,
    });
  });

  it("invoke 抛错时应向上传播", async () => {
    invokeMock.mockRejectedValue(new Error("backend error"));
    await expect(musicTogglePlay()).rejects.toThrow("backend error");
    await expect(musicSeek(1)).rejects.toThrow("backend error");
    await expect(musicSetDevice(1)).rejects.toThrow("backend error");
  });

  it("各控制命令使用不同的 command 名", async () => {
    invokeMock.mockResolvedValue(undefined);
    await musicTogglePlay();
    await musicNext();
    await musicPrev();
    await musicSeek(1);
    await musicSetVolume(0.5);
    await musicSetPlayMode("loop");
    const names = invokeMock.mock.calls.map((c) => c[0]);
    expect(names).toEqual([
      "music_toggle_play",
      "music_next",
      "music_prev",
      "music_seek",
      "music_set_volume",
      "music_set_play_mode",
    ]);
  });
});
