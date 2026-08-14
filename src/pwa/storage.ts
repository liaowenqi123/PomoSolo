/**
 * PWA 本地存储层
 *
 * 桌面端的数据/设置/凭据由 Rust 落盘（data.json / settings.json / 加密凭据）。
 * PWA 用 localStorage 承担同等职责；云端设置/番茄记录同步走 REST（见 http.ts）。
 *
 * 存储键（均带 LS_PREFIX 命名空间）：
 *   pomo-pwa:data        —— data.json 等价物（统计等）
 *   pomo-pwa:settings    —— settings.json 等价物
 *   pomo-pwa:auth        —— 会话/token 包（access/refresh/user/apiMode/apiKey）
 *   pomo-pwa:music-meta  —— 播放器本地元数据（标签、自定义标签等）
 *
 * 安全说明：浏览器 localStorage 无加密。PWA v1 不保存明文密码——
 * "记住密码/自动登录"由 refresh token（30 天滚动）承担；saveCredentials 为 no-op。
 *
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

import { LS_PREFIX } from "./config";

export type JsonObject = Record<string, unknown>;

/** 读取 JSON（不存在或解析失败返回 fallback） */
export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as object) } as T;
  } catch {
    return fallback;
  }
}

/** 写入 JSON（失败静默） */
export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value));
  } catch (e) {
    console.warn("[PWA storage] save failed:", e);
  }
}

/** 删除 */
export function removeKey(key: string): void {
  try {
    localStorage.removeItem(LS_PREFIX + key);
  } catch {
    /* 忽略 */
  }
}

// ===== 数据 / 设置 =====

export function loadData(): JsonObject {
  return loadJson<JsonObject>("data", {});
}
export function saveData(data: JsonObject): void {
  saveJson("data", data);
}
export function loadSettings(): JsonObject {
  return loadJson<JsonObject>("settings", {});
}
export function saveSettings(settings: JsonObject): void {
  saveJson("settings", settings);
}

// ===== 认证 =====

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user?: { id: string; username: string; admin?: boolean };
  apiMode?: string;
  apiKey?: string;
}

const EMPTY_TOKENS: AuthTokens = { accessToken: "", refreshToken: "" };

export function loadAuth(): AuthTokens {
  try {
    const raw = localStorage.getItem(LS_PREFIX + "auth");
    if (!raw) return { ...EMPTY_TOKENS };
    return { ...EMPTY_TOKENS, ...(JSON.parse(raw) as Partial<AuthTokens>) };
  } catch {
    return { ...EMPTY_TOKENS };
  }
}
export function saveAuth(t: AuthTokens): void {
  saveJson("auth", t);
}
export function clearAuth(): void {
  removeKey("auth");
}
export function getAccessToken(): string {
  return loadAuth().accessToken;
}
export function getRefreshToken(): string {
  return loadAuth().refreshToken;
}
export function getApiMode(): string {
  return loadAuth().apiMode || "cloud";
}
export function getApiKey(): string {
  return loadAuth().apiKey || "";
}

// ===== 音乐本地元数据 =====

export interface MusicMeta {
  /** 歌名 → 标签 { name, color } */
  tags: Record<string, { name: string; color: string | null }>;
  /** 自定义标签 名 → 颜色 */
  customTags: Record<string, string>;
}

const DEFAULT_META: MusicMeta = { tags: {}, customTags: {} };

export function loadMusicMeta(): MusicMeta {
  return loadJson<MusicMeta>("music-meta", DEFAULT_META);
}
export function saveMusicMeta(meta: MusicMeta): void {
  saveJson("music-meta", meta);
}
