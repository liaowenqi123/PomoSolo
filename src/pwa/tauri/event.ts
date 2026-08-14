/**
 * @tauri-apps/api/event 的浏览器替身（PWA）
 *
 * 通过 Vite alias 把 `@tauri-apps/api/event` 替换到这里，让桌面端组件里
 * `listen("music-progress", ...)` / `listen("ws-event", ...)` 等调用在浏览器里
 * 落到应用内事件总线（pwa/src/eventBus.ts），由 PWA 自己的音频引擎与 WS 客户端喂数据。
 *
 * 签名与 @tauri-apps/api/event 对齐（listen 返回 Promise<UnlistenFn>、handler 收 Event 对象），
 * 保证复用的组件（MusicPlayer.vue / StudyRoom.vue / api/events.ts）零改动可用。
 *
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

import { on, once as onceBus, emit as emitBus } from "../eventBus";

/** 与 @tauri-apps/api/event 对齐的事件对象 */
export interface Event<T> {
  /** 事件名 */
  event: string;
  /** 事件 id（可选） */
  id?: number;
  /** 事件负载 */
  payload: T;
}

/** 事件回调签名（与桌面端一致：回调参数是 { event, payload }） */
export type EventCallback<T> = (event: Event<T>) => void;

/** 取消监听函数 */
export type UnlistenFn = () => void;

/** 监听选项（PWA 忽略 target，仅保持类型兼容） */
export interface Options {
  target?: unknown;
}

/** Tauri 窗口事件名枚举（PWA 仅保留常用项以兼容类型引用） */
export enum TauriEvent {
  WINDOW_RESIZED = "tauri://resize",
  WINDOW_MOVED = "tauri://move",
  WINDOW_CLOSE_REQUESTED = "tauri://close-requested",
  WINDOW_DESTROYED = "tauri://destroyed",
  WINDOW_FOCUS = "tauri://focus",
  WINDOW_BLUR = "tauri://blur",
  WINDOW_SCALE_FACTOR_CHANGED = "tauri://scale-change",
  WINDOW_THEME_CHANGED = "tauri://theme-changed",
}

/**
 * 监听事件。返回 Promise<UnlistenFn>（与桌面端 listen 一致）。
 * 组件常写 `void listen("xxx", cb).then(fn => unlisten = fn).catch(() => {})`。
 */
export async function listen<T>(
  event: string,
  handler: EventCallback<T>,
  _options?: Options,
): Promise<UnlistenFn> {
  return on(event, (payload) =>
    handler({ event, payload: payload as T }),
  );
}

/** 只监听一次。返回 Promise<UnlistenFn>。 */
export async function once<T>(
  event: string,
  handler: EventCallback<T>,
  _options?: Options,
): Promise<UnlistenFn> {
  return onceBus(event, (payload) =>
    handler({ event, payload: payload as T }),
  );
}

/** 广播事件。返回 Promise<void>（桌面端 emit 返回 Promise）。 */
export async function emit(event: string, payload?: unknown): Promise<void> {
  emitBus(event, payload);
}

/** 定向广播（PWA 内退化为全局广播）。 */
export async function emitTo(_target: unknown, event: string, payload?: unknown): Promise<void> {
  emitBus(event, payload);
}
