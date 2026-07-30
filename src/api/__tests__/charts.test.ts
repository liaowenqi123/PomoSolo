import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock @tauri-apps/api/core 的 invoke 函数
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  chartsFetch,
  downloadSong,
  getDownloadStatus,
  setApiKey,
} from "../charts";

describe("api/charts", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  // ===== chartsFetch =====

  it("chartsFetch 应调用 invoke('charts_fetch', { source })", async () => {
    const fakeResult = { success: true, songs: [] };
    invokeMock.mockResolvedValue(fakeResult);

    const result = await chartsFetch("netease");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("charts_fetch", {
      source: "netease",
    });
    expect(result).toEqual(fakeResult);
  });

  it("chartsFetch source='qq' 时应透传", async () => {
    invokeMock.mockResolvedValue({ success: true, songs: [] });

    await chartsFetch("qq");

    expect(invokeMock).toHaveBeenCalledWith("charts_fetch", { source: "qq" });
  });

  // ===== downloadSong =====

  it("downloadSong 应调用 invoke('download_song', { title, artist })", async () => {
    invokeMock.mockResolvedValue({ success: true, status: "downloaded" });

    const result = await downloadSong("晴天", "周杰伦");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("download_song", {
      title: "晴天",
      artist: "周杰伦",
    });
    expect(result).toEqual({ success: true, status: "downloaded" });
  });

  it("downloadSong artist 为空串时应透传空串", async () => {
    invokeMock.mockResolvedValue({ success: true, status: "exists" });

    await downloadSong("七里香", "");

    expect(invokeMock).toHaveBeenCalledWith("download_song", {
      title: "七里香",
      artist: "",
    });
  });

  // ===== getDownloadStatus =====

  it("getDownloadStatus 应调用 invoke('get_download_status') 无参数", async () => {
    const fakeStatus = { isDownloading: false, queueLength: 0 };
    invokeMock.mockResolvedValue(fakeStatus);

    const result = await getDownloadStatus();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("get_download_status");
    expect(result).toEqual(fakeStatus);
  });

  it("getDownloadStatus 正在下载时应返回 currentSong", async () => {
    const fakeStatus = {
      isDownloading: true,
      currentSong: { title: "稻香", artist: "周杰伦" },
      queueLength: 0,
    };
    invokeMock.mockResolvedValue(fakeStatus);

    const result = await getDownloadStatus();

    expect(result).toEqual(fakeStatus);
  });

  // ===== setApiKey（修复 4.6 Bug 的新增命令） =====

  it("setApiKey 应调用 invoke('charts_set_api_key', { apiKey })", async () => {
    invokeMock.mockResolvedValue(undefined);

    await setApiKey("sk-mykey");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    // 注意：参数名为 apiKey（camelCase），与 Rust 端约定一致
    expect(invokeMock).toHaveBeenCalledWith("charts_set_api_key", {
      apiKey: "sk-mykey",
    });
  });

  it("setApiKey 传空串时应将空串透传给后端（用于清空内存 Key）", async () => {
    invokeMock.mockResolvedValue(undefined);

    await setApiKey("");

    expect(invokeMock).toHaveBeenCalledWith("charts_set_api_key", {
      apiKey: "",
    });
  });

  // ===== 错误传播 =====

  it("invoke 抛错时应向上传播错误", async () => {
    invokeMock.mockRejectedValue(new Error("backend error"));

    await expect(chartsFetch("netease")).rejects.toThrow("backend error");
    await expect(downloadSong("a", "b")).rejects.toThrow("backend error");
    await expect(getDownloadStatus()).rejects.toThrow("backend error");
    await expect(setApiKey("sk-x")).rejects.toThrow("backend error");
  });

  // ===== 各命令名应互不相同 =====

  it("所有命令名应互不相同（防止笔误）", async () => {
    invokeMock.mockResolvedValue(undefined);

    await chartsFetch("netease");
    await downloadSong("a", "b");
    await getDownloadStatus();
    await setApiKey("sk-x");

    const cmdNames = invokeMock.mock.calls.map((c) => c[0]);
    const unique = new Set(cmdNames);
    expect(unique.size).toBe(cmdNames.length);
  });
});
