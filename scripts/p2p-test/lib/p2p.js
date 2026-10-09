/**
 * P2P（WebRTC DataChannel）虚拟端 —— 让虚拟客户端也能走**直连**那条路。
 *
 * 线协议**逐条对照 `src/p2p.ts`**（权威），不是自造：
 *   · 控制消息（字符串 JSON）：`{"t":"meta","size":N,"totalChunks":M,"chunkSize":K}`
 *   · 数据消息（二进制）：4 字节大端 chunk_index + chunk 原始字节
 *   · 压缩协商：`{"t":"hello","v":2}` → `{"t":"hello-ack","compress":0|1}`
 *     协商成功时 meta 带 `compress:1`，数据帧多 1 字节压缩标志
 *   · 收齐回执：接收端发 `{"t":"ack"}`
 *   · 信令：`peer:offer{sdp,tag}` / `peer:answer{sdp,tag}` / `peer:ice{candidate,tag}`
 *   · 角色：**持有者是 offerer + 发送方**（DataChannel 全双工，反向传输才用 sender 解耦）
 *
 * ⚠️ 本实现只做**不压缩**（向后兼容路径，也是旧对端走的路）：
 *   · 作发送方：不发 hello → 对端按旧格式收（真实 App 兼容）
 *   · 作接收方：收到 hello 就回 `hello-ack{compress:0}` 婉拒 → 对端改发原片
 *   压缩路径（deflate-raw）未覆盖，见 README 已知限制。
 *
 * Node 侧用 `werift`（纯 JS WebRTC，已有的依赖），与 `peer.js` 同一套用法。
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

export function buildMeta({ size, totalChunks, chunkSize }) {
  return JSON.stringify({ t: "meta", size, totalChunks, chunkSize });
}

/** 把 werift 的 onmessage 载荷规范成 Buffer 或 string */
function normalizeMessage(msg) {
  const raw = Buffer.isBuffer(msg) ? msg : msg?.data;
  if (raw == null) return null;
  if (typeof raw === "string") return raw;
  return Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
}

/**
 * 发送方（持有者/DJ 侧）：作 offerer 发起，推 meta + 分片，等 ack。
 *
 * 时序对照 src/p2p.ts：先建 DataChannel 再 createOffer（channel 才会进 SDP），
 * 然后 trickle ICE；answer 到达后 setRemoteDescription。
 */
export class P2PSender {
  /**
   * @param {{ peerId: string, tag?: string, chunks: Buffer[], chunkSize: number, size: number,
   *           signal: (type:string, to:string, payload:object)=>void,
   *           timeoutMs?: number, onDiagnose?: (s:string)=>void }} opts
   */
  constructor(opts) {
    this.peerId = opts.peerId;
    this.tag = opts.tag ?? "";
    this.chunks = opts.chunks;
    this.chunkSize = opts.chunkSize;
    this.size = opts.size;
    this.signal = opts.signal;
    this.timeoutMs = opts.timeoutMs ?? 20000;
    this.onDiagnose = opts.onDiagnose ?? (() => {});
    this.pc = null;
    this.dc = null;
    this.acked = false;
    this.sentBytes = 0;
    this.sendStartMs = null;
  }

