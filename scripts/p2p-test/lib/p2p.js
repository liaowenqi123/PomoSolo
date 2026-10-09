/**
 * P2P（WebRTC DataChannel）虚拟端 —— 让虚拟客户端能走**直连**那条路。
 *
 * 线协议**逐条对照 `src/p2p.ts`**（权威），不是自造：
 *   · 控制消息（字符串 JSON）：`{"t":"meta","size":N,"totalChunks":M,"chunkSize":K}`
 *     并行传输时另带 `baseChunk`（本段全局起始序号）与 `globalChunks`（文件全局片数）
 *   · 数据消息（二进制）：4 字节大端 chunk_index + chunk 原始字节
 *   · 压缩协商：`{"t":"hello","v":2}` → `{"t":"hello-ack","compress":0|1}`
 *   · 收齐回执：接收端发 `{"t":"ack"}`
 *   · 信令：`peer:offer{sdp,tag}` / `peer:answer{sdp,tag}` / `peer:ice{candidate,tag}` / `peer:bye`
 *
 * ★ 关键设计：**「谁发起协商（role）」与「谁发数据（sender）」是解耦的** —— 这正是
 *   `src/p2p.ts` 的 `sender` 选项存在的理由。DataChannel 是全双工的，所以：
 *
 *   | 场景 | role | sender | 谁建 DataChannel | 谁 push 数据 |
 *   |------|------|--------|-----------------|-------------|
 *   | 正常传歌 | holder 作 offerer | offerer | holder | holder |
 *   | **反向打洞** | **下载端作 offerer** | **answerer** | 下载端 | **holder** |
 *
 *   反向打洞用于"正常方向（持有端作 offerer）打不通"的场景（对称 NAT）；
 *   下载端主动打洞、持有端在**收到的** channel 上发数据（v4.7.5）。
 *
 * ⚠️ 本实现只做**不压缩**（向后兼容路径，也是旧对端走的路）：
 *   · 作发送方：不发 hello → 对端按旧格式收（与真实 App 兼容）
 *   · 作接收方：收到 hello 就回 `hello-ack{compress:0}` 婉拒 → 对端改发原片
 *   压缩路径（deflate-raw）未覆盖，见 README 已知限制。
 *
 * Node 侧用 `werift`（纯 JS WebRTC，已有依赖），与 `peer.js` 同一套用法。
 */
import { RTCPeerConnection, RTCIceCandidate } from "werift";

/** 与 src/p2p.ts 的 DEFAULT_STUN 保持一致（国内可达性优先） */
export const DEFAULT_STUN = [
  "stun:stun.cloudflare.com:3478",
  "stun:stun.miwifi.com:3478",
  "stun:stun.chat.bilibili.com:3478",
  "stun:stun.l.google.com:19302",
];

export const DEFAULT_CHUNK_SIZE = 128 * 1024;

/**
 * ⚠️ 虚拟客户端走 P2P 时的分片大小（16KB），**必须小于 64KB**。
 *
 * 原因：`werift`（Node 的纯 JS WebRTC）单条 DataChannel 消息上限 **65536 字节**，
 * 且**不会自动分片**。发 128KB 会直接报
 * `max-message-size exceeded: 131076 > 65536`。
 *
 * **这是测试工具的限制，不是产品缺陷**：真实应用跑在 WebView2/Chromium 上，
 * 浏览器会自动做 SCTP 分片，所以 `src/p2p.ts` 的 `DEFAULT_CHUNK_SIZE = 128KB`
 * 在生产是正常的。
 *
 * 分片大小经 DataChannel 的 `meta.chunkSize` 告知对端，接收端按 `totalChunks`
 * 判定收齐，因此**换分片大小不影响互通**（与真实应用对传也成立）。
 * `peer.js` 用同一个值，也是因为它踩过同一个限制。
 */
export const WERIFT_SAFE_CHUNK_SIZE = 16 * 1024;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 分片编解码（对照 src/p2p.ts 的 encodeChunk / parseChunk）──────────
export function encodeChunk(index, data) {
  const out = Buffer.alloc(4 + data.length);
  out.writeUInt32BE(index, 0);
  Buffer.from(data).copy(out, 4);
  return out;
}

export function parseChunk(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return { index: b.readUInt32BE(0), data: b.subarray(4) };
}

export function buildMeta({ size, totalChunks, chunkSize, baseChunk = 0, globalChunks = 0 }) {
  const meta = { t: "meta", size, totalChunks, chunkSize };
  // 并行传输才带；单连接/整文件时带上也无害，但为贴近真实实现只在有意义时带
  if (baseChunk) meta.baseChunk = baseChunk;
  if (globalChunks) meta.globalChunks = globalChunks;
  return JSON.stringify(meta);
}

