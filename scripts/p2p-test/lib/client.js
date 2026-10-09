/**
 * 虚拟客户端：在**不启动任何 GUI 客户端**的前提下，扮演一个真实的协议参与者。
 *
 * 它能做真实客户端会做的全部传歌动作：认证 → 连 WS → 建房/进房 → 申请当 DJ →
 * 广播同步状态 → 请求歌曲 / 回传分片 → 收齐校验。
 *
 * 设计要点：
 *   · 事件驱动 + `waitFor`/`find`，便于断言"某消息是否出现"
 *   · 请求-响应类消息（room:create / room:join）自动按 `id` 关联
 *   · `startServing` 是**持续**的：一个 DJ 可以同时给 N 个听众服务
 *   · 默认不打印 base64 正文（否则日志被淹没）
 */
import WebSocket from "ws";
import { ensureUser } from "../auth.js";
import { C2S, S2C, RELAY_CHUNK_SIZE, envelope, chunkFile, assembleChunks, sha256 } from "./protocol.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 日志摘要：base64 正文只保留长度 */
function brief(msg) {
  const o = { ...msg };
  if (typeof o.data_base64 === "string") o.data_base64 = `<${o.data_base64.length}B>`;
  if (Array.isArray(o.members)) o.members = `<${o.members.length} 人>`;
  return JSON.stringify(o).slice(0, 220);
}

export class VirtualClient {
  /**
   * @param {{ label: string, wsBase?: string, verbose?: boolean }} opts
   */
  constructor({ label, wsBase = "wss://api.pomogrow.top", verbose = false }) {
    this.label = label;
    this.wsBase = wsBase;
    this.verbose = verbose;
    this.ws = null;
    this.inbox = [];
    this.handlers = new Map();  // type -> Set<cb>
    this.seq = 0;
    this.pending = new Map();   // request id -> resolve
    this.rooms = new Set();
    /** 正在服务的歌曲：song_id -> { chunks, totalChunks, chunkSize, size, sha256, servedTo:Set } */
    this.serving = new Map();
    this.closed = false;
  }

  log(...a) { if (this.verbose) console.log(`  [${this.label}]`, ...a); }
  warn(...a) { console.warn(`  [${this.label}]`, ...a); }

  // ── 连接与认证 ──────────────────────────────────────────────────────

  async login(username, password) {
    const u = await ensureUser(username, password);
    this.id = u.id;
    this.username = u.username;
    this.token = u.token;
    return u;
  }

