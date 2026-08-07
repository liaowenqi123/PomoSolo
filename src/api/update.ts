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
  /** 最新版本是 prerelease（beta/alpha/rc）且用户未开启 Beta 接收（v4.5.18） */
  betaOnly?: boolean;
  /** 被跳过的 beta 版本号 */
  betaVersion?: string;
  /** 更新源上的最新版本号（无更新提示时展示，v4.6.6） */
  latestVersion?: string;
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
 * 后端会先备份用户音乐，然后启动后台下载任务并通过 "update-status" 事件报告进度
 * （percent 保留 1 位小数），支持暂停/继续/断点续传。下载完成后自动校验签名、
 * 留存安装包并启动安装器，应用自动退出重启。
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

/** 暂停下载（保留已下载数据；继续时从断点续传） */
export async function updateDownloadPause(): Promise<void> {
  await invoke("update_download_pause");
}

/** 继续下载（从断点偏移发 Range 请求续传） */
export async function updateDownloadResume(): Promise<void> {
  await invoke("update_download_resume");
}

/** 取消下载（后台任务删除残留文件） */
export async function updateDownloadCancel(): Promise<void> {
  await invoke("update_download_cancel");
}

/**
 * 本地安装包覆盖安装（v4.7.0）
 *
 * 选中本地安装包后直接覆盖安装：不卸载旧版、保留任务栏/开始菜单固定快捷方式
 * （后端用 /S /UPDATE 静默升级模式）。文件名版本与本机留存 latest.json 匹配时
 * 会先校验 Ed25519 签名，失败拒绝安装。
 *
 * @param path 本地安装包绝对路径（由文件选择器获得）
 */
export async function installLocalInstaller(path: string): Promise<void> {
  await invoke("install_local_installer", { path });
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

/** 种子端读取安装包分片结果（与 music_read_song_chunk_bin 同构） */
export interface SeedReadChunkResult {
  success: boolean;
  error?: string;
  total_chunks?: number;
  chunk_size?: number;
  data?: number[];
}

/**
 * 种子端：读取本机留存的安装包分片（v4.6.6 补齐种子端后新增）。
 *
 * 文件来源：安装目录 resources/installers/PomoSolo_<version>_x64-setup.exe
 * （更新成功后由 Rust 自动留存，只保留最新版本）。
 * 供下载端经 WebRTC DataChannel 拉取安装包时逐片读取。
 * 后端：`update_seed_read_chunk(version, chunk_index)`
 */
export async function updateSeedReadChunk(
  version: string,
  chunkIndex: number,
): Promise<SeedReadChunkResult> {
  return await invoke<SeedReadChunkResult>("update_seed_read_chunk", {
    version,
    chunkIndex,
  });
}

/**
 * 种子端：本机是否留存有指定版本的安装包（开启"分享安装包"前校验）。
 * 后端：`update_seed_has_installer(version) -> bool`
 */
export async function updateSeedHasInstaller(version: string): Promise<boolean> {
  return await invoke<boolean>("update_seed_has_installer", { version });
}
