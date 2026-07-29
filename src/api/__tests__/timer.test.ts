import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock @tauri-apps/api/core 的 invoke 函数
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { getTimerState } from "../timer";

describe("api/timer", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("getTimerState 应调用 invoke('get_timer_state') 且无参数", async () => {
    const mockState = {
      isRunning: false,
      mode: "work",
      remainingMs: 25 * 60 * 1000,
    };
    invokeMock.mockResolvedValue(mockState);

    const result = await getTimerState();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("get_timer_state");
    expect(result).toEqual(mockState);
  });

  it("getTimerState 应返回运行中的状态", async () => {
    const mockState = {
      isRunning: true,
      mode: "work",
      remainingMs: 12 * 60 * 1000,
    };
    invokeMock.mockResolvedValue(mockState);

    const result = await getTimerState();

    expect(result.isRunning).toBe(true);
    expect(result.mode).toBe("work");
    expect(result.remainingMs).toBe(12 * 60 * 1000);
  });

  it("getTimerState 应返回 break 模式的状态", async () => {
    const mockState = {
      isRunning: false,
      mode: "break",
      remainingMs: 5 * 60 * 1000,
    };
    invokeMock.mockResolvedValue(mockState);

    const result = await getTimerState();

    expect(result.mode).toBe("break");
    expect(result.remainingMs).toBe(5 * 60 * 1000);
  });

  it("getTimerState 不应传递第二个参数", async () => {
    invokeMock.mockResolvedValue({ isRunning: false, mode: "work", remainingMs: 0 });

    await getTimerState();

    const callArgs = invokeMock.mock.calls[0];
    expect(callArgs).toHaveLength(1);
    expect(callArgs[0]).toBe("get_timer_state");
  });

  it("getTimerState invoke 抛错时应向上传播错误", async () => {
    invokeMock.mockRejectedValue(new Error("timer backend error"));

    await expect(getTimerState()).rejects.toThrow("timer backend error");
  });

  it("getTimerState 应使用正确的 command 名 'get_timer_state'（snake_case）", async () => {
    invokeMock.mockResolvedValue({ isRunning: false, mode: "work", remainingMs: 0 });

    await getTimerState();

    const command = invokeMock.mock.calls[0][0];
    expect(command).toBe("get_timer_state");
    // 不应是 camelCase
    expect(command).not.toBe("getTimerState");
    expect(command).not.toBe("timer_get_state");
  });

  it("TimerState 接口字段应包含 isRunning/mode/remainingMs", async () => {
    const mockState = {
      isRunning: true,
      mode: "work",
      remainingMs: 1500000,
    };
    invokeMock.mockResolvedValue(mockState);

    const result = await getTimerState();

    expect(result).toHaveProperty("isRunning");
    expect(result).toHaveProperty("mode");
    expect(result).toHaveProperty("remainingMs");
    expect(typeof result.isRunning).toBe("boolean");
    expect(typeof result.mode).toBe("string");
    expect(typeof result.remainingMs).toBe("number");
  });
});
