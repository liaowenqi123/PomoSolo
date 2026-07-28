import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  chartsFetch,
  downloadSong,
  getDownloadStatus,
} from "../charts";

describe("api/charts", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("chartsFetch 应调用 invoke('charts_fetch', { source }) 并返回结果", async () => {
    const ret = {
      success: true,
      songs: [{ rank: 1, title: "t", artist: "a", album: "al" }],
    };
    invokeMock.mockResolvedValue(ret);
    const result = await chartsFetch("netease");
    expect(invokeMock).toHaveBeenCalledWith("charts_fetch", { source: "netease" });
    expect(result).toEqual(ret);
  });

  it("chartsFetch 支持 qq 源", async () => {
    invokeMock.mockResolvedValue({ success: true, songs: [] });
    await chartsFetch("qq");
    expect(invokeMock).toHaveBeenCalledWith("charts_fetch", { source: "qq" });
  });

  it("downloadSong 应调用 invoke('download_song', { title, artist })", async () => {
    const ret = { success: true, status: "success" as const };
    invokeMock.mockResolvedValue(ret);
    const result = await downloadSong("我的歌", "歌手");
    expect(invokeMock).toHaveBeenCalledWith("download_song", {
      title: "我的歌",
      artist: "歌手",
    });
    expect(result).toEqual(ret);
  });

  it("getDownloadStatus 应调用 invoke('get_download_status')", async () => {
    const ret = { isDownloading: false };
    invokeMock.mockResolvedValue(ret);
    const result = await getDownloadStatus();
    expect(invokeMock).toHaveBeenCalledWith("get_download_status");
    expect(result).toEqual(ret);
  });

  it("invoke 抛错时应向上传播", async () => {
    invokeMock.mockRejectedValue(new Error("net error"));
    await expect(chartsFetch("netease")).rejects.toThrow("net error");
    await expect(downloadSong("t", "a")).rejects.toThrow("net error");
    await expect(getDownloadStatus()).rejects.toThrow("net error");
  });

  it("各命令使用不同的 command 名", async () => {
    invokeMock.mockResolvedValue({ success: true });
    await chartsFetch("netease");
    await downloadSong("t", "a");
    await getDownloadStatus();
    const names = invokeMock.mock.calls.map((c) => c[0]);
    expect(names).toEqual(["charts_fetch", "download_song", "get_download_status"]);
  });
});
