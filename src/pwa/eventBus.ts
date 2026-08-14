/**
 * 应用内事件总线
 *
 * 桌面端用 @tauri-apps/api/event 的 listen/emit 收发自 Rust 后端事件
 * （音乐进度、播放状态、ws-event 等）。PWA 没有 Rust 后端，但为了"真实复用"
 * 桌面端组件（MusicPlayer.vue / StudyRoom.vue 通过 useTauriEvent 监听事件），
 * 我们用 alias 把 @tauri-apps/api/event 替换成本模块姊妹件 pwa/src/tauri/event.ts，
 * 其底层就是这一个应用内总线：
 *
 *   - 浏览器音频引擎把 播放/进度/歌单 等事件 emit 进总线；
 *   - WebSocket 客户端把服务器推送的 ws-event 也 emit 进总线；
 *   - 复用的组件用 listen() 订阅，行为与桌面端完全一致。
 *
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

type Handler = (payload: unknown) => void;

const listeners = new Map<string, Set<Handler>>();
const onceListeners = new Map<string, Set<Handler>>();

/** 订阅事件，返回取消函数 */
export function on(event: string, handler: Handler): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(handler);
  return () => {
    set!.delete(handler);
    if (set!.size === 0) listeners.delete(event);
  };
}

/** 只订阅一次 */
export function once(event: string, handler: Handler): () => void {
  let set = onceListeners.get(event);
  if (!set) {
    set = new Set();
    onceListeners.set(event, set);
  }
  set.add(handler);
  return () => {
    set!.delete(handler);
    if (set!.size === 0) onceListeners.delete(event);
  };
}

/** 广播事件（同步执行所有订阅者，异常隔离） */
export function emit(event: string, payload: unknown): void {
  const handlers = listeners.get(event);
  if (handlers) {
    for (const h of [...handlers]) {
      try {
        h(payload);
      } catch (e) {
        console.error(`[PWA eventBus] handler for "${event}" failed:`, e);
      }
    }
  }
  const oncers = onceListeners.get(event);
  if (oncers) {
    for (const h of [...oncers]) {
      try {
        h(payload);
      } catch (e) {
        console.error(`[PWA eventBus] once-handler for "${event}" failed:`, e);
      }
    }
    onceListeners.delete(event);
  }
}
