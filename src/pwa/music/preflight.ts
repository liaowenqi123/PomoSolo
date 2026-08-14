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
 *   避免列出当前播不动的歌（服务器曲库未托管前曲库为空属预期）。
 */
import type { ManifestSong } from "./types";
import { loadManifest } from "./manifest";
import { songUrl, cacheSong, isSongCached } from "./sources";

export interface PreflightResult {
  /** 可播放歌曲（内置已就绪 + 曲库已缓存） */
  songs: ManifestSong[];
  /** 是否至少有 1 首内置曲目就绪（决定播放器是否启动） */
  ready: boolean;
}

export async function preflightManifest(): Promise<PreflightResult> {
  const manifest = await loadManifest();
  const playable: ManifestSong[] = [];
  let bundledOk = 0;

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
        playable.push(song);
        bundledOk++;
      } catch (e) {
        console.warn("[PWA] 内置曲目预检失败:", song.name, e);
      }
    } else if (await isSongCached(url)) {
      playable.push(song);
    }
  }

  return { songs: playable, ready: bundledOk > 0 };
}
