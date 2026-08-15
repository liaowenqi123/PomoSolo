/**
 * PWA REST 客户端
 *
 * 对接自建服务器 REST API（server-planning/EXTERNAL-INTERFACES.md §2）：
 * - 认证：Authorization: Bearer <access_token>
 * - Access 15 分钟 / Refresh 30 天滚动：401 时自动刷新一次并重试原请求
 * - 生产环境同源（start.pomogrow.top 反代 /api），开发环境可 VITE_API_ORIGIN 指向现有 IP
 *
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

import { API_BASE } from "./config";
import {
  getAccessToken,
  getRefreshToken,
  saveAuth,
  loadAuth,
  clearAuth,
} from "./storage";

export interface ApiError extends Error {
  status?: number;
}

/** 统一的 JSON 请求入口（带 401 自动刷新重试） */
export async function apiRequest<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const { method = "GET", body, auth = true } = options;

  const doFetch = async (token: string): Promise<Response> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (auth && token) headers.Authorization = `Bearer ${token}`;
    return fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  };

  let resp = await doFetch(getAccessToken());

  // 401 + 有 refresh token → 刷新后重试一次
  if (resp.status === 401 && auth && getRefreshToken()) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      resp = await doFetch(getAccessToken());
    }
  }

  if (!resp.ok) {
    let message = `HTTP ${resp.status}`;
    try {
      const data = (await resp.json()) as { error?: string; detail?: string };
      message = data.error || data.detail || message;
    } catch {
      /* 忽略解析失败 */
    }
    const err: ApiError = new Error(message);
    err.status = resp.status;
    throw err;
  }

  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

/** 刷新 access token（滚动刷新 refresh token） */
async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const data = await apiRequest<{ access_token?: string; refresh_token?: string }>(
      "/auth/refresh",
      { method: "POST", body: { refresh_token: refreshToken }, auth: false },
    );
    if (!data.access_token) return false;
    const cur = loadAuth();
    saveAuth({
      ...cur,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || cur.refreshToken,
    });
    return true;
  } catch {
    clearAuth();
    return false;
  }
}

/**
 * 供 WS 重连等场景主动刷新 access token（失败不清登录态，返回是否成功）。
 * 与 tryRefresh 的区别：网络瞬时失败不应把用户登出。
 */
export async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const data = await apiRequest<{ access_token?: string; refresh_token?: string }>(
      "/auth/refresh",
      { method: "POST", body: { refresh_token: refreshToken }, auth: false },
    );
    if (!data.access_token) return false;
    const cur = loadAuth();
    saveAuth({
      ...cur,
      accessToken: data.access_token,
      refreshToken: data.refresh_token || cur.refreshToken,
    });
    return true;
  } catch {
    return false;
  }
}

// ===== 便捷方法 =====

export function apiGet<T = unknown>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: "GET" });
}
export function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, { method: "POST", body });
}
export function apiPut<T = unknown>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(path, { method: "PUT", body });
}
export function apiDelete<T = unknown>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: "DELETE" });
}
