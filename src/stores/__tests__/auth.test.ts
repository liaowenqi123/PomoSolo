import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

// Mock @/api/auth 模块，避免依赖 Tauri 运行时
const authApiMock = {
  cloudLogin: vi.fn(),
  cloudRegister: vi.fn(),
  cloudLogout: vi.fn(),
  cloudGetSession: vi.fn(),
  cloudTestConnection: vi.fn(),
  saveCredentials: vi.fn(),
  loadCredentials: vi.fn(),
  clearCredentials: vi.fn(),
  getApiKey: vi.fn(),
  saveApiKey: vi.fn(),
  getApiMode: vi.fn(),
  setApiMode: vi.fn(),
};

vi.mock("@/api/auth", () => ({
  cloudLogin: (...args: unknown[]) => authApiMock.cloudLogin(...args),
  cloudRegister: (...args: unknown[]) => authApiMock.cloudRegister(...args),
  cloudLogout: (...args: unknown[]) => authApiMock.cloudLogout(...args),
  cloudGetSession: (...args: unknown[]) => authApiMock.cloudGetSession(...args),
  cloudTestConnection: (...args: unknown[]) =>
    authApiMock.cloudTestConnection(...args),
  saveCredentials: (...args: unknown[]) => authApiMock.saveCredentials(...args),
  loadCredentials: (...args: unknown[]) => authApiMock.loadCredentials(...args),
  clearCredentials: (...args: unknown[]) =>
    authApiMock.clearCredentials(...args),
  getApiKey: (...args: unknown[]) => authApiMock.getApiKey(...args),
  saveApiKey: (...args: unknown[]) => authApiMock.saveApiKey(...args),
  getApiMode: (...args: unknown[]) => authApiMock.getApiMode(...args),
  setApiMode: (...args: unknown[]) => authApiMock.setApiMode(...args),
}));

import { useAuthStore } from "../auth";

