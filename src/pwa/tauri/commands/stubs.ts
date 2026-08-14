/**
 * 砍去功能的命令桩（PWA）
 *
 * 桌面端被砍板块（菜园子/专注模式/图表下载/AI/更新/种子/反馈/P2P 测试）的
 * 命令在 PWA 中一律返回明确"不支持"错误。复用的组件调用它们时自带 .catch()
 * 兜底（桌面端命令也可能失败），因此不会白屏，只是对应按钮/功能不可用。
 *
 * 注意：这些命令保持注册，而不是直接缺失——缺失会让 core.ts 打未知命令日志，
 * 注册后组件拿到的是"功能不可用"的可预期错误。
 *
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

const UNSUPPORTED = "该功能在 PWA 端暂不支持";

export async function cmdUnsupported(): Promise<never> {
  throw new Error(UNSUPPORTED);
}

/** charts_set_api_key：云端模式下设置 key 的内存注入，PWA 无图表 → no-op 成功 */
export async function cmdChartsSetApiKey(): Promise<void> {
  /* no-op */
}

/** get_download_status：无下载队列 → 空闲 */
export async function cmdGetDownloadStatus(): Promise<{
  isDownloading: boolean;
  queueLength: number;
}> {
  return { isDownloading: false, queueLength: 0 };
}
