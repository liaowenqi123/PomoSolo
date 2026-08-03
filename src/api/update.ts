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
