/**
 * 认证 Store
 *
 * 管理当前会话、登录状态、API Key 模式。
 * 参考 electron/src/scripts/modules/apiKeyManager.js。
 *
 * 两种互斥模式：
 * - cloud（云端登录）：通过 Supabase 登录获取 API Key（仅内存）
 * - local（本地配置）：手动输入 API Key 并持久化
 *
 * 切换模式时会清理对方的凭据。
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";
import {
  type ApiMode,
  type Session,
  type Credentials,
  cloudLogin,
  cloudRegister,
  cloudLogout,
  cloudGetSession,
  cloudTestConnection,
  saveCredentials,
  loadCredentials,
  clearCredentials,
  getApiKey,
  saveApiKey,
  getApiMode,
  setApiMode,
} from "@/api/auth";
import { setApiKey as chartsSetApiKey } from "@/api/charts";

export const useAuthStore = defineStore("auth", () => {
  // ===== State =====

  /** 当前 API 模式 */
  const mode = ref<ApiMode>("cloud");
  /** 当前会话（云端模式登录后存在） */
  const session = ref<Session | null>(null);
  /** 本地模式保存的 API Key（云端模式不存储实际密钥） */
  const localApiKey = ref<string | null>(null);
  /** 是否正在加载 */
  const loading = ref(false);
  /** 云端连接状态 */
  const connectionOk = ref<boolean | null>(null);
  /** 最近一次错误信息 */
  const lastError = ref<string | null>(null);

  // ===== Getters =====

  /** 是否已登录（云端模式） */
  const isLoggedIn = computed(() => session.value !== null);

  /** 是否为本地模式 */
  const isLocalMode = computed(() => mode.value === "local");

  /** 是否为云端模式 */
  const isCloudMode = computed(() => mode.value === "cloud");

  /** 当前是否持有可用的 API Key（云端：有会话即认为有；本地：检查 localApiKey） */
  const hasApiKey = computed(() => {
    if (mode.value === "local") {
      return !!localApiKey.value;
    }
    return isLoggedIn.value;
  });

  // ===== Actions =====

  /**
   * 初始化：加载模式、测试连接、按模式自动恢复会话或本地 Key。
   */
  async function init(): Promise<void> {
    loading.value = true;
    try {
      await loadMode();
      // 并行：测试连接 + 按模式恢复
      void testConnection();
      if (mode.value === "local") {
        await tryLoadLocalApiKey();
      } else {
        await restoreSession();
      }
    } finally {
      loading.value = false;
    }
  }

  /** 加载保存的模式 */
  async function loadMode(): Promise<void> {
    try {
      const m = await getApiMode();
      mode.value = m ?? "cloud";
    } catch (err) {
      // 后端未注册时静默处理
      console.warn("[auth] loadMode failed:", err);
    }
  }

  /** 测试云端连接 */
  async function testConnection(): Promise<void> {
    try {
      const result = await cloudTestConnection();
      connectionOk.value = result.ok;
    } catch (err) {
      connectionOk.value = false;
      console.warn("[auth] testConnection failed:", err);
    }
  }

  /** 尝试加载本地保存的 API Key */
  async function tryLoadLocalApiKey(): Promise<boolean> {
    try {
      const key = await getApiKey();
      if (key) {
        localApiKey.value = key;
        return true;
      }
    } catch (err) {
      console.warn("[auth] tryLoadLocalApiKey failed:", err);
    }
    return false;
  }

  /**
   * 通过本地保存的凭据尝试自动登录。
   *
   * 注意：当前 Credentials 接口只暴露加密后的密码（passwordEncrypted），
   * 前端无法直接拿明文密码调用 cloudLogin。
   * 自动登录的具体实现应由后端在 cloud_get_session 中处理：
   * 若 autoLogin=true 且凭据有效，后端直接返回当前会话。
   * 这里仅检查凭据是否存在并启用了自动登录。
   */
  async function tryAutoLogin(): Promise<boolean> {
    try {
      const cred = await loadCredentials();
      if (!cred || !cred.username || !cred.autoLogin) return false;
      const s = await cloudGetSession();
      if (s) {
        session.value = s;
        return true;
      }
      // 自动登录失败，清除无效凭据
      await clearCredentials();
      return false;
    } catch (err) {
      console.warn("[auth] tryAutoLogin failed:", err);
      return false;
    }
  }

  /** 恢复云端会话（先查 session，再尝试自动登录） */
  async function restoreSession(): Promise<void> {
    try {
      const s = await cloudGetSession();
      if (s) {
        session.value = s;
        return;
      }
      await tryAutoLogin();
    } catch (err) {
      console.warn("[auth] restoreSession failed:", err);
    }
  }

  /**
   * 切换 API 模式（互斥清理）。
   * - 切到 local：清除云端凭据、退出登录
   * 切到 cloud：清除本地 API Key
   */
  async function switchMode(newMode: ApiMode): Promise<void> {
    if (newMode === mode.value) return;
    mode.value = newMode;
    session.value = null;
    localApiKey.value = null;

    try {
      await setApiMode(newMode);
      if (newMode === "local") {
        await clearCredentials().catch((e) =>
          console.warn("[auth] clearCredentials failed:", e),
        );
        await cloudLogout().catch((e) =>
          console.warn("[auth] cloudLogout failed:", e),
        );
      } else {
        // 切到云端：清空本地保存的 Key（传空串触发后端清理）
        await saveApiKey("").catch((e) =>
          console.warn("[auth] clearApiKey failed:", e),
        );
      }
    } catch (err) {
      console.error("[auth] switchMode failed:", err);
      lastError.value = err instanceof Error ? err.message : String(err);
    }
  }

  /**
   * 云端登录。
   * @param username 用户名
   * @param password 密码
   * @param rememberPassword 是否记住密码（保存凭据）
   * @param autoLogin 是否启用自动登录
   */
  async function login(
    username: string,
    password: string,
    rememberPassword = false,
    autoLogin = false,
  ): Promise<boolean> {
    loading.value = true;
    lastError.value = null;
    try {
      const result = await cloudLogin(username, password);
      if (result.success && result.user) {
        session.value = result.user;
        if (rememberPassword) {
          await saveCredentials(username, password, autoLogin).catch((e) =>
            console.warn("[auth] saveCredentials failed:", e),
          );
        }
        // 登录成功后重新测试连接，避免冷启动期误判为"连接失败"
        void testConnection();
        return true;
      }
      lastError.value = result.error ?? "登录失败";
      return false;
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /** 注册新账号 */
  async function register(
    username: string,
    password: string,
  ): Promise<boolean> {
    loading.value = true;
    lastError.value = null;
    try {
      const result = await cloudRegister(username, password);
      if (result.success) {
        return true;
      }
      lastError.value = result.error ?? "注册失败";
      return false;
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
      return false;
    } finally {
      loading.value = false;
    }
  }

  /** 退出登录（云端） */
  async function logout(): Promise<void> {
    try {
      await cloudLogout();
      await clearCredentials();
    } catch (err) {
      console.warn("[auth] logout failed:", err);
    } finally {
      session.value = null;
    }
  }

  /** 保存本地 API Key */
  async function saveLocalApiKey(key: string): Promise<boolean> {
    lastError.value = null;
    if (!key) {
      lastError.value = "请输入 API Key";
      return false;
    }
    if (!key.startsWith("sk-")) {
      lastError.value = "API Key 格式不正确，应以 sk- 开头";
      return false;
    }
    try {
      const ok = await saveApiKey(key);
      if (ok) {
        // 同步到 ChartsState 内存（修复 4.6 Bug：确保 download_song 能拿到 Key）
        await chartsSetApiKey(key).catch((e) =>
          console.warn("[auth] chartsSetApiKey failed:", e),
        );
        localApiKey.value = key;
        return true;
      }
      lastError.value = "保存失败";
      return false;
    } catch (err) {
      lastError.value = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  /** 清除错误 */
  function clearError(): void {
    lastError.value = null;
  }

  return {
    // state
    mode,
    session,
    localApiKey,
    loading,
    connectionOk,
    lastError,
    // getters
    isLoggedIn,
    isLocalMode,
    isCloudMode,
    hasApiKey,
    // actions
    init,
    loadMode,
    testConnection,
    tryLoadLocalApiKey,
    tryAutoLogin,
    restoreSession,
    switchMode,
    login,
    register,
    logout,
    saveLocalApiKey,
    clearError,
  };
});

// 重新导出类型，方便调用方按需使用
export type { ApiMode, Session, Credentials };