  connect(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.wsBase}/ws?token=${this.token}`);
      const timer = setTimeout(() => { ws.terminate(); reject(new Error(`${this.label}: WS 连接超时`)); }, timeoutMs);
      ws.on("open", () => { clearTimeout(timer); this.ws = ws; resolve(); });
      ws.on("error", (e) => { clearTimeout(timer); if (!this.ws) reject(e); else this.warn("WS 错误", e.message); });
      ws.on("close", () => { this.closed = true; this.emit("__closed__", {}); });
      ws.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        // 记录首片到达时刻（用于分段计时：首片延迟 vs 整体窗口）
        if (msg.type === S2C.SONG_CHUNK && this._firstChunkMs == null) this._firstChunkMs = Date.now();
        this.inbox.push(msg);
        this.log("←", brief(msg));
        // 请求-响应：服务器回传同名 id
        if (msg.id && this.pending.has(msg.id)) {
          this.pending.get(msg.id)(msg);
          this.pending.delete(msg.id);
        }
        this.emit(msg.type, msg);
      });
    });
  }

  /** 建立连接并登录（常用组合） */
  static async create(label, creds, opts = {}) {
    const c = new VirtualClient({ label, ...opts });
    await c.login(creds.username, creds.password);
    await c.connect();
    return c;
  }

  // ── 事件 ───────────────────────────────────────────────────────────

  on(type, cb) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(cb);
    return () => this.handlers.get(type)?.delete(cb);
  }

  emit(type, msg) {
    const cbs = this.handlers.get(type);
    if (cbs) for (const cb of cbs) { try { cb(msg); } catch (e) { this.warn("handler 抛错", e.message); } }
  }

  send(type, params = {}) {
    if (!this.ws) throw new Error(`${this.label}: WS 未连接`);
    const text = envelope(type, params);
    this.log("→", brief({ type, ...params }));
    this.ws.send(text);
  }

  /** 发请求并等同 id 的响应（超时返回 null，便于断言失败原因） */
  request(type, params = {}, timeoutMs = 10000) {
    const id = `${this.label}-${++this.seq}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve(null); }, timeoutMs);
      this.pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
      this.send(type, { id, ...params });
    });
  }

  find(type, pred = () => true) { return this.inbox.filter((m) => m.type === type && pred(m)); }
  count(type, pred = () => true) { return this.find(type, pred).length; }

  async waitFor(type, pred = () => true, timeoutMs = 15000) {
    const hit = this.find(type, pred);
    if (hit.length) return hit[0];
    return new Promise((resolve) => {
      const off = this.on(type, (msg) => {
        if (!pred(msg)) return;
        off(); clearTimeout(timer); resolve(msg);
      });
      const timer = setTimeout(() => { off(); resolve(null); }, timeoutMs);
    });
  }

  /**
   * 等某个条件成立（用于"数量达到 N"这类断言，waitFor 只能等第一条）
   * @param {() => boolean} cond
   */
  async waitUntil(cond, timeoutMs = 30000, intervalMs = 150) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (cond()) return true;
      if (this.closed) return false;
      await sleep(intervalMs);
    }
    return false;
  }

  // ── 房间与 DJ ──────────────────────────────────────────────────────

  /** 建房 → 返回 roomId（拿不到就抛，避免后续用 undefined 静默失败） */
  async createRoom(name, { maxMembers = 8, password = "" } = {}) {
    const res = await this.request(C2S.ROOM_CREATE, {
      name, max_members: maxMembers, password, description: "自动测试房间",
    });
    const roomId = res?.room?.id ?? res?.room_id;
    if (!roomId) throw new Error(`${this.label}: room:create 未返回 roomId（响应=${JSON.stringify(res)}）`);
    this.rooms.add(roomId);
    return roomId;
  }

  async joinRoom(roomId, password = "") {
    const res = await this.request(C2S.ROOM_JOIN, { room_id: roomId, password });
    if (!res) throw new Error(`${this.label}: room:join 无响应`);
    this.rooms.add(roomId);
    return res;
  }

  leaveRoom(roomId) { this.send(C2S.ROOM_LEAVE, { room_id: roomId }); this.rooms.delete(roomId); }

  /** 申请成为房间 DJ，并等 dj_changed 确认是自己 */
  async requestDj(timeoutMs = 10000) {
    const waiter = this.waitFor(S2C.DJ_CHANGED, (m) => m.dj_user_id === this.id, timeoutMs);
    this.send(C2S.REQUEST_DJ, {});
    const msg = await waiter;
    if (!msg) throw new Error(`${this.label}: 申请 DJ 后未收到指向自己的 dj_changed`);
    return msg;
  }

  /** 广播同步状态（DJ 权威） */
  broadcastState({ songId, playing = true, positionMs = 0, volume = 80, transferMode = "immediate" }) {
    this.send(C2S.SYNC_STATE, {
      song_id: songId, playing, position_ms: positionMs, volume, transfer_mode: transferMode,
    });
  }

  setTransferMode(mode) { this.send(C2S.SYNC_CONFIG, { transfer_mode: mode }); }

  // ── 持有者（DJ）侧：持续服务任意多个请求者 ───────────────────────────

  /**
   * 注册"服务某首歌"：之后**任何**听众请求它都会自动回传分片。
   * 这是**持续**行为 —— 一个 DJ 要能同时喂 N 个听众（多客户端扇出的关键）。
   *
   * @param {string} songId  歌曲文件名（= playlist 里的名字）
   * @param {string} filePath 本地文件路径
   * @param {{ throttleMs?: number, failOnRequest?: (msg)=>boolean }} opts
   */
  startServing(songId, filePath, opts = {}) {
    const info = chunkFile(filePath, opts.chunkSize ?? RELAY_CHUNK_SIZE);
    const state = { ...info, filePath, servedTo: new Set(), transfers: 0 };
    this.serving.set(songId, state);
    this.log(`开始持有「${songId}」：${info.size} 字节 / ${info.totalChunks} 片，sha256=${info.sha256.slice(0, 12)}…`);

    this.on(S2C.SONG_REQUESTED, async (msg) => {
      if (msg.song_id !== songId) return;
      if (opts.failOnRequest?.(msg)) {
        this.log(`按配置对 ${msg.requester_user_id} 回传 transfer_failed`);
        this.send(C2S.TRANSFER_FAILED, { song_id: songId });
        return;
      }
      state.servedTo.add(msg.requester_user_id);
      state.transfers++;
      this.log(`收到请求（第 ${state.transfers} 次），开始回传 → ${msg.requester_user_id}`);
      await this._streamChunks(songId, state, msg.from_chunk ?? 0, opts.throttleMs ?? 0);
    });
    return state;
  }

  async _streamChunks(songId, state, fromChunk = 0, throttleMs = 0) {
    const sendStart = Date.now();
    for (let i = fromChunk; i < state.totalChunks; i++) {
      if (this.closed) return;
      this.send(C2S.OFFER_SONG, {
        song_id: songId,
        chunk_index: i,
        total_chunks: state.totalChunks,
        chunk_size: state.chunkSize,
        data_base64: state.chunks[i].toString("base64"),
      });
      // 轻微节流：避免瞬间打满 WS 缓冲（真实客户端也有背压）
      if (throttleMs > 0 && i % 8 === 0) await sleep(throttleMs);
    }
    this.send(C2S.TRANSFER_DONE, { song_id: songId });
    // 计时：持有者"发完"耗时。与听众"收完"耗时对比即可定位瓶颈在发送端、
    // 服务器中转、还是接收端 —— 只看总耗时无法区分。
    const sendMs = Date.now() - sendStart;
    state.lastSendMs = sendMs;
    state.lastSentBytes = state.chunks.slice(fromChunk).reduce((n, c) => n + c.length, 0);
    this.log(`「${songId}」回传完毕（共 ${state.totalChunks - fromChunk} 片，发送耗时 ${sendMs}ms，` +
      `${(state.lastSentBytes / (sendMs / 1000) / 1e6).toFixed(2)} MB/s）`);
  }

  // ── 请求者（听众）侧 ───────────────────────────────────────────────

  /**
   * 请求一首歌并收齐校验。
   * @param {string} songId
   * @param {{ fromChunk?: number, timeoutMs?: number, expectedSha256?: string,
   *           expectedSize?: number, p2p?: boolean, onProgress?: (n:number)=>void }} opts
   */
  async fetchSong(songId, opts = {}) {
    const fromChunk = opts.fromChunk ?? 0;
    const timeoutMs = opts.timeoutMs ?? 60000;
    // 先记录请求前的基准，避免把历史分片算进来
    const base = this.count(S2C.SONG_CHUNK, (m) => m.song_id === songId);

    this._firstChunkMs = null;
    const requestAt = Date.now();
    this.send(C2S.REQUEST_SONG, {
      song_id: songId,
      ...(fromChunk > 0 ? { from_chunk: fromChunk } : {}),
      ...(opts.p2p ? { p2p: true } : {}),
    });

    // 等 transfer_done 或超时
    const done = await this.waitFor(S2C.TRANSFER_DONE, (m) => m.song_id === songId, timeoutMs);
    const doneAt = Date.now();
    const all = this.find(S2C.SONG_CHUNK, (m) => m.song_id === songId);
    const chunks = all.slice(base);
    const expectedTotal = chunks[0]?.total_chunks ?? all[0]?.total_chunks ?? 0;

    if (opts.onProgress) opts.onProgress(chunks.length);

    // 分段时间：首片延迟（网络+服务器处理）与整体接收窗口
    const timing = {
      firstChunkMs: this._firstChunkMs != null ? this._firstChunkMs - requestAt : null,
      totalMs: doneAt - requestAt,
    };

    // 断点续传场景：只收到后半段，需要外部提供前半段才能整体校验
    if (fromChunk > 0) {
      return {
        ok: !!done && chunks.length === expectedTotal - fromChunk,
        chunks: chunks.length, expectedTotal, fromChunk,
        gotDone: !!done, timing,
        sha256: null, bytes: chunks.reduce((n, c) => n + Buffer.from(c.data_base64, "base64").length, 0),
      };
    }

    if (!expectedTotal || chunks.length !== expectedTotal) {
      return { ok: false, reason: `分片不全：${chunks.length}/${expectedTotal || "?"}`, chunks: chunks.length, expectedTotal, gotDone: !!done, timing };
    }
    const buf = assembleChunks(chunks, expectedTotal, opts.expectedSize ?? null);
    const gotSha = sha256(buf);
    const ok = opts.expectedSha256 ? gotSha === opts.expectedSha256 : true;
    return {
      ok: ok && !!done,
      chunks: chunks.length, expectedTotal, bytes: buf.length, sha256: gotSha, gotDone: !!done, timing,
      reason: ok ? null : `sha256 不符：${gotSha.slice(0, 12)}… ≠ ${opts.expectedSha256?.slice(0, 12)}…`,
    };
  }

  close() {
    try { this.ws?.close(); } catch { /* ignore */ }
  }
}

export { sleep };
