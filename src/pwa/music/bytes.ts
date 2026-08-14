/**
 * 歌曲原始字节读取（P2P 传歌发送端用）
 *
 * 桌面端直接读音乐文件；PWA 从以下来源取字节（会话内内存缓存）：
 *   1. IndexedDB 已合并的 blob
 *   2. Cache Storage 已缓存的副本
 *   3. 远程 URL fetch（内置 /tracks、服务器曲库 /music）
 *
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

import { idbGetBlob } from "./idb";
import { songUrl } from "./sources";

const memoryCache = new Map<string, Uint8Array>();

export async function getSongBytes(
  name: string,
  source: "bundled" | "library",
): Promise<Uint8Array | null> {
  const hit = memoryCache.get(name);
  if (hit) return hit;

  // 1. IDB blob
  const blob = await idbGetBlob(name);
  if (blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    memoryCache.set(name, bytes);
    return bytes;
  }

  const url = songUrl(name, source);

  // 2. Cache Storage
  try {
    const cache = await caches.open("pomo-pwa-music-v1");
    const cached = await cache.match(url);
    if (cached) {
      const bytes = new Uint8Array(await cached.arrayBuffer());
      memoryCache.set(name, bytes);
      return bytes;
    }
  } catch {
    /* 忽略 */
  }

  // 3. 远程 fetch
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const bytes = new Uint8Array(await resp.arrayBuffer());
    memoryCache.set(name, bytes);
    return bytes;
  } catch (e) {
    console.warn("[PWA] 读取歌曲字节失败:", name, e);
    return null;
  }
}
