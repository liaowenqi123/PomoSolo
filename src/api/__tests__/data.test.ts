import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock @tauri-apps/api/core 的 invoke 函数
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { readData, writeData, readSettings, writeSettings } from "../data";

describe("api/data", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("readData 应调用 invoke('read_data') 且无参数", async () => {
    invokeMock.mockResolvedValue({ foo: "bar" });

    const result = await readData();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("read_data");
    expect(result).toEqual({ foo: "bar" });
  });

  it("readData 默认返回空对象（当后端返回 null/undefined 时由 invoke 透传）", async () => {
    // 后端在文件不存在时返回 serde_json::json!({})，所以前端总能拿到对象
    invokeMock.mockResolvedValue({});

    const result = await readData();
    expect(result).toEqual({});
    expect(invokeMock).toHaveBeenCalledWith("read_data");
  });

  it("writeData 应调用 invoke('write_data', { data }) 并传递数据", async () => {
    invokeMock.mockResolvedValue(undefined);
    const payload = { count: 1, items: ["a", "b"] };

    await writeData(payload);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("write_data", { data: payload });
  });

  it("readSettings 应调用 invoke('read_settings') 且无参数", async () => {
    invokeMock.mockResolvedValue({ theme: "dark" });

    const result = await readSettings();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("read_settings");
    expect(result).toEqual({ theme: "dark" });
  });

  it("writeSettings 应调用 invoke('write_settings', { settings }) 并传递数据", async () => {
    invokeMock.mockResolvedValue(undefined);
    const payload = { theme: "light", autoStart: true };

    await writeSettings(payload);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("write_settings", {
      settings: payload,
    });
  });

  it("readData 与 readSettings 应使用不同的 command 名", async () => {
    invokeMock.mockResolvedValue({});
    await readData();
    await readSettings();

    expect(invokeMock.mock.calls[0][0]).toBe("read_data");
    expect(invokeMock.mock.calls[1][0]).toBe("read_settings");
  });

  it("writeData 与 writeSettings 应使用不同的 command 名", async () => {
    invokeMock.mockResolvedValue(undefined);
    await writeData({ a: 1 });
    await writeSettings({ b: 2 });

    expect(invokeMock.mock.calls[0][0]).toBe("write_data");
    expect(invokeMock.mock.calls[1][0]).toBe("write_settings");
  });

  it("invoke 抛错时应向上传播错误", async () => {
    invokeMock.mockRejectedValue(new Error("backend error"));

    await expect(readData()).rejects.toThrow("backend error");
    await expect(writeData({})).rejects.toThrow("backend error");
    await expect(readSettings()).rejects.toThrow("backend error");
    await expect(writeSettings({})).rejects.toThrow("backend error");
  });

  it("writeData 参数名应为 data（snake_case 与 Rust 端约定）", async () => {
    invokeMock.mockResolvedValue(undefined);
    await writeData({ hello: "world" });

    const callArgs = invokeMock.mock.calls[0];
    expect(callArgs[0]).toBe("write_data");
    expect(callArgs[1]).toEqual({ data: { hello: "world" } });
    // 不应使用 camelCase 的其他名字
    expect((callArgs[1] as Record<string, unknown>)["Data"]).toBeUndefined();
  });

  it("writeSettings 参数名应为 settings", async () => {
    invokeMock.mockResolvedValue(undefined);
    await writeSettings({ autoStart: true });

    const callArgs = invokeMock.mock.calls[0];
    expect(callArgs[0]).toBe("write_settings");
    expect(callArgs[1]).toEqual({ settings: { autoStart: true } });
  });
});