describe("useAuthStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    // 重置所有 mock
    Object.values(authApiMock).forEach((m) => m.mockReset());
    // 默认 mock 返回值
    authApiMock.cloudTestConnection.mockResolvedValue({ ok: true });
    authApiMock.cloudLogout.mockResolvedValue(undefined);
    authApiMock.clearCredentials.mockResolvedValue(undefined);
    authApiMock.saveCredentials.mockResolvedValue(undefined);
    authApiMock.saveApiKey.mockResolvedValue(true);
    authApiMock.setApiMode.mockResolvedValue(true);
    authApiMock.getApiMode.mockResolvedValue("cloud");
    authApiMock.cloudGetSession.mockResolvedValue(null);
    authApiMock.loadCredentials.mockResolvedValue(null);
    authApiMock.getApiKey.mockResolvedValue(null);
  });

  // ===== 初始状态 =====

  it("初始状态应为默认值", () => {
    const store = useAuthStore();
    expect(store.mode).toBe("cloud");
    expect(store.session).toBeNull();
    expect(store.localApiKey).toBeNull();
    expect(store.loading).toBe(false);
    expect(store.connectionOk).toBeNull();
    expect(store.lastError).toBeNull();
  });

  // ===== Getters =====

  it("isLoggedIn：session !== null 时为 true", () => {
    const store = useAuthStore();
    expect(store.isLoggedIn).toBe(false);
    store.session = { id: 1, username: "alice", admin: false };
    expect(store.isLoggedIn).toBe(true);
  });

  it("isLocalMode / isCloudMode 应随 mode 变化", () => {
    const store = useAuthStore();
    expect(store.isCloudMode).toBe(true);
    expect(store.isLocalMode).toBe(false);

    store.mode = "local";
    expect(store.isCloudMode).toBe(false);
    expect(store.isLocalMode).toBe(true);
  });

  it("hasApiKey：本地模式取决于 localApiKey", () => {
    const store = useAuthStore();
    store.mode = "local";
    expect(store.hasApiKey).toBe(false);

    store.localApiKey = "sk-test";
    expect(store.hasApiKey).toBe(true);
  });

  it("hasApiKey：云端模式取决于 isLoggedIn", () => {
    const store = useAuthStore();
    store.mode = "cloud";
    expect(store.hasApiKey).toBe(false);

    store.session = { id: 1, username: "alice", admin: false };
    expect(store.hasApiKey).toBe(true);
  });

  // ===== init =====

  it("init 应调用 loadMode + testConnection，cloud 模式下调用 restoreSession", async () => {
    authApiMock.getApiMode.mockResolvedValue("cloud");
    authApiMock.cloudGetSession.mockResolvedValue(null);
    authApiMock.loadCredentials.mockResolvedValue(null);

    const store = useAuthStore();
    await store.init();

    expect(authApiMock.getApiMode).toHaveBeenCalled();
    expect(authApiMock.cloudTestConnection).toHaveBeenCalled();
    // cloud 模式下应调用 cloudGetSession（restoreSession）
    expect(authApiMock.cloudGetSession).toHaveBeenCalled();
    // 不应调用 getApiKey（那是 local 模式行为）
    expect(authApiMock.getApiKey).not.toHaveBeenCalled();
  });

  it("init 在 local 模式下应调用 tryLoadLocalApiKey", async () => {
    authApiMock.getApiMode.mockResolvedValue("local");
    authApiMock.getApiKey.mockResolvedValue("sk-restored");

    const store = useAuthStore();
    await store.init();

    expect(store.mode).toBe("local");
    expect(authApiMock.getApiKey).toHaveBeenCalled();
    expect(store.localApiKey).toBe("sk-restored");
  });

  it("init 过程中 loading 应最终为 false", async () => {
    const store = useAuthStore();
    await store.init();
    expect(store.loading).toBe(false);
  });

  // ===== loadMode =====

  it("loadMode 应从后端加载并设置 mode", async () => {
    authApiMock.getApiMode.mockResolvedValue("local");

    const store = useAuthStore();
    await store.loadMode();

    expect(store.mode).toBe("local");
  });

  it("loadMode 后端返回 null 时应默认为 cloud", async () => {
    authApiMock.getApiMode.mockResolvedValue(null);

    const store = useAuthStore();
    await store.loadMode();

    expect(store.mode).toBe("cloud");
  });

  it("loadMode 失败时应静默处理（不抛错）", async () => {
    authApiMock.getApiMode.mockRejectedValue(new Error("cmd not registered"));

    const store = useAuthStore();
    await expect(store.loadMode()).resolves.not.toThrow();
    // mode 保持默认
    expect(store.mode).toBe("cloud");
  });

  // ===== testConnection =====

  it("testConnection 成功时应设置 connectionOk=true", async () => {
    authApiMock.cloudTestConnection.mockResolvedValue({ ok: true });

    const store = useAuthStore();
    await store.testConnection();

    expect(store.connectionOk).toBe(true);
  });

  it("testConnection 失败时应设置 connectionOk=false", async () => {
    authApiMock.cloudTestConnection.mockResolvedValue({ ok: false });

    const store = useAuthStore();
    await store.testConnection();

    expect(store.connectionOk).toBe(false);
  });

  it("testConnection 抛错时应设置 connectionOk=false 且不传播", async () => {
    authApiMock.cloudTestConnection.mockRejectedValue(new Error("network"));

    const store = useAuthStore();
    await expect(store.testConnection()).resolves.not.toThrow();
    expect(store.connectionOk).toBe(false);
  });

  // ===== tryLoadLocalApiKey =====

  it("tryLoadLocalApiKey 有 key 时应设置 localApiKey 并返回 true", async () => {
    authApiMock.getApiKey.mockResolvedValue("sk-loaded");

    const store = useAuthStore();
    const ok = await store.tryLoadLocalApiKey();

    expect(ok).toBe(true);
    expect(store.localApiKey).toBe("sk-loaded");
  });

  it("tryLoadLocalApiKey 无 key 时应返回 false", async () => {
    authApiMock.getApiKey.mockResolvedValue(null);

    const store = useAuthStore();
    const ok = await store.tryLoadLocalApiKey();

    expect(ok).toBe(false);
    expect(store.localApiKey).toBeNull();
  });

  // ===== switchMode =====

  it("switchMode 到 local 应清除云端凭据 + cloudLogout", async () => {
    const store = useAuthStore();
    // 先模拟有云端会话
    store.session = { id: 1, username: "alice", admin: false };

    await store.switchMode("local");

    expect(store.mode).toBe("local");
    expect(store.session).toBeNull();
    expect(store.localApiKey).toBeNull();
    expect(authApiMock.setApiMode).toHaveBeenCalledWith("local");
    expect(authApiMock.clearCredentials).toHaveBeenCalled();
    expect(authApiMock.cloudLogout).toHaveBeenCalled();
  });

  it("switchMode 到 cloud 应清除本地 API Key（saveApiKey 空串）", async () => {
    const store = useAuthStore();
    store.mode = "local";
    store.localApiKey = "sk-old";

    await store.switchMode("cloud");

    expect(store.mode).toBe("cloud");
    expect(store.session).toBeNull();
    expect(store.localApiKey).toBeNull();
    expect(authApiMock.setApiMode).toHaveBeenCalledWith("cloud");
    expect(authApiMock.saveApiKey).toHaveBeenCalledWith("");
  });

  it("switchMode 相同模式时应直接返回（不调用 setApiMode）", async () => {
    const store = useAuthStore();
    store.mode = "cloud";

    await store.switchMode("cloud");

    expect(authApiMock.setApiMode).not.toHaveBeenCalled();
  });

  // ===== login =====

  it("login 成功时应设置 session 并返回 true", async () => {
    const fakeUser = { id: 1, username: "alice", admin: false };
    authApiMock.cloudLogin.mockResolvedValue({
      success: true,
      user: fakeUser,
    });

    const store = useAuthStore();
    const ok = await store.login("alice", "secret", false, false);

    expect(ok).toBe(true);
    expect(store.session).toEqual(fakeUser);
    expect(authApiMock.cloudLogin).toHaveBeenCalledWith("alice", "secret");
  });

  it("login 成功 + rememberPassword 时应调用 saveCredentials", async () => {
    authApiMock.cloudLogin.mockResolvedValue({
      success: true,
      user: { id: 1, username: "alice", admin: false },
    });

    const store = useAuthStore();
    await store.login("alice", "secret", true, true);

    expect(authApiMock.saveCredentials).toHaveBeenCalledWith(
      "alice",
      "secret",
      true,
    );
  });

  it("login 成功 + 不记住密码时不应调用 saveCredentials", async () => {
    authApiMock.cloudLogin.mockResolvedValue({
      success: true,
      user: { id: 1, username: "alice", admin: false },
    });

    const store = useAuthStore();
    await store.login("alice", "secret", false, false);

    expect(authApiMock.saveCredentials).not.toHaveBeenCalled();
  });

  it("login 失败（success=false）时应设置 lastError 并返回 false", async () => {
    authApiMock.cloudLogin.mockResolvedValue({
      success: false,
      error: "密码错误",
    });

    const store = useAuthStore();
    const ok = await store.login("alice", "wrong", false, false);

    expect(ok).toBe(false);
    expect(store.session).toBeNull();
    expect(store.lastError).toBe("密码错误");
  });

  it("login 抛错时应设置 lastError 并返回 false", async () => {
    authApiMock.cloudLogin.mockRejectedValue(new Error("network error"));

    const store = useAuthStore();
    const ok = await store.login("alice", "secret", false, false);

    expect(ok).toBe(false);
    expect(store.lastError).toBe("network error");
  });

  it("login 过程中 loading 应最终为 false", async () => {
    authApiMock.cloudLogin.mockResolvedValue({
      success: true,
      user: { id: 1, username: "alice", admin: false },
    });

    const store = useAuthStore();
    await store.login("alice", "secret", false, false);
    expect(store.loading).toBe(false);
  });

  // ===== register =====

  it("register 成功时应返回 true", async () => {
    authApiMock.cloudRegister.mockResolvedValue({ success: true });

    const store = useAuthStore();
    const ok = await store.register("bob", "password123");

    expect(ok).toBe(true);
    expect(authApiMock.cloudRegister).toHaveBeenCalledWith("bob", "password123");
  });

  it("register 失败时应设置 lastError 并返回 false", async () => {
    authApiMock.cloudRegister.mockResolvedValue({
      success: false,
      error: "用户名已存在",
    });

    const store = useAuthStore();
    const ok = await store.register("bob", "password123");

    expect(ok).toBe(false);
    expect(store.lastError).toBe("用户名已存在");
  });

  it("register 抛错时应设置 lastError 并返回 false", async () => {
    authApiMock.cloudRegister.mockRejectedValue(new Error("server error"));

    const store = useAuthStore();
    const ok = await store.register("bob", "password123");

    expect(ok).toBe(false);
    expect(store.lastError).toBe("server error");
  });

  // ===== logout =====

  it("logout 应调用 cloudLogout + clearCredentials 并清除 session", async () => {
    const store = useAuthStore();
    store.session = { id: 1, username: "alice", admin: false };

    await store.logout();

    expect(authApiMock.cloudLogout).toHaveBeenCalled();
    expect(authApiMock.clearCredentials).toHaveBeenCalled();
    expect(store.session).toBeNull();
  });

  it("logout 即使后端报错也应清除 session", async () => {
    authApiMock.cloudLogout.mockRejectedValue(new Error("network"));
    authApiMock.clearCredentials.mockRejectedValue(new Error("fs error"));

    const store = useAuthStore();
    store.session = { id: 1, username: "alice", admin: false };

    await expect(store.logout()).resolves.not.toThrow();
    expect(store.session).toBeNull();
  });

  // ===== saveLocalApiKey =====

  it("saveLocalApiKey 有效 key（sk- 开头）应保存并设置 localApiKey", async () => {
    authApiMock.saveApiKey.mockResolvedValue(true);

    const store = useAuthStore();
    const ok = await store.saveLocalApiKey("sk-valid-key");

    expect(ok).toBe(true);
    expect(store.localApiKey).toBe("sk-valid-key");
    expect(authApiMock.saveApiKey).toHaveBeenCalledWith("sk-valid-key");
  });

  it("saveLocalApiKey 空串时应设置 lastError 并返回 false", async () => {
    const store = useAuthStore();
    const ok = await store.saveLocalApiKey("");

    expect(ok).toBe(false);
    expect(store.lastError).toBe("请输入 API Key");
    expect(authApiMock.saveApiKey).not.toHaveBeenCalled();
  });

  it("saveLocalApiKey 非 sk- 开头时应设置 lastError 并返回 false", async () => {
    const store = useAuthStore();
    const ok = await store.saveLocalApiKey("invalid-key");

    expect(ok).toBe(false);
    expect(store.lastError).toContain("sk-");
    expect(authApiMock.saveApiKey).not.toHaveBeenCalled();
  });

  it("saveLocalApiKey 后端返回 false 时应设置 lastError 并返回 false", async () => {
    authApiMock.saveApiKey.mockResolvedValue(false);

    const store = useAuthStore();
    const ok = await store.saveLocalApiKey("sk-valid");

    expect(ok).toBe(false);
    expect(store.lastError).toBe("保存失败");
  });

  it("saveLocalApiKey 抛错时应设置 lastError 并返回 false", async () => {
    authApiMock.saveApiKey.mockRejectedValue(new Error("disk full"));

    const store = useAuthStore();
    const ok = await store.saveLocalApiKey("sk-valid");

    expect(ok).toBe(false);
    expect(store.lastError).toBe("disk full");
  });

  // ===== clearError =====

  it("clearError 应将 lastError 置为 null", () => {
    const store = useAuthStore();
    store.lastError = "some error";

    store.clearError();

    expect(store.lastError).toBeNull();
  });
});
