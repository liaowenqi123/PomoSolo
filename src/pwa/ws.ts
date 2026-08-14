/**
 * PWA WebSocket 客户端
 *
 * 对接自建服务器 WS 协议（server-planning/EXTERNAL-INTERFACES.md §3-§6）：
 * - 连接：ws(s)://<host>/ws?token=<access_token>
 * - 请求-响应：消息带 id → 服务器回同名 id（room:create / room:join / ping / p2p:online / p2p:seed_list）
 * - 纯广播：不带 id（fire-and-forget）
 * - 心跳：每 10s 发 ping → 服务器回 pong
 *
 * 关键：把服务器每一条推送原样 emit 到应用内事件总线 "ws-event"（与桌面端 Rust
 * modules/ws.rs 转发行为一致），复用的 StudyRoom.vue / music store 就能零改动消费；
 * 断线时 emit "ws-disconnected" 触发复用的自动重连逻辑。
 *
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

import { API_ORIGIN } from "./config";
import { getAccessToken } from "./storage";
import { emit as busEmit } from "./eventBus";

interface Pending {
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let ws: WebSocket | null = null;
let manualClosed = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let attempt = 0;
let idCounter = 1;
const pending = new Map<number, Pending>();

const HEARTBEAT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * 构建 WS 地址：协议跟随安全上下文
 *
 * ⚠️ 与桌面端同款 bug 的修复（主部门 v4.7.12 修 Rust 侧，此处修浏览器侧）：
 * 服务器迁移到 https://api.pomogrow.top 后 WS 必须走 wss://。
 * 浏览器安全策略：HTTPS 页面**禁止**发起 ws://（报 "Failed to construct 'WebSocket':
 * An insecure WebSocket connection may not be initiated from a page loaded over HTTPS"）。
 * 因此只要"页面是 HTTPS"或"API_ORIGIN 是 https"就必须用 wss。
 */
function buildUrl(): string {
  const token = getAccessToken();
  const origin = API_ORIGIN;
  const pageIsHttps = typeof window !== "undefined" && window.location.protocol === "https:";
  const secure = pageIsHttps || origin.startsWith("https");
  const proto = secure ? "wss" : "ws";
  const host = origin ? origin.replace(/^https?:\/\//, "") : window.location.host;
  return `${proto}://${host}/ws?token=${encodeURIComponent(token || "")}`;
}

function clearTimers(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function settleAll(err: Error): void {
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(err);
  }
  pending.clear();
}

/** 当前是否已连接 */
export function isConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

/** 手动断开（登出时调用，不再自动重连） */
export function disconnect(): void {
  manualClosed = true;
  clearTimers();
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  settleAll(new Error("WebSocket 已手动断开"));
}

/** 确保已连接（自动重连场景可反复调用，幂等） */
export async function ensureConnected(timeoutMs = 10_000): Promise<void> {
  if (isConnected()) return;
  if (ws && (ws.readyState === WebSocket.CONNECTING)) return;
  manualClosed = false;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("WebSocket 连接超时"));
    }, timeoutMs);
    const url = buildUrl();
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (e) {
      clearTimeout(timer);
      reject(e as Error);
      return;
    }
    ws = socket;

    socket.onopen = () => {
      clearTimeout(timer);
      attempt = 0;
      startHeartbeat();
      resolve();
    };
    socket.onerror = () => {
      // onclose 会随后触发并统一处理
    };
    socket.onclose = () => {
      clearTimeout(timer);
      if (ws === socket) ws = null;
      settleAll(new Error("WebSocket 连接断开"));
      busEmit("ws-disconnected", {});
      if (!manualClosed) scheduleReconnect();
      reject(new Error("WebSocket 连接关闭"));
    };
    socket.onmessage = (ev) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(ev.data as string) as Record<string, unknown>;
      } catch {
        return;
      }
      // 请求-响应：带 id 且本地有等待者 → 结算
      const msgId = typeof msg.id === "number" ? msg.id : undefined;
      if (msgId !== undefined && pending.has(msgId)) {
        const p = pending.get(msgId)!;
        pending.delete(msgId);
        clearTimeout(p.timer);
        if (msg.type === "error") {
          p.reject(new Error(String(msg.error ?? "服务器错误")));
        } else {
          p.resolve(msg);
        }
      }
      // 一律转发到总线（复用的组件按 type 消费）
      busEmit("ws-event", msg);
    };
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  const delay = Math.min(15_000, 1_000 * 2 ** attempt);
  attempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void ensureConnected().catch(() => {
      /* 失败由 onclose 再次调度 */
    });
  }, delay);
}

function startHeartbeat(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (isConnected()) {
      send("ping", {}, { withId: false }).catch(() => {});
    }
  }, HEARTBEAT_MS);
}

/**
 * 发送 WS 消息。
 * - withId=true（默认）：返回 Promise<响应消息>（服务器回同名 id），用于 room:create/join/ping 等
 * - withId=false：fire-and-forget，返回 Promise<void>
 */
export async function send(
  type: string,
  payload: Record<string, unknown> = {},
  opts: { withId?: boolean; timeoutMs?: number } = {},
): Promise<Record<string, unknown> | undefined> {
  const { withId = true, timeoutMs = REQUEST_TIMEOUT_MS } = opts;
  await ensureConnected();
  if (!isConnected()) throw new Error("WebSocket 未连接");

  if (!withId) {
    ws!.send(JSON.stringify({ type, ...payload }));
    return undefined;
  }

  const id = idCounter++;
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`请求超时: ${type}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try {
      ws!.send(JSON.stringify({ type, ...payload, id }));
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      reject(e as Error);
    }
  });
}
