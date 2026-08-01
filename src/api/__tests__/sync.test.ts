import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  cloudSyncPullSettings,
  cloudSyncPushSettings,
  cloudUploadPomodoroRecords,
} from "../sync";

describe("api/sync", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("cloudSyncPullSettings 应调用 invoke('cloud_sync_pull_settings') 并返回云端设置", async () => {
    const cloud = { settings: { theme: "dark" }, updated_at: "2026-08-01T00:00:00Z" };
    invokeMock.mockResolvedValue(cloud);
    const result = await cloudSyncPullSettings();
    expect(invokeMock).toHaveBeenCalledWith("cloud_sync_pull_settings");
    expect(result).toEqual(cloud);
  });

  it("cloudSyncPushSettings 应调用 invoke('cloud_sync_push_settings')", async () => {
    invokeMock.mockResolvedValue(true);
    const result = await cloudSyncPushSettings();
    expect(invokeMock).toHaveBeenCalledWith("cloud_sync_push_settings");
    expect(result).toBe(true);
  });

  it("cloudUploadPomodoroRecords 应调用 invoke('cloud_upload_pomodoro_records', { records })", async () => {
    const records = [
      { mode: "focus", duration: 1500, completed: true },
      { mode: "short_break", duration: 300 },
    ];
    invokeMock.mockResolvedValue(2);
    const result = await cloudUploadPomodoroRecords(records);
    expect(invokeMock).toHaveBeenCalledWith("cloud_upload_pomodoro_records", {
      records,
    });
    expect(result).toBe(2);
  });

  it("空记录列表应直接返回 0（不调用后端）", async () => {
    const result = await cloudUploadPomodoroRecords([]);
    expect(result).toBe(0);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("invoke 抛错时应向上传播", async () => {
    invokeMock.mockRejectedValue(new Error("backend error"));
    await expect(cloudSyncPullSettings()).rejects.toThrow("backend error");
    await expect(cloudSyncPushSettings()).rejects.toThrow("backend error");
    await expect(cloudUploadPomodoroRecords([{ mode: "focus", duration: 1 }])).rejects.toThrow(
      "backend error",
    );
  });
});
