/**
 * 自动更新 API
 *
 * 基于 tauri-plugin-updater，对应原 Electron 版 electron-updater。
 * 后端事件 "update-status" 兼容原版状态机：
 *   checking → available | not-available | error
 *   available → (用户点击下载) → downloading → downloaded → (自动安装重启)
 */
import { invoke } from "@tauri-apps/api/core";

// ===== 类型定义 =====

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
 * 检查更新
 *
 * 后端会 emit "update-status" 事件（available / not-available / error）。
 * 返回 UpdateInfo 表示有更新，null 表示已是最新。
 */
export async function checkUpdate(): Promise<UpdateInfo | null> {
  return await invoke<UpdateInfo | null>("check_update");
}

/**
 * 下载并安装更新
 *
 * 后端会先备份用户音乐，然后下载并通过 "update-status" 事件报告进度。
 * 安装完成后应用会自动退出重启。
 */
export async function downloadAndInstall(): Promise<void> {
  await invoke("download_and_install");
}
