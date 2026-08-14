/**
 * 认证命令（PWA 实现：REST + localStorage token 存储）
 *
 * 对应桌面端 Rust commands/cloud_auth.rs。REST 对接：
 * - POST /api/v1/auth/register | login | refresh | logout
 * - GET  /api/v1/auth/session
 * - GET  /api/v1/health（连接测试）
 *
 * 凭据说明：PWA 不保存明文密码（浏览器无法像桌面端那样 AES 加密落盘），
 * "自动登录"由 refresh token（30 天滚动）承担；saveCredentials 为 no-op。
 *
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

import { apiGet, apiPost, apiDelete } from "../../http";
import {
  getAccessToken,
  getRefreshToken,
  loadAuth,
  saveAuth,
  clearAuth,
  getApiMode,
  getApiKey,
} from "../../storage";

export interface Session {
  id: string;
  username: string;
  admin?: boolean;
}

interface RawUser {
  id?: string;
  username?: string;
  admin?: boolean;
  email?: string;
}

function toSession(user?: RawUser | null): Session | null {
  if (!user?.id || !user?.username) return null;
  return { id: user.id, username: user.username, admin: !!user.admin };
}

/** 测试云端连接 */
export async function cmdCloudTestConnection(): Promise<{
  ok: boolean;
  latency?: number;
  error?: string;
}> {
  const start = performance.now();
  try {
    await apiGet("/health");
    return { ok: true, latency: Math.round(performance.now() - start) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 登录 */
export async function cmdCloudLogin(args: Record<string, unknown>): Promise<{
  success: boolean;
  user?: Session;
  error?: string;
}> {
  try {
    const data = await apiPost<{ user?: RawUser; access_token?: string; refresh_token?: string }>(
      "/auth/login",
      { username: args.username, password: args.password },
    );
    if (!data.access_token) return { success: false, error: "服务器未返回令牌" };
    const user = toSession(data.user);
    saveAuth({
      accessToken: data.access_token,
      refreshToken: data.refresh_token || "",
      user: user ?? undefined,
      apiMode: "cloud",
    });
    return { success: true, user: user ?? undefined };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 注册 */
export async function cmdCloudRegister(args: Record<string, unknown>): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const data = await apiPost<{ access_token?: string; refresh_token?: string }>(
      "/auth/register",
      { username: args.username, password: args.password },
    );
    if (data.access_token) {
      saveAuth({ accessToken: data.access_token, refreshToken: data.refresh_token || "", apiMode: "cloud" });
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 登出 */
export async function cmdCloudLogout(): Promise<void> {
  const token = getAccessToken();
  try {
    if (token) await apiDelete("/auth/logout");
  } catch {
    /* 忽略 */
  }
  clearAuth();
}

/** 获取会话：本地 token 有效则返回用户（未验证时尝试拉取 session） */
export async function cmdCloudGetSession(): Promise<Session | null> {
  const auth = loadAuth();
  if (auth.user) return auth.user;
  if (!auth.accessToken) return null;
  try {
    const data = await apiGet<{ user?: RawUser }>("/auth/session");
    const user = toSession(data.user);
    if (user) saveAuth({ ...auth, user });
    return user;
  } catch {
    return null;
  }
}

/** API 模式（PWA 仅支持 cloud；local 模式保留读写以兼容桌面设置） */
export async function cmdGetApiMode(): Promise<string> {
  return getApiMode();
}
export async function cmdSetApiMode(args: Record<string, unknown>): Promise<boolean> {
  const auth = loadAuth();
  saveAuth({ ...auth, apiMode: String(args.mode ?? "cloud") });
  return true;
}

export async function cmdGetApiKey(): Promise<string | null> {
  const key = getApiKey();
  return key || null;
}
export async function cmdSaveApiKey(args: Record<string, unknown>): Promise<boolean> {
  const auth = loadAuth();
  saveAuth({ ...auth, apiKey: String(args.apiKey ?? "") });
  return true;
}

/** 凭据存储（PWA no-op：不保存密码，见文件头说明） */
export async function cmdSaveCredentials(): Promise<void> {
  /* no-op */
}
export async function cmdLoadCredentials(): Promise<unknown> {
  return null;
}
export async function cmdClearCredentials(): Promise<void> {
  /* no-op */
}
