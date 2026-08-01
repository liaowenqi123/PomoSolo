/**
 * Tauri API 统一封装层
 *
 * 替代旧版 Electron 的 preload.js。
 * 所有 Rust 命令调用通过 @tauri-apps/api 的 invoke 触发；
 * 所有后端事件通过 @tauri-apps/api/event 的 listen 监听。
 *
 * 使用示例：
 * ```ts
 * import { readData, writeData, setAlwaysOnTop, gardenRead } from "@/api";
 *
 * const data = await readData();
 * await setAlwaysOnTop(true);
 * ```
 */
export * from "./data";
export * from "./window";
export * from "./auth";
export * from "./garden";
export * from "./foreground";
export * from "./timer";
export * from "./events";
export * from "./music";
export * from "./musicSync";
export * from "./charts";
export * from "./ai";
export * from "./studyRoom";
export * from "./sync";
export * from "./system";

// 同时直接导出 invoke / listen，方便调用方按需使用
export { invoke } from "@tauri-apps/api/core";
export { listen, once, emit, emitTo, TauriEvent } from "@tauri-apps/api/event";
export type {
  Event,
  EventCallback,
  UnlistenFn,
  Options,
} from "@tauri-apps/api/event";
