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

/**
 * 服务器公告（v4.5.21 新增）
 *
 * 更新失败（签名验证失败/下载失败/解析失败）时向前端展示官方指引，
 * 避免用户在出错时不知道怎么做。来源：服务器 /updates/notice.json。
 */
export interface UpdateNotice {
  active: boolean;
  level?: string;
  text?: string;
  url?: string;
  min_version?: string;
  max_version?: string;
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
 *
 * @param source 更新源
 * @param allowBeta 是否下载 Beta 版本（须与 checkUpdate 一致，否则会下载到正式版）
 */
export async function downloadAndInstall(
  source: UpdateSource = "github",
  allowBeta: boolean = false,
): Promise<void> {
  await invoke("download_and_install", { source, allowBeta });
}

/**
 * 拉取服务器公告（按当前版本过滤生效范围，v4.5.21）
 *
 * 更新出错时调用，展示官方指引（如手动升级路径）。失败返回 null，不阻塞任何流程。
 * @param version 当前应用版本
 */
export async function fetchNotice(version: string): Promise<UpdateNotice | null> {
  return await invoke<UpdateNotice | null>("fetch_notice", { version });
}
