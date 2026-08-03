/**
 * 自动更新 API
 *
 * 自实现更新器（支持运行时选择更新源）：
 * - github：默认，下载快但国内可能不稳定
 * - server：用户自己的服务器（稳定但较慢）
 * 后端事件 "update-status" 兼容原版状态机：
 *   checking → available | not-available | error
 *   available → (用户点击下载) → downloading → downloaded → (启动安装器自动重启)
 */
import { invoke } from "@tauri-apps/api/core";

// ===== 类型定义 =====

/** 更新源：github（默认，快但可能不稳定）/ server（稳定但慢） */
export type UpdateSource = "github" | "server";

export interface UpdateInfo {
  version: string;
  notes: string;
  date: string | null;
  /** 安装包 Ed25519 签名（latest.json 下发，P2P 种子下载收齐后校验用） */
  signature?: string | null;
}

export type UpdateStatus =
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export interface UpdateStatusPayload {
  status: UpdateStatus;
  version?: string;
  releaseDate?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  message?: string;
}

// ===== API =====

/**
 * 检查更新（指定更新源）
 *
 * 后端会 emit "update-status" 事件（available / not-available / error）。
 * 返回 UpdateInfo 表示有更新，null 表示已是最新。
 */
export async function checkUpdate(
  source: UpdateSource = "github",
): Promise<UpdateInfo | null> {
  return await invoke<UpdateInfo | null>("check_update", { source });
}

/**
 * 下载并安装更新（指定更新源）
 *
 * 后端会先备份用户音乐，然后下载并通过 "update-status" 事件报告进度，
 * 校验安装包签名后启动安装器，应用自动退出重启。
 */
export async function downloadAndInstall(
  source: UpdateSource = "github",
): Promise<void> {
  await invoke("download_and_install", { source });
}

// ===== Phase 2：P2P 种子下载安装包 =====
//
// 前端（WebView2 原生 WebRTC）从在线种子拉安装包分片 → 逐片经下方命令落盘；
// Rust 收齐后自动校验签名并启动安装器。失败/无种子时前端回退 downloadAndInstall。

/**
 * 开始种子下载：预创建临时文件并初始化会话（version 决定临时文件名）
 */
export async function updateSeedDownloadBegin(
  version: string,
  signature: string,
): Promise<void> {
  await invoke("update_seed_download_begin", { version, signature });
}

/**
 * 写入一片安装包数据。收齐后 Rust 自动校验签名并启动安装器（应用退出）。
 *
 * @param chunk 二进制分片（DataChannel 原始字节）
 * @param chunkIndex 片序号（0-based，DataChannel ordered 顺序到达）
 * @param totalChunks 总片数
 */
export async function updateSeedDownloadChunk(
  chunk: number[],
  chunkIndex: number,
  totalChunks: number,
): Promise<void> {
  await invoke("update_seed_download_chunk", {
    chunk,
    chunkIndex,
    totalChunks,
  });
}

/**
 * 中止种子下载（P2P 失败回退时调用）：清会话 + 删除残留临时文件
 */
export async function updateSeedDownloadAbort(): Promise<void> {
  await invoke("update_seed_download_abort");
}
