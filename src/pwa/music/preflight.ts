/**
 * 播放器就绪预检：确保可播放歌曲就绪后才启动底部播放器
 *
 * 需求（用户 2026-08-15）：
 * - 每次启动都检查列表中的歌是否都在；内置 3 首主题曲必须"下载好"才开始运作，
 *   避免像开屏加载条一样先闪一个空播放器；
 * - 宁缺毋滥：没有任何内置曲目可用 → ready=false，App 不渲染底部播放器
 *   （有歌放才启动播放器）。
 *
 * 逻辑：
 * - 内置曲目（/tracks/）：首次启动下载进 Cache API（pomo-pwa-music-v1），
 *   之后启动先查缓存命中、缺失才重新下载 → "歌都在"；
 * - 服务器曲库曲目（/music/）：仅当已缓存（离线可用）才纳入列表，
 *   避免列出当前播不动的歌（服务器曲库未托管前曲库为空属预期）；
 * - **持久化恢复（v0.5 起）**：
 *   1) 扫描 Cache API 里所有 /music/ 命中 → 把"下载过的曲库歌"重新并入列表，
 *      即使它已不在最新 music-manifest.json（版本更新/清单变化也不丢）；
 *   2) 读 pomo-pwa:library 里 source=local 的歌名 → 校验 IDB 仍有 blob →
 *      并入列表（P2P 收到的歌刷新/更新后不消失，字节在 IndexedDB）。
 */
import type { ManifestSong } from "./types";
import { loadManifest } from "./manifest";
import { songUrl, cacheSong, isSongCached, listCachedLibrarySongs } from "./sources";
import { idbGetBlob } from "./idb";
import { getLibraryNames } from "./library";

export interface PreflightResult {
  /** 可播放歌曲（内置已就绪 + 曲库已缓存 + 本地库恢复） */
  songs: ManifestSong[];
  /** 是否至少有 1 首内置曲目就绪（决定播放器是否启动） */
  ready: boolean;
}

export async function preflightManifest(): Promise<PreflightResult> {
  const manifest = await loadManifest();
  const seen = new Set<string>();
  const playable: ManifestSong[] = [];
  let bundledOk = 0;

  const push = (song: ManifestSong) => {
    if (seen.has(song.name)) return;
    seen.add(song.name);
    playable.push(song);
  };

  for (const song of manifest.songs) {
    const url = songUrl(song.name, song.source);
    if (song.source === "bundled") {
      try {
        if (!(await isSongCached(url))) {
          const ok = await cacheSong(url);
          if (!ok) {
            console.warn("[PWA] 内置曲目下载失败:", song.name);
            continue;
          }
        }
        push(song);
        bundledOk++;
      } catch (e) {
        console.warn("[PWA] 内置曲目预检失败:", song.name, e);
      }
    } else if (await isSongCached(url)) {
      push(song);
    }
  }

  // 1) 恢复"已下载的曲库歌"（可能已不在当前 manifest）
  const cachedLibrary = await listCachedLibrarySongs().catch(() => []);
  for (const name of cachedLibrary) push({ name, source: "library" });

  // 2) 恢复"P2P 收到的本地歌"（local granularity：IDB 有 blob 才保留）
  const localNames = getLibraryNames("local");
  for (const name of localNames) {
    try {
      const blob = await idbGetBlob(name);
      if (blob) push({ name, source: "local" });
    } catch {
      /* 该歌无有效 blob，忽略 */
    }
  }

  return { songs: playable, ready: bundledOk > 0 };
}
