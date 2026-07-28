/**
 * 音乐榜单 API
 *
 * 对应 Electron 旧版 chartsFetcher.js + charts.js 中的 window.electronAPI 调用。
 * 获取网易云/QQ 音乐热歌榜，支持下载（通过 Rust 后端调用 Python 子进程）。
 *
 * 命令命名（Rust 端 snake_case）：
 * - charts_fetch(source) -> 热歌榜
 * - download_song(title, artist) -> 下载歌曲
 * - get_download_status -> 下载状态
 */
import { invoke } from "@tauri-apps/api/core";

// ===== 类型定义 =====

export type ChartSource = "netease" | "qq";

export interface ChartSong {
  rank: number;
  title: string;
  artist: string;
  album: string;
}

export interface ChartsResult {
  success: boolean;
  songs?: ChartSong[];
  error?: string;
}

export type DownloadStatus = "success" | "exists" | "no_video" | "no_instrumental" | "failed";

export interface DownloadResult {
  success: boolean;
  status?: DownloadStatus;
  error?: string;
}

export interface DownloadStatusInfo {
  isDownloading: boolean;
  currentSong?: { title: string; artist: string };
  queueLength?: number;
}

// ===== API =====

/** 获取榜单数据 */
export function chartsFetch(source: ChartSource): Promise<ChartsResult> {
  return invoke<ChartsResult>("charts_fetch", { source });
}

/** 下载歌曲 */
export function downloadSong(title: string, artist: string): Promise<DownloadResult> {
  return invoke<DownloadResult>("download_song", { title, artist });
}

/** 获取下载状态 */
export function getDownloadStatus(): Promise<DownloadStatusInfo> {
  return invoke<DownloadStatusInfo>("get_download_status");
}
