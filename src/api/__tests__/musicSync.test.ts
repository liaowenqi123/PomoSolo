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
  musicSyncRequestSong,
  musicReadSongChunkBin,
  musicReceiveSongChunkBin,
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

  it("musicSyncRequestSong 默认不带 p2p 标志（老客户端无感）", async () => {
    invokeMock.mockResolvedValue(undefined);
    await musicSyncRequestSong("song-1");
    expect(invokeMock).toHaveBeenCalledWith("music_sync_request_song", {
      songId: "song-1",
      fromChunk: 0,
      p2p: false,
    });
  });

  it("musicSyncRequestSong 带 p2p=true 与 fromChunk（Phase 1 直连标志）", async () => {
    invokeMock.mockResolvedValue(undefined);
    await musicSyncRequestSong("song-1", 3, true);
    expect(invokeMock).toHaveBeenCalledWith("music_sync_request_song", {
      songId: "song-1",
      fromChunk: 3,
      p2p: true,
    });
  });

  it("musicReadSongChunkBin 应调用 invoke('music_read_song_chunk_bin')", async () => {
    invokeMock.mockResolvedValue({ success: true, total_chunks: 2, chunk_size: 131072, data: [1, 2, 3] });
    const res = await musicReadSongChunkBin("song-1", 0);
    expect(invokeMock).toHaveBeenCalledWith("music_read_song_chunk_bin", { songName: "song-1", chunkIndex: 0 });
    expect(res.total_chunks).toBe(2);
    expect(res.data).toEqual([1, 2, 3]);
  });

  it("musicReceiveSongChunkBin 应调用 invoke('music_receive_song_chunk_bin') 并透传二进制数组", async () => {
    invokeMock.mockResolvedValue({ success: true });
    const bytes = [104, 101, 108, 108, 111];
    const res = await musicReceiveSongChunkBin("song-1", 0, 5, bytes);
    expect(invokeMock).toHaveBeenCalledWith("music_receive_song_chunk_bin", {
      songName: "song-1",
      chunkIndex: 0,
      totalChunks: 5,
      data: bytes,
    });
    expect(res.success).toBe(true);
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