  /** 建立连接并传完；resolve 出统计（resolve 前已收到 ack） */
  async run() {
    const pc = new RTCPeerConnection({ iceServers: DEFAULT_STUN.map((urls) => ({ urls })) });
    this.pc = pc;

    pc.onIceCandidate.subscribe((candidate) => {
      if (!candidate) return;
      const c = candidate.candidate ?? candidate;
      this.onDiagnose(`ICE candidate type=${c.type ?? "?"}`);
      this.signal("peer:ice", this.peerId, { candidate, tag: this.tag });
    });

    let opened = false;
    const openedPromise = new Promise((resolve) => {
      pc.connectionStateChange.subscribe((state) => {
        this.onDiagnose(`connectionState=${state}`);
        if (state === "failed" || state === "closed") resolve(false);
      });
      const dc = pc.createDataChannel("p2p", { ordered: true });
      this.dc = dc;
      dc.onopen = () => { opened = true; resolve(true); };
      dc.onmessage = (msg) => {
        const raw = normalizeMessage(msg);
        if (typeof raw !== "string") return;
        if (raw.includes('"t":"ack"')) this.acked = true;
        // 压缩协商：婉拒，让对端发原片（我们只实现不压缩路径）
        else if (raw.includes('"t":"hello"')) dc.send(JSON.stringify({ t: "hello-ack", compress: 0 }));
      };
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.signal("peer:offer", this.peerId, { sdp: pc.localDescription, tag: this.tag });

    const ok = await Promise.race([openedPromise, sleep(this.timeoutMs).then(() => false)]);
    if (!ok) { this.close(); throw new Error(`P2P 建连超时（peer=${this.peerId}）`); }

    // ── 推数据
    this.sendStartMs = Date.now();
    this.dc.send(buildMeta({ size: this.size, totalChunks: this.chunks.length, chunkSize: this.chunkSize }));
    for (let i = 0; i < this.chunks.length; i++) {
      if (this.dc.readyState !== "open") throw new Error(`通道中断（readyState=${this.dc.readyState}）`);
      this.dc.send(encodeChunk(i, this.chunks[i]));
      this.sentBytes += this.chunks[i].length;
      // 背压：werift 是纯 JS flush，缓冲太大就等
      if (i % 8 === 0) {
        while (this.dc.bufferedAmount > 512 * 1024) await sleep(10);
      }
    }
    const sendMs = Date.now() - this.sendStartMs;

    // 等 ack（对端收齐才发），最多 15s
    const t0 = Date.now();
    while (!this.acked && Date.now() - t0 < 15000) await sleep(50);
    const stats = {
      bytes: this.sentBytes, sendMs,
      speedBps: sendMs > 0 ? Math.round((this.sentBytes * 8 * 1000) / sendMs) : 0,
      acked: this.acked,
    };
    this.close();
    if (!this.acked) throw new Error("P2P 发送完毕但未收到 ack（对端可能没收齐）");
    return stats;
  }

  /** 喂入信令 */
  async handleSignal(msg) {
    if (msg.type === "peer:answer" && msg.sdp) {
      await this.pc.setRemoteDescription(msg.sdp);
    } else if (msg.type === "peer:ice" && msg.candidate) {
      await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
    } else if (msg.type === "peer:bye") {
      this.close();
    }
  }

  close() { try { this.dc?.close(); } catch { /* ignore */ } try { this.pc?.close(); } catch { /* ignore */ } }
}

/**
 * 接收方（听众侧）：等 offer → 应答 → 在 ondatachannel 上收分片。
 * 收齐后回 `{t:"ack"}`（与 src/p2p.ts 一致）。
 */
export class P2PReceiver {
  constructor(opts = {}) {
    this.signal = opts.signal;
    this.timeoutMs = opts.timeoutMs ?? 30000;
    this.onDiagnose = opts.onDiagnose ?? (() => {});
    this.pc = null;
    this.chunks = [];
    this.totalChunks = 0;
    this.meta = null;
    this.done = false;
    this.ackedSent = false;
    this._resolve = null;
    this._reject = null;
    this._promise = new Promise((res, rej) => { this._resolve = res; this._reject = rej; });
    this._timer = setTimeout(() => { if (!this.done) this._fail(`P2P 接收超时（${this.timeoutMs}ms）`); }, this.timeoutMs);
  }

  _fail(reason) {
    if (this.done) return;
    this.done = true;
    clearTimeout(this._timer);
    this.close();
    this._reject(new Error(reason));
  }

  /** 收到 peer:offer → 建应答连接 */
  async handleOffer(msg) {
    const fromUserId = msg.from_user_id;
    const tag = msg.tag ?? "";
    const pc = new RTCPeerConnection({ iceServers: DEFAULT_STUN.map((urls) => ({ urls })) });
    this.pc = pc;
    pc.onIceCandidate.subscribe((candidate) => {
      if (!candidate) return;
      const c = candidate.candidate ?? candidate;
      this.onDiagnose(`ICE candidate type=${c.type ?? "?"}`);
      this.signal("peer:ice", fromUserId, { candidate, tag });
    });
    pc.onDataChannel.subscribe((dc) => {
      dc.onmessage = (raw0) => this._onMessage(dc, normalizeMessage(raw0));
    });
    pc.connectionStateChange.subscribe((state) => {
      this.onDiagnose(`connectionState=${state}`);
      if (state === "failed") this._fail("P2P 连接失败");
    });

    await pc.setRemoteDescription(msg.sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.signal("peer:answer", fromUserId, { sdp: pc.localDescription, tag });
    this.fromUserId = fromUserId;
  }

  _onMessage(dc, raw) {
    if (raw == null) return;
    if (typeof raw === "string") {
      if (raw.includes('"t":"meta"')) {
        this.meta = JSON.parse(raw);
        this.totalChunks = this.meta.totalChunks;
        this.onDiagnose(`meta: size=${this.meta.size} totalChunks=${this.totalChunks}`);
      } else if (raw.includes('"t":"hello"')) {
        dc.send(JSON.stringify({ t: "hello-ack", compress: 0 }));
      }
      return;
    }
    // 二进制分片
    const { index, data } = parseChunk(raw);
    this.chunks[index] = data;
    this.receivedBytes = (this.receivedBytes ?? 0) + data.length;
    if (this.totalChunks && this.chunks.filter(Boolean).length >= this.totalChunks && !this.ackedSent) {
      this.ackedSent = true;
      this.done = true;
      clearTimeout(this._timer);
      try { dc.send(JSON.stringify({ t: "ack" })); } catch { /* ignore */ }
      const buf = Buffer.concat(this.chunks);
      this._resolve({ buf, chunks: this.totalChunks, bytes: buf.length, meta: this.meta });
      // 稍等 ack 发出再关，避免发送端收不到
      setTimeout(() => this.close(), 300);
    }
  }

  async handleSignal(msg) {
    if (msg.type === "peer:ice" && msg.candidate && this.pc) {
      await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
    } else if (msg.type === "peer:bye") {
      this._fail("对端 peer:bye");
    }
  }

  wait() { return this._promise; }
  close() { try { this.pc?.close(); } catch { /* ignore */ } }
}
