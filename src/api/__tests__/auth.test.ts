import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock @tauri-apps/api/core 的 invoke 函数
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  saveCredentials,
  loadCredentials,
  clearCredentials,
  cloudTestConnection,
  cloudGetSession,
  cloudLogin,
  cloudRegister,
  cloudLogout,
  getApiKey,
  saveApiKey,
  getApiMode,
  setApiMode,
} from "../auth";

describe("api/auth", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  // ===== 凭据存储 =====

  it("saveCredentials 应调用 invoke('save_credentials', { username, password, autoLogin })", async () => {
    invokeMock.mockResolvedValue(undefined);

    await saveCredentials("alice", "secret123", true);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("save_credentials", {
      username: "alice",
      password: "secret123",
      autoLogin: true,
    });
  });

  it("loadCredentials 应调用 invoke('load_credentials') 无参数", async () => {
    const fakeCred = { username: "alice", autoLogin: true };
    invokeMock.mockResolvedValue(fakeCred);

    const result = await loadCredentials();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("load_credentials");
    expect(result).toEqual(fakeCred);
  });

  it("loadCredentials 后端返回 null 时应透传 null", async () => {
    invokeMock.mockResolvedValue(null);

    const result = await loadCredentials();
    expect(result).toBeNull();
  });

  it("clearCredentials 应调用 invoke('clear_credentials') 无参数", async () => {
    invokeMock.mockResolvedValue(undefined);

    await clearCredentials();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("clear_credentials");
  });

  // ===== 云端账号 =====

  it("cloudTestConnection 应调用 invoke('cloud_test_connection') 无参数", async () => {
    const fakeResult = { ok: true, latency: 50 };
    invokeMock.mockResolvedValue(fakeResult);

    const result = await cloudTestConnection();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("cloud_test_connection");
    expect(result).toEqual(fakeResult);
  });

  it("cloudGetSession 应调用 invoke('cloud_get_session') 无参数", async () => {
    const fakeSession = { id: 1, username: "alice", admin: false };
    invokeMock.mockResolvedValue(fakeSession);

    const result = await cloudGetSession();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("cloud_get_session");
    expect(result).toEqual(fakeSession);
  });

  it("cloudGetSession 未登录时应返回 null", async () => {
    invokeMock.mockResolvedValue(null);

    const result = await cloudGetSession();
    expect(result).toBeNull();
  });

  it("cloudLogin 应调用 invoke('cloud_login', { username, password })", async () => {
    const fakeResult = {
      success: true,
      user: { id: 1, username: "alice", admin: false },
    };
    invokeMock.mockResolvedValue(fakeResult);

    const result = await cloudLogin("alice", "secret123");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("cloud_login", {
      username: "alice",
      password: "secret123",
    });
    expect(result).toEqual(fakeResult);
  });

  it("cloudRegister 应调用 invoke('cloud_register', { username, password })", async () => {
    const fakeResult = { success: true };
    invokeMock.mockResolvedValue(fakeResult);

    const result = await cloudRegister("bob", "password456");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("cloud_register", {
      username: "bob",
      password: "password456",
    });
    expect(result).toEqual(fakeResult);
  });

  it("cloudLogout 应调用 invoke('cloud_logout') 无参数", async () => {
    invokeMock.mockResolvedValue(undefined);

    await cloudLogout();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("cloud_logout");
  });

  // ===== API Key 管理 =====

  it("getApiKey 应调用 invoke('get_api_key') 无参数", async () => {
    invokeMock.mockResolvedValue("sk-test123");

    const result = await getApiKey();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("get_api_key");
    expect(result).toBe("sk-test123");
  });

  it("getApiKey 未保存时应返回 null", async () => {
    invokeMock.mockResolvedValue(null);

    const result = await getApiKey();
    expect(result).toBeNull();
  });

  it("saveApiKey 应调用 invoke('save_api_key', { apiKey: key })", async () => {
    invokeMock.mockResolvedValue(true);

    const result = await saveApiKey("sk-mykey");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    // 注意：参数名为 apiKey（camelCase），与 Rust 端约定一致
    expect(invokeMock).toHaveBeenCalledWith("save_api_key", {
      apiKey: "sk-mykey",
    });
    expect(result).toBe(true);
  });

  it("saveApiKey 传空串时应将空串透传给后端", async () => {
    invokeMock.mockResolvedValue(true);

    await saveApiKey("");

    expect(invokeMock).toHaveBeenCalledWith("save_api_key", { apiKey: "" });
  });

  // ===== API 模式 =====

  it("getApiMode 应调用 invoke('get_api_mode') 无参数", async () => {
    invokeMock.mockResolvedValue("local");

    const result = await getApiMode();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("get_api_mode");
    expect(result).toBe("local");
  });

  it("setApiMode 应调用 invoke('set_api_mode', { mode })", async () => {
    invokeMock.mockResolvedValue(true);

    const result = await setApiMode("cloud");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("set_api_mode", { mode: "cloud" });
    expect(result).toBe(true);
  });

  // ===== 错误传播 =====

  it("invoke 抛错时应向上传播错误", async () => {
    invokeMock.mockRejectedValue(new Error("backend error"));

    await expect(cloudLogin("a", "b")).rejects.toThrow("backend error");
    await expect(cloudRegister("a", "b")).rejects.toThrow("backend error");
    await expect(cloudLogout()).rejects.toThrow("backend error");
    await expect(cloudGetSession()).rejects.toThrow("backend error");
    await expect(cloudTestConnection()).rejects.toThrow("backend error");
    await expect(saveCredentials("a", "b", true)).rejects.toThrow(
      "backend error",
    );
    await expect(loadCredentials()).rejects.toThrow("backend error");
    await expect(clearCredentials()).rejects.toThrow("backend error");
    await expect(getApiKey()).rejects.toThrow("backend error");
    await expect(saveApiKey("sk-x")).rejects.toThrow("backend error");
    await expect(getApiMode()).rejects.toThrow("backend error");
    await expect(setApiMode("cloud")).rejects.toThrow("backend error");
  });

  // ===== 各命令名应互不相同 =====

  it("所有命令名应互不相同（防止笔误）", async () => {
    invokeMock.mockResolvedValue(undefined);

    await saveCredentials("a", "b", false);
    await loadCredentials();
    await clearCredentials();
    await cloudTestConnection();
    await cloudGetSession();
    await cloudLogin("a", "b");
    await cloudRegister("a", "b");
    await cloudLogout();
    await getApiKey();
    await saveApiKey("sk-x");
    await getApiMode();
    await setApiMode("cloud");

    const cmdNames = invokeMock.mock.calls.map((c) => c[0]);
    const unique = new Set(cmdNames);
    expect(unique.size).toBe(cmdNames.length);
  });
});
