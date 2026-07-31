import { describe, it, expect, beforeEach, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { autostartEnable, autostartIsEnabled } from "../system";

describe("api/system", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("autostartEnable(true) 应调用 invoke('autostart_enable', { enabled: true })", async () => {
    invokeMock.mockResolvedValue(true);

    const result = await autostartEnable(true);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("autostart_enable", { enabled: true });
    expect(result).toBe(true);
  });

  it("autostartEnable(false) 应调用 invoke('autostart_enable', { enabled: false })", async () => {
    invokeMock.mockResolvedValue(false);

    const result = await autostartEnable(false);

    expect(invokeMock).toHaveBeenCalledWith("autostart_enable", { enabled: false });
    expect(result).toBe(false);
  });

  it("autostartEnable 返回系统实际状态（可能与请求不同）", async () => {
    // 请求开启但系统返回 false（权限不足等）
    invokeMock.mockResolvedValue(false);

    const result = await autostartEnable(true);

    expect(result).toBe(false);
  });

  it("autostartIsEnabled 应调用 invoke('autostart_is_enabled') 无参数", async () => {
    invokeMock.mockResolvedValue(true);

    const result = await autostartIsEnabled();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("autostart_is_enabled");
    expect(result).toBe(true);
  });

  it("autostartEnable invoke 抛错时应向上传播", async () => {
    invokeMock.mockRejectedValue(new Error("autostart error"));

    await expect(autostartEnable(true)).rejects.toThrow("autostart error");
  });

  it("autostartIsEnabled invoke 抛错时应向上传播", async () => {
    invokeMock.mockRejectedValue(new Error("query error"));

    await expect(autostartIsEnabled()).rejects.toThrow("query error");
  });

  it("autostartEnable 参数名应为 enabled（camelCase）", async () => {
    invokeMock.mockResolvedValue(true);
    await autostartEnable(true);

    const callArgs = invokeMock.mock.calls[0];
    expect(callArgs[0]).toBe("autostart_enable");
    expect(callArgs[1]).toEqual({ enabled: true });
    const argObj = callArgs[1] as Record<string, unknown>;
    expect(argObj["enabled"]).toBe(true);
  });

  it("autostartIsEnabled 不应传递第二个参数", async () => {
    invokeMock.mockResolvedValue(false);
    await autostartIsEnabled();

    const callArgs = invokeMock.mock.calls[0];
    expect(callArgs).toHaveLength(1);
    expect(callArgs[0]).toBe("autostart_is_enabled");
  });
});
