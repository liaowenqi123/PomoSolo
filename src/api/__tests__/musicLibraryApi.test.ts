import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  musicPeekNext,
  musicSetAutoNext,
  musicPlaySongAt,
  musicSetPlaylist,
  musicClearPlaylist,
  musicMoveSong,
  musicMoveSongs,
  musicMoveSongIfDefault,
  musicSetSongTags,
  musicRenameDir,
  musicCreateDir,
  musicDeleteDir,
  musicReadSongChunk,
  musicReceiveSongChunk,
  musicFinalizeSong,
} from "../music";

describe("api/music · 音乐库与 P2P 命令", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("musicPeekNext 返回可空歌名", async () => {
    invokeMock.mockResolvedValue("next.mp3");
    await expect(musicPeekNext()).resolves.toBe("next.mp3");
    expect(invokeMock).toHaveBeenCalledWith("music_peek_next");
  });

  it("musicSetAutoNext 传 enabled", async () => {
    await musicSetAutoNext(false);
    expect(invokeMock).toHaveBeenCalledWith("music_set_auto_next", { enabled: false });
  });

  it("musicPlaySongAt 传 songName/positionSec", async () => {
    await musicPlaySongAt("a.mp3", 12.5);
    expect(invokeMock).toHaveBeenCalledWith("music_play_song_at", {
      songName: "a.mp3",
      positionSec: 12.5,
    });
  });

  it("集合命令：set/clear", async () => {
    await musicSetPlaylist(["a.mp3", "b.mp3"]);
    await musicClearPlaylist();
    expect(invokeMock).toHaveBeenNthCalledWith(1, "music_set_playlist", {
      songs: ["a.mp3", "b.mp3"],
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "music_clear_playlist");
  });

  it("目录移动命令：单首/批量/仅默认", async () => {
    await musicMoveSong("a.mp3", "喜欢");
    await musicMoveSongs(["a.mp3", "b.mp3"], "导入");
    await musicMoveSongIfDefault("c.mp3", "下载");
    expect(invokeMock).toHaveBeenNthCalledWith(1, "music_move_song", {
      song: "a.mp3",
      path: "喜欢",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "music_move_songs", {
      songs: ["a.mp3", "b.mp3"],
      path: "导入",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "music_move_song_if_default", {
      song: "c.mp3",
      defaultPath: "下载",
    });
  });

  it("标签/目录命令：set tags / rename / create / delete", async () => {
    await musicSetSongTags("a.mp3", ["学习", "安静"]);
    await musicRenameDir("导入", "收藏");
    await musicCreateDir("导入/新目录");
    await musicDeleteDir("旧目录");
    expect(invokeMock).toHaveBeenNthCalledWith(1, "music_set_song_tags", {
      song: "a.mp3",
      tags: ["学习", "安静"],
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "music_rename_dir", {
      oldPath: "导入",
      newName: "收藏",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "music_create_dir", {
      path: "导入/新目录",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, "music_delete_dir", {
      path: "旧目录",
    });
  });

  it("P2P 分片命令：read/receive/finalize", async () => {
    await musicReadSongChunk("a.mp3", 2);
    await musicReceiveSongChunk("a.mp3", 2, 10, "base64");
    await musicFinalizeSong("a.mp3", 10);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "music_read_song_chunk", {
      songName: "a.mp3",
      chunkIndex: 2,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "music_receive_song_chunk", {
      songName: "a.mp3",
      chunkIndex: 2,
      totalChunks: 10,
      dataBase64: "base64",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "music_finalize_song", {
      songName: "a.mp3",
      totalChunks: 10,
    });
  });
});