/** 把 werift 的 onmessage 载荷规范成 Buffer 或 string */
function normalizeMessage(msg) {
  const raw = Buffer.isBuffer(msg) ? msg : msg?.data;
  if (raw == null) return null;
  if (typeof raw === "string") return raw;
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
}

/**
 * 一条 P2P 连接（覆盖 4 种 role × sender 组合）。
 *
 * 发送方需要 `chunks`（本连接负责的分片，已按段切好）+ `baseChunk`/`globalChunks`；
 * 接收方在收齐后由 `waitComplete()` resolve 出重组结果。
 */
export class P2PConnection {
  /**
   * @param {{
   *   peerId: string, tag?: string,
   *   role: "offerer" | "answerer",
   *   sender?: "offerer" | "answerer",
   *   signal: (type: string, to: string, payload: object) => void,
   *   chunks?: Buffer[], chunkSize?: number, size?: number,
   *   baseChunk?: number, globalChunks?: number,
   *   timeoutMs?: number, onDiagnose?: (s: string) => void,
   * }} opts
   */
  constructor(opts) {
    this.peerId = opts.peerId;
    this.tag = opts.tag ?? "";
    this.role = opts.role;
    this.sender = opts.sender ?? opts.role;   // 默认：发起方即发送方（src/p2p.ts 同）
    this.signal = opts.signal;
    this.chunks = opts.chunks ?? null;
    this.chunkSize = opts.chunkSize ?? WERIFT_SAFE_CHUNK_SIZE;
    this.size = opts.size ?? 0;
    this.baseChunk = opts.baseChunk ?? 0;
    this.globalChunks = opts.globalChunks ?? 0;
    this.timeoutMs = opts.timeoutMs ?? 20000;
    this.onDiagnose = opts.onDiagnose ?? (() => {});

    this.pc = null;
    this.dc = null;
    this.isSender = this.sender === this.role;
    this.acked = false;
    this.sentBytes = 0;
    this.sendMs = null;
    /** 接收方：按段内 index 存分片 */
    this.recvChunks = [];
    this.meta = null;
    this.done = false;
    this._resolve = null;
    this._reject = null;
    this._result = new Promise((res, rej) => { this._resolve = res; this._reject = rej; });
    // 未收齐时不该有 unhandled rejection
    this._result.catch(() => {});
  }

  _fail(reason) {
    if (this.done) return;
    this.done = true;
    this.close();
    this._reject(new Error(reason));
  }

  /**
   * 成功收尾：**发送方与接收方共用**。
   *
   * ⚠️ 这里踩过一次坑：只让接收路径 resolve `_result`，导致发送方的
   * `waitComplete()` 永远挂着 —— 数据其实传完了，但持有端 `await Promise.all(jobs)`
   * 永不返回，统计与清理代码不执行（表现为"传成功但统计为空"，且 promise 泄漏）。
   * 所以发送成功后也必须 settle。
   */
  _settle(value) {
    if (this.done) return;
    this.done = true;
    this._resolve(value);
  }

  _newPc() {
    const pc = new RTCPeerConnection({ iceServers: DEFAULT_STUN.map((urls) => ({ urls })) });
    this.pc = pc;
    const to = this.peerId;
    pc.onIceCandidate.subscribe((candidate) => {
      if (!candidate) return;
      const c = candidate.candidate ?? candidate;
      this.onDiagnose(`ICE candidate type=${c.type ?? "?"}`);
      this.signal("peer:ice", to, { candidate, tag: this.tag });
    });
    pc.connectionStateChange.subscribe((state) => {
      this.onDiagnose(`connectionState=${state}`);
      if (state === "failed") this._fail(`P2P 连接失败（peer=${to}）`);
      if (state === "closed" && !this.done && !this.acked) this._reject(new Error("连接已关闭"));
    });
    return pc;
  }

  /** 挂上 DataChannel 的消息处理（发送/接收共用） */
  _wireChannel(dc) {
    this.dc = dc;
    dc.onmessage = (msg) => {
      const raw = normalizeMessage(msg);
      if (raw == null) return;
      if (typeof raw === "string") {
        if (this.isSender) {
          if (raw.includes('"t":"ack"')) this.acked = true;
          else if (raw.includes('"t":"hello"')) dc.send(JSON.stringify({ t: "hello-ack", compress: 0 }));
        } else {
          if (raw.includes('"t":"meta"')) {
            this.meta = JSON.parse(raw);
            this.onDiagnose(`meta: size=${this.meta.size} totalChunks=${this.meta.totalChunks}`
              + (this.meta.baseChunk ? ` baseChunk=${this.meta.baseChunk}` : "")
              + (this.meta.globalChunks ? ` globalChunks=${this.meta.globalChunks}` : ""));
          } else if (raw.includes('"t":"hello"')) {
            dc.send(JSON.stringify({ t: "hello-ack", compress: 0 }));
          }
        }
        return;
      }
      if (this.isSender) return;
      const { index, data } = parseChunk(raw);
      this.recvChunks[index] = data;
      const total = this.meta?.totalChunks ?? 0;
      const got = this.recvChunks.filter(Boolean).length;
      if (total && got >= total && !this.done) {
        try { dc.send(JSON.stringify({ t: "ack" })); } catch { /* ignore */ }
        const buf = Buffer.concat(this.recvChunks);
        this._settle({
          buf, chunks: total, bytes: buf.length, meta: this.meta,
          baseChunk: this.meta?.baseChunk ?? 0,
          globalChunks: this.meta?.globalChunks ?? 0,
        });
        setTimeout(() => this.close(), 300);   // 让 ack 先发出去
      }
    };
  }

