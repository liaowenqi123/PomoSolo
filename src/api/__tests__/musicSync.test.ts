import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  musicSyncPlay,
  musicSyncPause,
  musicSyncSeek,
  musicSyncNext,
  musicSyncVolume,
  musicSyncAddSong,
  musicSyncRequestDj,
} from "../musicSync";

describe("api/musicSync", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("musicSyncPlay 应调用 invoke('music_sync_play', { songId, positionMs })", async () => {
    invokeMock.mockResolvedValue(undefined);
    await musicSyncPlay("song-1", 0);
    expect(invokeMock).toHaveBeenCalledWith("music_sync_play", {
      songId: "song-1",
      positionMs: 0,
    });
  });

  it("musicSyncPause 应调用 invoke('music_sync_pause', { positionMs })", async () => {
    invokeMock.mockResolvedValue(undefined);
    await musicSyncPause(12500);
    expect(invokeMock).toHaveBeenCalledWith("music_sync_pause", { positionMs: 12500 });
  });

  it("musicSyncSeek 应调用 invoke('music_sync_seek', { positionMs })", async () => {
    invokeMock.mockResolvedValue(undefined);
    await musicSyncSeek(30000);
    expect(invokeMock).toHaveBeenCalledWith("music_sync_seek", { positionMs: 30000 });
  });

  it("musicSyncNext 应调用 invoke('music_sync_next', { songId })", async () => {
    invokeMock.mockResolvedValue(undefined);
    await musicSyncNext("song-2");
    expect(invokeMock).toHaveBeenCalledWith("music_sync_next", { songId: "song-2" });
  });

  it("musicSyncVolume 应调用 invoke('music_sync_volume', { volume })", async () => {
    invokeMock.mockResolvedValue(undefined);
    await musicSyncVolume(0.8);
    expect(invokeMock).toHaveBeenCalledWith("music_sync_volume", { volume: 0.8 });
  });

  it("musicSyncAddSong 应调用 invoke('music_sync_add_song', { songName, songUrl })", async () => {
    invokeMock.mockResolvedValue(undefined);
    await musicSyncAddSong("夜曲", "https://example.com/yequ.mp3");
    expect(invokeMock).toHaveBeenCalledWith("music_sync_add_song", {
      songName: "夜曲",
      songUrl: "https://example.com/yequ.mp3",
    });
  });

  it("musicSyncRequestDj 应调用 invoke('music_sync_request_dj')", async () => {
    invokeMock.mockResolvedValue(undefined);
    await musicSyncRequestDj();
    expect(invokeMock).toHaveBeenCalledWith("music_sync_request_dj");
  });

  it("invoke 抛错时应向上传播", async () => {
    invokeMock.mockRejectedValue(new Error("backend error"));
    await expect(musicSyncPlay("s", 0)).rejects.toThrow("backend error");
    await expect(musicSyncPause(0)).rejects.toThrow("backend error");
    await expect(musicSyncSeek(0)).rejects.toThrow("backend error");
    await expect(musicSyncNext("s")).rejects.toThrow("backend error");
    await expect(musicSyncVolume(0.5)).rejects.toThrow("backend error");
    await expect(musicSyncAddSong("n", "u")).rejects.toThrow("backend error");
    await expect(musicSyncRequestDj()).rejects.toThrow("backend error");
  });
});
