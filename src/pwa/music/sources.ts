/**
 * 音乐 URL 解析 + 浏览器缓存（Cache API）
 *
 * - 内置曲目：/tracks/<encoded name>（PWA 静态资源，SW runtime-cache）
 * - 服务器曲库：${API_ORIGIN}/music/<encoded name>（生产同源，SW runtime-cache）
 *
 * "下载到 PWA 缓存"：cacheSong(url) 主动 fetch 并写入 Cache Storage，
 * isSongCached / uncacheSong 供"已缓存"标记与清理。
 *
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

import { API_ORIGIN, MUSIC_CACHE } from "../config";

export function songUrl(name: string, source: "bundled" | "library" | "local"): string {
  const enc = encodeURIComponent(name);
  // local（P2P 落盘歌曲）没有静态 URL：正常走 IDB blob（resolveUrl 优先），此处兜底同 library
  return source === "bundled" ? `/tracks/${enc}` : `${API_ORIGIN}/music/${enc}`;
}

function openCache(): Promise<Cache> {
  return caches.open(MUSIC_CACHE);
}

export async function isSongCached(url: string): Promise<boolean> {
  try {
    const cache = await openCache();
    const resp = await cache.match(url);
    return !!resp;
  } catch {
    return false;
  }
}

/** 主动下载一首歌进浏览器缓存（失败静默返回 false） */
export async function cacheSong(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url, { cache: "no-cache" });
    if (!resp.ok) return false;
    const cache = await openCache();
    await cache.put(url, resp.clone());
    return true;
  } catch (e) {
    console.warn("[PWA] 缓存歌曲失败:", url, e);
    return false;
  }
}

export async function uncacheSong(url: string): Promise<void> {
  try {
    const cache = await openCache();
    await cache.delete(url);
  } catch {
    /* 忽略 */
  }
}

/** 统计已缓存歌曲数（用于"已下载 X 首"展示） */
export async function countCachedSongs(): Promise<number> {
  try {
    const cache = await openCache();
    const keys = await cache.keys();
    return keys.filter((r) => r.url.includes("/music/") || r.url.includes("/tracks/")).length;
  } catch {
    return 0;
  }
}

/**
 * 列出 Cache 里已下载/已缓存的曲库歌（/music/），返回解码后的歌名。
 * 用于启动时把"下载过的曲库歌"重新并入播放列表 —— 即使某首歌已不在最新
 * music-manifest.json（版本更新/清单变化），只要字节还在缓存里就不丢。
 */
export async function listCachedLibrarySongs(): Promise<string[]> {
  try {
    const cache = await openCache();
    const keys = await cache.keys();
    const names = new Set<string>();
    for (const req of keys) {
      const url = new URL(req.url);
      if (url.pathname.startsWith("/music/")) {
        const last = url.pathname.split("/").filter(Boolean).pop();
        if (!last) continue;
        try {
          names.add(decodeURIComponent(last));
        } catch {
          names.add(last);
        }
      }
    }
    return [...names];
  } catch {
    return [];
  }
}