  _awaitOpen(pc) {
    return new Promise((resolve) => {
      const dc = pc.createDataChannel("p2p", { ordered: true });
      this._wireChannel(dc);
      dc.onopen = () => resolve(true);
      setTimeout(() => resolve(false), this.timeoutMs);
    });
  }

  /** 作为发起方：建 DataChannel → offer → 等 open → 按 sender 决定发还是收 */
  async runAsOfferer() {
    const pc = this._newPc();
    const opened = this._awaitOpen(pc);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signal("peer:offer", this.peerId, { sdp: pc.localDescription, tag: this.tag });
    const ok = await opened;
    if (!ok) { this._fail(`P2P 建连超时（peer=${this.peerId}）`); throw new Error("建连超时"); }
    if (this.isSender) return this._sendAll();
    return this._result;   // 反向：接收方是 offerer
  }

  /** 作为应答方：收到 offer → answer → 按 sender 决定发还是收 */
  async handleOffer(msg) {
    this.peerId = msg.from_user_id;
    const pc = this._newPc();
    // 反向打洞时数据由应答方发出，所以要在 ondatachannel 里挂发送逻辑
    pc.onDataChannel.subscribe((dc) => this._wireChannel(dc));
    await pc.setRemoteDescription(msg.sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.signal("peer:answer", msg.from_user_id, { sdp: pc.localDescription, tag: msg.tag ?? this.tag });
    if (this.isSender) {
      // 等 channel 到达再发（onDataChannel 是异步的）
      const t0 = Date.now();
      while (!this.dc && Date.now() - t0 < this.timeoutMs) await sleep(20);
      if (!this.dc) { this._fail("未收到 DataChannel"); throw new Error("未收到 DataChannel"); }
      return this._sendAll();
    }
    return this._result;
  }

  async _sendAll() {
    const start = Date.now();
    this.dc.send(buildMeta({
      size: this.size, totalChunks: this.chunks.length, chunkSize: this.chunkSize,
      baseChunk: this.baseChunk, globalChunks: this.globalChunks,
    }));
    for (let i = 0; i < this.chunks.length; i++) {
      if (this.dc.readyState !== "open") throw new Error(`通道中断（readyState=${this.dc.readyState}）`);
      this.dc.send(encodeChunk(i, this.chunks[i]));
      this.sentBytes += this.chunks[i].length;
      // 背压：werift 是纯 JS flush，缓冲太大就等
      if (i % 8 === 0) {
        while (this.dc.bufferedAmount > 512 * 1024) await sleep(10);
      }
    }
    this.sendMs = Date.now() - start;
    const t0 = Date.now();
    while (!this.acked && Date.now() - t0 < 15000) await sleep(50);
    const stats = {
      bytes: this.sentBytes, sendMs: this.sendMs,
      speedBps: this.sendMs > 0 ? Math.round((this.sentBytes * 8 * 1000) / this.sendMs) : 0,
      acked: this.acked,
    };
    if (!this.acked) throw new Error("P2P 发送完毕但未收到 ack（对端可能没收齐）");
    // 发送成功也要 settle，否则发送方的 waitComplete() 永远挂着（见 _settle 注释）
    this._settle(stats);
    return stats;
  }

  async handleSignal(msg) {
    if (msg.type === "peer:answer" && msg.sdp && this.pc) {
      await this.pc.setRemoteDescription(msg.sdp).catch((e) => this._fail(`setRemoteDescription 失败: ${e.message}`));
    } else if (msg.type === "peer:ice" && msg.candidate && this.pc) {
      await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
    } else if (msg.type === "peer:bye") {
      this._fail("对端 peer:bye");
    }
  }

  /** 接收方用：等收齐 */
  waitComplete() { return this._result; }

  close() {
    try { this.dc?.close(); } catch { /* ignore */ }
    try { this.pc?.close(); } catch { /* ignore */ }
  }
}
