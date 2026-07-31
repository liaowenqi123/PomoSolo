import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  checkUpdate,
  downloadAndInstall,
} from "../update";
import type { UpdateInfo, UpdateStatus, UpdateStatusPayload } from "../update";

describe("api/update", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  // ===== checkUpdate =====

  it("checkUpdate 应调用 invoke('check_update') 无参数", async () => {
    const fakeInfo: UpdateInfo = {
      version: "4.2.0",
      notes: "修复若干 bug",
      date: "2026-07-31T00:00:00Z",
    };
    invokeMock.mockResolvedValue(fakeInfo);

    const result = await checkUpdate();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("check_update");
    expect(result).toEqual(fakeInfo);
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

  it("downloadAndInstall 应调用 invoke('download_and_install') 无参数", async () => {
    invokeMock.mockResolvedValue(undefined);

    await downloadAndInstall();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("download_and_install");
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

  // ===== 命令名互不相同 =====

  it("两个命令名应互不相同", async () => {
    invokeMock.mockResolvedValue(undefined);
    await checkUpdate();
    await downloadAndInstall();

    const names = invokeMock.mock.calls.map((c) => c[0]);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
    expect(unique).toEqual(new Set(["check_update", "download_and_install"]));
  });
});
