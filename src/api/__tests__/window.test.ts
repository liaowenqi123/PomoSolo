import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock @tauri-apps/api/core 的 invoke 函数
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  minimizeWindow,
  closeWindow,
  setAlwaysOnTop,
  bringToFront,
  cancelAlwaysOnTop,
  enterMiniMode,
  exitMiniMode,
  updateMiniPosition,
  openExternal,
  showNotification,
} from "../window";

describe("api/window", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("minimizeWindow 应调用 invoke('minimize_window') 且无参数", async () => {
    invokeMock.mockResolvedValue(undefined);

    await minimizeWindow();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("minimize_window");
  });

  it("closeWindow 应调用 invoke('close_window') 且无参数", async () => {
    invokeMock.mockResolvedValue(undefined);

    await closeWindow();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("close_window");
  });

  it("setAlwaysOnTop 应调用 invoke('set_always_on_top', { onTop }) 并传递布尔值", async () => {
    invokeMock.mockResolvedValue(undefined);

    await setAlwaysOnTop(true);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("set_always_on_top", { onTop: true });

    await setAlwaysOnTop(false);
    expect(invokeMock).toHaveBeenLastCalledWith("set_always_on_top", {
      onTop: false,
    });
  });

  it("bringToFront 应调用 invoke('bring_to_front') 且无参数", async () => {
    invokeMock.mockResolvedValue(undefined);

    await bringToFront();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("bring_to_front");
  });

  it("cancelAlwaysOnTop 应调用 invoke('cancel_always_on_top') 且无参数", async () => {
    invokeMock.mockResolvedValue(undefined);

    await cancelAlwaysOnTop();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("cancel_always_on_top");
  });

  it("minimizeWindow 与 closeWindow 应使用不同的 command 名", async () => {
    invokeMock.mockResolvedValue(undefined);
    await minimizeWindow();
    await closeWindow();

    expect(invokeMock.mock.calls[0][0]).toBe("minimize_window");
    expect(invokeMock.mock.calls[1][0]).toBe("close_window");
  });

  it("各命令应使用不同的 command 名", async () => {
    invokeMock.mockResolvedValue(undefined);
    await minimizeWindow();
    await closeWindow();
    await setAlwaysOnTop(true);
    await bringToFront();
    await cancelAlwaysOnTop();

    const commands = invokeMock.mock.calls.map((c) => c[0]);
    expect(commands).toEqual([
      "minimize_window",
      "close_window",
      "set_always_on_top",
      "bring_to_front",
      "cancel_always_on_top",
    ]);
  });

  it("minimizeWindow invoke 抛错时应向上传播错误", async () => {
    invokeMock.mockRejectedValue(new Error("minimize backend error"));

    await expect(minimizeWindow()).rejects.toThrow("minimize backend error");
  });

  it("closeWindow invoke 抛错时应向上传播错误", async () => {
    invokeMock.mockRejectedValue(new Error("close backend error"));

    await expect(closeWindow()).rejects.toThrow("close backend error");
  });

  it("setAlwaysOnTop invoke 抛错时应向上传播错误", async () => {
    invokeMock.mockRejectedValue(new Error("on_top error"));

    await expect(setAlwaysOnTop(true)).rejects.toThrow("on_top error");
  });

  it("bringToFront invoke 抛错时应向上传播错误", async () => {
    invokeMock.mockRejectedValue(new Error("front error"));

    await expect(bringToFront()).rejects.toThrow("front error");
  });

  it("cancelAlwaysOnTop invoke 抛错时应向上传播错误", async () => {
    invokeMock.mockRejectedValue(new Error("cancel error"));

    await expect(cancelAlwaysOnTop()).rejects.toThrow("cancel error");
  });

  it("setAlwaysOnTop 参数名应为 onTop（camelCase，与 Tauri 约定一致）", async () => {
    invokeMock.mockResolvedValue(undefined);
    await setAlwaysOnTop(true);

    const callArgs = invokeMock.mock.calls[0];
    expect(callArgs[0]).toBe("set_always_on_top");
    expect(callArgs[1]).toEqual({ onTop: true });
    // 不应使用 snake_case
    const argObj = callArgs[1] as Record<string, unknown>;
    expect(argObj["on_top"]).toBeUndefined();
    expect(argObj["onTop"]).toBe(true);
  });

  it("无参数命令不应传递第二个参数", async () => {
    invokeMock.mockResolvedValue(undefined);
    await minimizeWindow();

    const callArgs = invokeMock.mock.calls[0];
    expect(callArgs).toHaveLength(1);
    expect(callArgs[0]).toBe("minimize_window");
  });

  // ===== 新增窗口功能测试 =====

  it("enterMiniMode 应调用 invoke('enter_mini_mode') 且无参数", async () => {
    invokeMock.mockResolvedValue(undefined);
    await enterMiniMode();
    expect(invokeMock).toHaveBeenCalledWith("enter_mini_mode");
  });

  it("exitMiniMode 应调用 invoke('exit_mini_mode') 且无参数", async () => {
    invokeMock.mockResolvedValue(undefined);
    await exitMiniMode();
    expect(invokeMock).toHaveBeenCalledWith("exit_mini_mode");
  });

  it("updateMiniPosition 应调用 invoke('update_mini_position') 且无参数", async () => {
    invokeMock.mockResolvedValue(undefined);
    await updateMiniPosition();
    expect(invokeMock).toHaveBeenCalledWith("update_mini_position");
  });

  it("openExternal 应调用 invoke('open_external', { url })", async () => {
    invokeMock.mockResolvedValue(undefined);
    await openExternal("https://example.com");
    expect(invokeMock).toHaveBeenCalledWith("open_external", {
      url: "https://example.com",
    });
  });

  it("openExternal invoke 抛错时应向上传播", async () => {
    invokeMock.mockRejectedValue(new Error("open error"));
    await expect(openExternal("https://x.com")).rejects.toThrow("open error");
  });

  it("showNotification 不应调用 invoke（纯前端 Web API）", () => {
    showNotification("标题", "内容");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("showNotification 无参数时不抛错（使用默认值）", () => {
    expect(() => showNotification()).not.toThrow();
    expect(() => showNotification("标题")).not.toThrow();
  });
});
