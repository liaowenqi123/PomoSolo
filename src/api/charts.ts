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
 * - charts_set_api_key(apiKey) -> 注入 API Key 到 ChartsState 内存（修复 4.6 Bug）
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

// 注意：Rust 后端 charts.rs 在退出码 0 时返回 "downloaded"（而非 "success"），
// 退出码 2 返回 "exists"，3 返回 "no_video"，4 返回 "no_instrumental"，其他返回 "failed"。
export type DownloadStatus = "downloaded" | "exists" | "no_video" | "no_instrumental" | "failed";

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

/**
 * 注入 API Key 到 ChartsState 内存。
 *
 * 修复 docs/modules/cloud-and-charts.md 4.6 节 Bug：`save_api_key` 原本只写 `data.json`，
 * 不同步 `ChartsState.inner.api_key`，导致 `download_song` 始终返回"请先登录或配置 DeepSeek API Key"。
 *
 * 应在 `saveApiKey` / `cloud_login` 成功后调用。传空串则清空内存中的 Key。
 * 后端：`charts_set_api_key(api_key: String) -> Result<(), String>`
 */
export function setApiKey(apiKey: string): Promise<void> {
  return invoke<void>("charts_set_api_key", { apiKey });
}
