import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  checkUpdate,
  downloadAndInstall,
  fetchNotice,
  updateSeedDownloadBegin,
  updateSeedDownloadChunk,
  updateSeedDownloadAbort,
} from "../update";
import type { UpdateInfo, UpdateNotice, UpdateStatus, UpdateStatusPayload } from "../update";

describe("api/update", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  // ===== checkUpdate =====

  it("checkUpdate 应调用 invoke('check_update', { source: 'github', allowBeta: false })（默认源+默认不接收 Beta）", async () => {
    const fakeInfo: UpdateInfo = {
      version: "4.2.0",
      notes: "修复若干 bug",
      date: "2026-07-31T00:00:00Z",
    };
    invokeMock.mockResolvedValue(fakeInfo);

    const result = await checkUpdate();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("check_update", {
      source: "github",
      allowBeta: false,
    });
    expect(result).toEqual(fakeInfo);
  });

  it("checkUpdate 应传递指定更新源 server", async () => {
    invokeMock.mockResolvedValue(null);

    await checkUpdate("server");

    expect(invokeMock).toHaveBeenCalledWith("check_update", {
      source: "server",
      allowBeta: false,
    });
  });

  it("checkUpdate 应透传 allowBeta=true（接收 Beta 版本）", async () => {
    invokeMock.mockResolvedValue(null);

    await checkUpdate("server", true);

    expect(invokeMock).toHaveBeenCalledWith("check_update", {
      source: "server",
      allowBeta: true,
    });
  });

  it("checkUpdate 无更新时应返回 null", async () => {
    invokeMock.mockResolvedValue(null);

    const result = await checkUpdate();

    expect(result).toBeNull();
  });

  it("checkUpdate 应保留 date=null 情况", async () => {
    const fakeInfo: UpdateInfo = {
      version: "4.2.0",
      notes: "",
      date: null,
    };
    invokeMock.mockResolvedValue(fakeInfo);

    const result = await checkUpdate();

    expect(result).toEqual(fakeInfo);
    expect(result?.date).toBeNull();
  });

  it("checkUpdate invoke 抛错时应向上传播", async () => {
    invokeMock.mockRejectedValue(new Error("network error"));
    await expect(checkUpdate()).rejects.toThrow("network error");
  });

  // ===== downloadAndInstall =====

  it("downloadAndInstall 应调用 invoke('download_and_install', { source: 'github', allowBeta: false })（默认源+默认不接收 Beta）", async () => {
    invokeMock.mockResolvedValue(undefined);

    await downloadAndInstall();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("download_and_install", {
      source: "github",
      allowBeta: false,
    });
  });

  it("downloadAndInstall 应传递指定更新源 server", async () => {
    invokeMock.mockResolvedValue(undefined);

    await downloadAndInstall("server");

    expect(invokeMock).toHaveBeenCalledWith("download_and_install", {
      source: "server",
      allowBeta: false,
    });
  });

  it("downloadAndInstall 应透传 allowBeta=true（下载 Beta 版本，与检查一致）", async () => {
    invokeMock.mockResolvedValue(undefined);

    await downloadAndInstall("server", true);

    expect(invokeMock).toHaveBeenCalledWith("download_and_install", {
      source: "server",
      allowBeta: true,
    });
  });

  it("downloadAndInstall invoke 抛错时应向上传播", async () => {
    invokeMock.mockRejectedValue(new Error("download failed"));
    await expect(downloadAndInstall()).rejects.toThrow("download failed");
  });

  // ===== 类型约束（编译期保证接口稳定） =====

  it("UpdateStatus 应覆盖所有状态值", () => {
    // 这里通过类型断言确认所有可能的状态字符串
    const statuses: UpdateStatus[] = [
      "checking",
      "available",
      "not-available",
      "downloading",
      "downloaded",
      "error",
    ];
    // 应为 6 种状态（与后端状态机一致）
    expect(statuses).toHaveLength(6);
    expect(new Set(statuses).size).toBe(6);
  });

  it("UpdateStatusPayload 应允许最小载荷（仅 status）", () => {
    // 类型断言：仅 status 必填，其他字段可选
    const payload: UpdateStatusPayload = { status: "checking" };
    expect(payload.status).toBe("checking");
    expect(payload.version).toBeUndefined();
    expect(payload.percent).toBeUndefined();
  });

  it("UpdateStatusPayload 应允许完整载荷", () => {
    const payload: UpdateStatusPayload = {
      status: "downloading",
      version: "4.2.0",
      releaseDate: "2026-07-31T00:00:00Z",
      percent: 50,
      transferred: 1024,
      total: 2048,
      message: "下载中",
    };
    expect(payload.percent).toBe(50);
    expect(payload.transferred).toBe(1024);
    expect(payload.total).toBe(2048);
  });

  // ===== fetchNotice（v4.5.21） =====

  it("fetchNotice 应调用 invoke('fetch_notice', { version })", async () => {
    const fakeNotice: UpdateNotice = {
      active: true,
      level: "warning",
      text: "自动更新异常，请手动升级",
      url: "http://115.159.49.112/updates/PomoSolo_4.5.20_x64-setup.exe",
      min_version: "4.5.15",
      max_version: "4.5.19",
    };
    invokeMock.mockResolvedValue(fakeNotice);

    const result = await fetchNotice("4.5.17");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("fetch_notice", { version: "4.5.17" });
    expect(result).toEqual(fakeNotice);
  });

  it("fetchNotice 无公告时应返回 null", async () => {
    invokeMock.mockResolvedValue(null);

    const result = await fetchNotice("4.5.21");

    expect(result).toBeNull();
  });

  it("fetchNotice 返回的公告应保留完整字段（含空版本范围）", async () => {
    const fakeNotice: UpdateNotice = { active: true, text: "系统维护公告" };
    invokeMock.mockResolvedValue(fakeNotice);

    const result = await fetchNotice("4.5.21");

    expect(result).toEqual(fakeNotice);
    expect(result?.min_version).toBeUndefined();
    expect(result?.max_version).toBeUndefined();
  });

  it("fetchNotice invoke 抛错时应向上传播", async () => {
    invokeMock.mockRejectedValue(new Error("network error"));
    await expect(fetchNotice("4.5.21")).rejects.toThrow("network error");
  });

  // ===== updateSeedDownloadBegin / Chunk / Abort（Phase 2 种子下载） =====

  it("updateSeedDownloadBegin 应调用 invoke('update_seed_download_begin')", async () => {
    invokeMock.mockResolvedValue(undefined);

    await updateSeedDownloadBegin("4.6.0-beta.0", "dW50cnVzdGVk...");

    expect(invokeMock).toHaveBeenCalledWith("update_seed_download_begin", {
      version: "4.6.0-beta.0",
      signature: "dW50cnVzdGVk...",
    });
  });

  it("updateSeedDownloadChunk 应透传分片数据与序号", async () => {
    invokeMock.mockResolvedValue(undefined);

    await updateSeedDownloadChunk([1, 2, 3], 7, 20);

    expect(invokeMock).toHaveBeenCalledWith("update_seed_download_chunk", {
      chunk: [1, 2, 3],
      chunkIndex: 7,
      totalChunks: 20,
    });
  });

  it("updateSeedDownloadAbort 应调用 invoke('update_seed_download_abort')", async () => {
    invokeMock.mockResolvedValue(undefined);

    await updateSeedDownloadAbort();

    expect(invokeMock).toHaveBeenCalledWith("update_seed_download_abort");
  });

  // ===== 命令名互不相同 =====

  it("命令名应互不相同", async () => {
    invokeMock.mockResolvedValue(undefined);
    await checkUpdate();
    await downloadAndInstall();
    await updateSeedDownloadBegin("4.6.0-beta.0", "sig");
    await updateSeedDownloadChunk([1], 0, 1);
    await updateSeedDownloadAbort();
    invokeMock.mockResolvedValue(null);
    await fetchNotice("4.5.21");

    const names = invokeMock.mock.calls.map((c) => c[0]);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
    expect(unique).toEqual(
      new Set([
        "check_update",
        "download_and_install",
        "fetch_notice",
        "update_seed_download_begin",
        "update_seed_download_chunk",
        "update_seed_download_abort",
      ]),
    );
  });
});
