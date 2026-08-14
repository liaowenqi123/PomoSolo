/**
 * @tauri-apps/api/core 的浏览器替身（PWA）
 *
 * 桌面端所有 src/api/*.ts 都从 `@tauri-apps/api/core` import invoke。
 * PWA 通过 Vite alias 把该包替换到这里：invoke(cmd, args) 走命令注册表
 * （pwa/src/tauri/commands/registry.ts），把 Tauri 命令路由到浏览器实现：
 *   - 数据持久化 → localStorage
 *   - 云端账号/同步 → REST fetch（pwa/src/http.ts）
 *   - 自习室/同步听歌/P2P 信令 → WebSocket（pwa/src/ws.ts）
 *   - 音乐播放 → HTML5 Audio（pwa/src/audio/）
 *   - 其余浏览器做不到的命令 → 抛出明确错误，复用的组件自带 .catch() 兜底
 *
 * 这就是"真实复用"的关键：复用的 src/api/* 与 src/stores/* 一行不改，
 * 只有最底层运输被替换。
 *
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

import { commandRegistry } from "./commands/registry";

/**
 * 调用 Tauri 命令（PWA 路由到浏览器实现）。
 * 参数 key 保持 snake_case（桌面端调用处已如此传参）。
 */
export async function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const handler = commandRegistry[cmd];
  if (!handler) {
    const err = `[PWA] 命令 "${cmd}" 在 PWA 端暂不支持（浏览器无此能力，或该功能已在 PWA 中砍去）`;
    console.warn(err);
    throw new Error(err);
  }
  return handler(args ?? {}) as Promise<T>;
}

/** 与 @tauri-apps/api/core 对齐的 TransformCallback 类型（PWA 无实际用途） */
export type TransformCallback<T> = (response: T) => T;

/** Channel 类（PWA 无 IPC 通道，仅保持类型兼容） */
export class Channel<T = unknown> {
  id = 0;
  onmessage: ((message: T) => void) | null = null;
}
