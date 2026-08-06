/**
 * 信令客户端：连接 PomoSolo 服务器 WS，发送/接收 peer:* 信令。
 * 服务器只做定向转发（server-planning/ws_server.py handle_peer_signal）。
 */
import WebSocket from "ws";

export class Signaling {
  /**
   * @param {string} wsBase ws://host[:port]（不含路径）
   * @param {string} token access_token
   */
  constructor(wsBase, token) {
    this.wsBase = wsBase;
    this.token = token;
    this.ws = null;
    this.handlers = new Map(); // type -> Set<cb>
  }

  /** 建立 WS 连接（等待 open） */
  connect(timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
      const url = `${this.wsBase}/ws?token=${this.token}`;
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error(`WS 连接超时: ${url}`));
      }, timeoutMs);
      ws.on("open", () => {
        clearTimeout(timer);
        this.ws = ws;
        ws.on("message", (raw) => {
          let msg;
          try {
            msg = JSON.parse(raw.toString());
          } catch {
            return;
          }
          if (msg && typeof msg.type === "string" && msg.type.startsWith("peer:")) {
            const cbs = this.handlers.get(msg.type);
            if (cbs) for (const cb of cbs) cb(msg);
          }
        });
        ws.on("close", () => {
          for (const cbs of this.handlers.values()) for (const cb of cbs) cb({ type: "peer:bye", from_user_id: "__ws_closed__" });
        });
        resolve();
      });
      ws.on("error", (e) => {
        clearTimeout(timer);
        reject(new Error(`WS 错误: ${e.message}`));
      });
    });
  }

  /** 注册 peer:* 消息处理器 */
  on(type, cb) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(cb);
  }

  /** 发送信令到指定用户 */
  send(type, toUserId, payload = {}) {
    if (!this.ws) throw new Error("WS 未连接");
    this.ws.send(JSON.stringify({ type, to_user_id: toUserId, ...payload }));
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}
