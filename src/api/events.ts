/**
 * Tauri 事件监听工具
 *
 * 提供：
 * - 直接调用的 `listen` / `once` / `emit` / `emitTo`（来自 @tauri-apps/api/event）
 * - Vue composable `useTauriEvent` / `useTauriEventOnce`：自动在作用域销毁时取消监听
 */
import { onScopeDispose } from "vue";
import {
  listen,
  once,
  emit,
  emitTo,
  TauriEvent,
  type Event,
  type EventCallback,
  type UnlistenFn,
  type Options,
} from "@tauri-apps/api/event";

export { listen, once, emit, emitTo, TauriEvent };
export type { Event, EventCallback, UnlistenFn, Options };

/** 调用取消监听函数并返回 null（消除各 composable 中重复的 unlisten 清理逻辑） */
function unlistenAndClear(fn: UnlistenFn | null): UnlistenFn | null {
  if (fn) {
    fn();
  }
  return null;
}

/**
 * useTauriEvent 选项
 */
export interface UseTauriEventOptions {
  /**
   * 是否立即开始监听（默认 true）。
   * 设为 false 时，会在 onMounted 之前手动等待 start() 调用。
   */
  immediate?: boolean;
  /**
   * 事件监听目标（默认监听所有目标）
   */
  target?: Options["target"];
}

export interface UseTauriEventReturn {
  /** 取消监听函数（未启动时为 null） */
  unlisten: UnlistenFn | null;
  /** 是否已就绪（已成功注册监听） */
  ready: boolean;
  /** 手动启动监听 */
  start: () => Promise<void>;
  /** 手动停止监听 */
  stop: () => void;
}

/**
 * Vue composable：监听 Tauri 后端事件，自动在作用域销毁时取消监听。
 *
 * @example
 * ```ts
 * import { useTauriEvent } from "@/api/events";
 *
 * const status = ref(null);
 * const { ready } = useTauriEvent<ForegroundStatus>("foreground-status", (e) => {
 *   status.value = e.payload;
 * });
 * ```
 */
export function useTauriEvent<T>(
  eventName: string,
  handler: EventCallback<T>,
  options: UseTauriEventOptions = {},
): UseTauriEventReturn {
  const { immediate = true, target } = options;

  let unlistenFn: UnlistenFn | null = null;
  let started = false;

  const listenOptions: Options | undefined = target
    ? { target }
    : undefined;

  const start = async (): Promise<void> => {
    if (started) return;
    started = true;
    unlistenFn = await listen<T>(eventName, handler, listenOptions);
  };

  const stop = (): void => {
    unlistenFn = unlistenAndClear(unlistenFn);
    started = false;
  };

  if (immediate) {
    // 异步启动，但不阻塞 composable 返回
    void start();
  }

  // 作用域销毁时自动取消监听（在组件 setup 中即对应组件卸载）
  onScopeDispose(() => {
    stop();
  });

  return {
    get unlisten() {
      return unlistenFn;
    },
    get ready() {
      return unlistenFn !== null;
    },
    start,
    stop,
  };
}

/**
 * Vue composable：仅监听一次 Tauri 后端事件，触发后自动取消监听。
 *
 * @example
 * ```ts
 * import { useTauriEventOnce } from "@/api/events";
 *
 * useTauriEventOnce("foreground-ready", (e) => {
 *   console.log("前台检测已就绪", e.payload);
 * });
 * ```
 */
export function useTauriEventOnce<T>(
  eventName: string,
  handler: EventCallback<T>,
  options: Pick<UseTauriEventOptions, "target"> = {},
): Pick<UseTauriEventReturn, "stop"> {
  const { target } = options;
  const listenOptions: Options | undefined = target
    ? { target }
    : undefined;

  let unlistenFn: UnlistenFn | null = null;

  void (async () => {
    unlistenFn = await once<T>(eventName, handler, listenOptions);
  })();

  const stop = (): void => {
    unlistenFn = unlistenAndClear(unlistenFn);
  };

  onScopeDispose(stop);

  return { stop };
}
