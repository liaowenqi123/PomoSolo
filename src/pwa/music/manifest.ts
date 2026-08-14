/**
 * 音乐清单加载
 *
 * 清单由 pwa/scripts/generate-music-manifest.mjs 从 music-player/music/ + tags.json 生成，
 * 随 PWA 构建产物发布（public/music-manifest.json）。
 * 运行期：内置 3 首主题曲 + 服务器曲库（/music）——服务器曲库是否在线取决于服务器部门
 * 是否已按 server-planning/PWA-requirements.md 托管，清单本身始终可用。
 *
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

import { MANIFEST_URL } from "../config";
import type { MusicManifest } from "./types";

/** 内置曲目（永远离线可用）：3 首番茄钟主题曲 */
export const BUNDLED_TRACK_NAMES = new Set([
  "番茄倒数快一点 - 番茄钟.mp3",
  "番茄小宇宙 - 番茄钟.mp3",
  "Tick Tock, Take Control - 番茄钟.mp3",
]);

/** 加载音乐清单（失败时抛错，由调用方兜底到空歌单） */
export async function loadManifest(): Promise<MusicManifest> {
  const resp = await fetch(MANIFEST_URL, { cache: "no-cache" });
  if (!resp.ok) throw new Error(`音乐清单加载失败 HTTP ${resp.status}`);
  const data = (await resp.json()) as MusicManifest;
  return data;
}

export const EMPTY_MANIFEST: MusicManifest = { version: 1, songs: [] };
