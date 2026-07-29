import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock @tauri-apps/api/core 的 invoke 函数
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// Mock @tauri-apps/api/event 的 listen 函数
const listenMock = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

import {
  foregroundIsReady,
  foregroundStart,
  foregroundStop,
  foregroundGetStatus,
  foregroundSetApiKey,
  FOREGROUND_EVENTS,
  onForegroundReady,
  onForegroundApiKeyInvalid,
  onForegroundEntertainmentDetected,
  onForegroundStatus,
  onForegroundError,
} from "../foreground";

describe("api/foreground", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockReset();
    // listen 默认返回一个 unlisten 函数
    listenMock.mockResolvedValue(vi.fn());
  });

  // ===== 命令调用 =====

  it("foregroundIsReady 应调用 invoke('foreground_is_ready') 无参数", async () => {
    invokeMock.mockResolvedValue(true);

    const result = await foregroundIsReady();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("foreground_is_ready");
    expect(result).toBe(true);
  });

  it("foregroundStart 应调用 invoke('foreground_start') 无参数", async () => {
    invokeMock.mockResolvedValue(undefined);

    await foregroundStart();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("foreground_start");
  });

  it("foregroundStop 应调用 invoke('foreground_stop') 无参数", async () => {
    invokeMock.mockResolvedValue(undefined);

    await foregroundStop();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("foreground_stop");
  });

  it("foregroundGetStatus 应调用 invoke('foreground_get_status') 无参数", async () => {
    const fakeStatus = { running: true, hasApiKey: true };
    invokeMock.mockResolvedValue(fakeStatus);

    const result = await foregroundGetStatus();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("foreground_get_status");
    expect(result).toEqual(fakeStatus);
  });

  it("foregroundGetStatus 未运行时应返回 null", async () => {
    invokeMock.mockResolvedValue(null);

    const result = await foregroundGetStatus();
    expect(result).toBeNull();
  });

  it("foregroundSetApiKey 应调用 invoke('foreground_set_api_key', { apiKey: key })", async () => {
    invokeMock.mockResolvedValue(undefined);

    await foregroundSetApiKey("sk-test123");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("foreground_set_api_key", {
      apiKey: "sk-test123",
    });
  });

  // ===== 错误传播 =====

  it("invoke 抛错时应向上传播错误", async () => {
    invokeMock.mockRejectedValue(new Error("backend error"));

    await expect(foregroundIsReady()).rejects.toThrow("backend error");
    await expect(foregroundStart()).rejects.toThrow("backend error");
    await expect(foregroundStop()).rejects.toThrow("backend error");
    await expect(foregroundGetStatus()).rejects.toThrow("backend error");
    await expect(foregroundSetApiKey("sk-x")).rejects.toThrow("backend error");
  });

  // ===== 事件常量 =====

  it("FOREGROUND_EVENTS 应包含所有事件名常量", () => {
    expect(FOREGROUND_EVENTS.ready).toBe("foreground-ready");
    expect(FOREGROUND_EVENTS.apiKeyInvalid).toBe("foreground-api-key-invalid");
    expect(FOREGROUND_EVENTS.entertainmentDetected).toBe(
      "foreground-entertainment-detected",
    );
    expect(FOREGROUND_EVENTS.status).toBe("foreground-status");
    expect(FOREGROUND_EVENTS.error).toBe("foreground-error");
  });

  // ===== 事件监听 =====

  it("onForegroundReady 应调用 listen('foreground-ready', handler)", async () => {
    const handler = vi.fn();

    await onForegroundReady(handler);

    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(listenMock).toHaveBeenCalledWith("foreground-ready", handler);
  });

  it("onForegroundApiKeyInvalid 应调用 listen('foreground-api-key-invalid', handler)", async () => {
    const handler = vi.fn();

    await onForegroundApiKeyInvalid(handler);

    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(listenMock).toHaveBeenCalledWith(
      "foreground-api-key-invalid",
      handler,
    );
  });

  it("onForegroundEntertainmentDetected 应调用 listen('foreground-entertainment-detected', handler)", async () => {
    const handler = vi.fn();

    await onForegroundEntertainmentDetected(handler);

    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(listenMock).toHaveBeenCalledWith(
      "foreground-entertainment-detected",
      handler,
    );
  });

  it("onForegroundStatus 应调用 listen('foreground-status', handler)", async () => {
    const handler = vi.fn();

    await onForegroundStatus(handler);

    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(listenMock).toHaveBeenCalledWith("foreground-status", handler);
  });

  it("onForegroundError 应调用 listen('foreground-error', handler)", async () => {
    const handler = vi.fn();

    await onForegroundError(handler);

    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(listenMock).toHaveBeenCalledWith("foreground-error", handler);
  });

  it("各监听函数应使用不同的事件名", async () => {
    const handler = vi.fn();

    await onForegroundReady(handler);
    await onForegroundApiKeyInvalid(handler);
    await onForegroundEntertainmentDetected(handler);
    await onForegroundStatus(handler);
    await onForegroundError(handler);

    const eventNames = listenMock.mock.calls.map((c) => c[0]);
    const unique = new Set(eventNames);
    expect(unique.size).toBe(eventNames.length);
    expect(eventNames).toContain("foreground-ready");
    expect(eventNames).toContain("foreground-api-key-invalid");
    expect(eventNames).toContain("foreground-entertainment-detected");
    expect(eventNames).toContain("foreground-status");
    expect(eventNames).toContain("foreground-error");
  });

  it("listen 应返回 unlisten 函数（透传 Promise<UnlistenFn>）", async () => {
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);

    const result = await onForegroundReady(vi.fn());

    expect(result).toBe(unlisten);
  });

  it("listen 抛错时应向上传播错误", async () => {
    listenMock.mockRejectedValue(new Error("listen failed"));

    await expect(onForegroundReady(vi.fn())).rejects.toThrow("listen failed");
  });
});
