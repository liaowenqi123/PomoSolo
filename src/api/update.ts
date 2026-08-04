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
  /** 最新版本是 prerelease（beta/alpha/rc）且用户未开启 Beta 接收（v4.5.18） */
  betaOnly?: boolean;
  /** 被跳过的 beta 版本号 */
  betaVersion?: string;
}

// ===== API =====

/**
 * 检查更新（指定更新源）
 *
 * 后端会 emit "update-status" 事件（available / not-available / error）。
 * 返回 UpdateInfo 表示有更新，null 表示已是最新。
 *
 * @param source 更新源
 * @param allowBeta 是否接收 Beta 版本（默认 false：正式渠道跳过 prerelease）
 */
export async function checkUpdate(
  source: UpdateSource = "github",
  allowBeta: boolean = false,
): Promise<UpdateInfo | null> {
  return await invoke<UpdateInfo | null>("check_update", {
    source,
    allowBeta,
  });
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
