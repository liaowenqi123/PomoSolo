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
import { P2PConnection, WERIFT_SAFE_CHUNK_SIZE } from "./p2p.js";

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
    /** 活跃的 P2P 连接（正向/反向、发送/接收统一管理）：按 peerId+tag 路由信令 */
    this._p2p = [];
    /** 最近一次 P2P 结果（场景断言用） */
    this.p2pStats = null;
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
        // P2P 信令：路由给活跃的发送方/接收方（对照 src/p2p.ts 的 handlePeerSignal）
        if (typeof msg.type === "string" && msg.type.startsWith("peer:")) {
          void this._routeP2PSignal(msg);
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

  // ── P2P：信令路由 + 直传/接收（含反向打洞）──────────────────────────

  /**
   * 把 peer:* 信令分发给活跃的 P2P 连接。
   * 对照 src/p2p.ts 的 handlePeerSignal：offer 建应答连接、answer/ice 路由到活跃连接。
   * 反向打洞会有多条并行连接（tag p0..pK-1），所以按 from + tag 精确路由。
   */
  async _routeP2PSignal(msg) {
    const from = msg.from_user_id;
    const tag = msg.tag ?? "";
    if (msg.type === "peer:offer") {
      /*
       * 找一个在等这条 offer 的应答方。优先精确匹配 tag（并行反向打洞各段用不同 tag），
       * 匹配不到再退化为"任意未建连的应答方"（单连接场景不带 tag）。
       */
      const waiting = this._p2p.filter((c) => c.role === "answerer" && !c.pc);
      const conn = waiting.find((c) => (c.tag ?? "") === tag) ?? waiting[0];
      if (!conn) { this.log(`收到 peer:offer（from=${from} tag=${tag}）但没有等待中的应答方，忽略`); return; }
      try { await conn.handleOffer(msg); } catch (e) { this.warn("应答 peer:offer 失败", e.message); }
      return;
    }
    for (const c of this._p2p) {
      const sameTag = (c.tag ?? "") === tag;
      // ICE 可能带空 tag 到达（旧对端）；peer:answer 必须 tag 对上，否则并行连接会串
      if (msg.type === "peer:ice" ? (sameTag || !tag) : sameTag) {
        if (c.peerId === from || c.peerId == null) await c.handleSignal(msg).catch(() => {});
      }
    }
  }

  /** 注册一条连接（统一管理，便于关闭与路由） */
  _registerP2P(conn) { this._p2p.push(conn); return conn; }
  _unregisterP2P(conn) { this._p2p = this._p2p.filter((c) => c !== conn); }

  /** 持有者侧（正常方向）：作 offerer + sender，把整首歌直传给某个请求者 */
  async _serveViaP2P(songId, state, requesterId, tag = "") {
    const conn = this._registerP2P(new P2PConnection({
      peerId: requesterId,
      tag,
      role: "offerer",
      sender: "offerer",
      // P2P 用更小的分片（werift 消息上限 64KB），不是中转用的 128KB
      chunks: state.p2pInfo.chunks,
      chunkSize: state.p2pInfo.chunkSize,
      size: state.size,
      signal: (type, to, payload) => this.send(type, { to_user_id: to, ...payload }),
      onDiagnose: (s) => this.log(`[p2p 发送] ${s}`),
    }));
    try {
      const stats = await conn.runAsOfferer();
      state.p2pTransfers = (state.p2pTransfers ?? 0) + 1;
      state.lastP2PStats = stats;
      this.p2pStats = stats;
      this.log(`P2P 直传完成：${stats.bytes} 字节 / ${stats.sendMs}ms / ${(stats.speedBps / 1e6).toFixed(2)} Mbps`);
      return stats;
    } finally {
      this._unregisterP2P(conn);
    }
  }

  /** 听众侧（正常方向）：作 answerer 接收一次 P2P 传输 */
  prepareP2PReceive(timeoutMs = 30000) {
    const conn = this._registerP2P(new P2PConnection({
      peerId: null,            // 由 handleOffer 填入
      role: "answerer",
      /*
       * ★ `sender` 是「数据发送方在协商中的**角色**」，不是"本端角色"。
       * 正常传歌时 DJ 是 offerer 且由 DJ 发数据 → 本端（answerer）写 sender:"offerer"，
       * 表示"发送方是 offerer、不是我"。
       * 写成 "answerer" 会让本端误以为自己要发数据（踩过：数据传完了却收不到 ack）。
       */
      sender: "offerer",
      signal: (type, to, payload) => this.send(type, { to_user_id: to, ...payload }),
      timeoutMs,
      onDiagnose: (s) => this.log(`[p2p 接收] ${s}`),
    }));
    // 超时保护：迟迟没有 offer → 明确失败，否则调用方会一直挂着
    setTimeout(() => { if (!conn.pc) conn._fail(`等待 peer:offer 超时（${timeoutMs}ms）`); }, timeoutMs);
    return conn;
  }

  // ── 反向打洞（reverse）：正常方向打不通时的兜底 ────────────────────

  /**
   * 持有者侧：挂起接收"下载端主导的"反向连接，并在**收到的** channel 上发数据。
   *
   * 对照 src/stores/music.ts 的持有端 reverse 分支 + src/p2p.ts 的
   * `role:"answerer", sender:"answerer"`：DataChannel 全双工，谁持有数据谁 send。
   *
   * 多连接并行（v4.7.7）：下载端声明 parallel=K → 本端按**段**切分文件，
   * 第 k 段挂在 tag `p{k}` 上，并在 meta 里声明 baseChunk / globalChunks，
   * 让接收端能把段内局部 index 映射回全局序号（否则会合并出残缺文件）。
   *
   * @param {string} songId
   * @param {object} state startServing 返回的持有状态
   * @param {number} parallel 下载端声明的连接数（1..4）
   */
  async _serveReverse(songId, state, parallel) {
    const K = Math.min(Math.max(parallel, 1), 4);
    const total = state.p2pInfo.totalChunks;
    const per = Math.ceil(total / K);           // 每段分片数
    const conns = [];
    const jobs = [];
    for (let k = 0; k < K; k++) {
      const base = k * per;
      const seg = state.p2pInfo.chunks.slice(base, base + per);
      if (seg.length === 0) continue;
      const conn = this._registerP2P(new P2PConnection({
        peerId: null,               // 由 handleOffer 填入
        tag: K > 1 ? `p${k}` : "",
        role: "answerer",
        sender: "answerer",         // reverse：应答方（本端）发数据
        chunks: seg,
        chunkSize: state.p2pInfo.chunkSize,
        size: state.size,
        baseChunk: K > 1 ? base : 0,          // 段内局部 index → 全局偏移
        globalChunks: K > 1 ? total : 0,      // 全局片数（防段间 meta 时序差异导致提前合并）
        signal: (type, to, payload) => this.send(type, { to_user_id: to, ...payload }),
        onDiagnose: (s) => this.log(`[p2p reverse 发送 p${k}] ${s}`),
      }));
      // 超时保护：下载端可能最终没打通 → 明确失败而不是永久挂着
      setTimeout(() => { if (!conn.pc) conn._fail(`等待反向 peer:offer 超时（p${k}）`); }, 30000);
      conns.push(conn);
      jobs.push(
        conn.waitComplete()
          .then((stats) => ({ ok: true, k, stats }))
          .catch((e) => ({ ok: false, k, error: e.message })),
      );
    }
    this.log(`挂起反向传输：${conns.length} 条连接，每段 ${per} 片，全局 ${total} 片`);
    const results = await Promise.all(jobs);
    for (const c of conns) this._unregisterP2P(c);
    const ok = results.filter((r) => r.ok);
    state.reverseTransfers = (state.reverseTransfers ?? 0) + 1;
    state.lastReverseSegments = results.length;
    state.lastReverseOkSegments = ok.length;
    // 记录本端**实际**收到的 parallel 值 —— 用于验证服务器是否透传该字段
    state.lastReverseParallel = K;
    this.log(`反向传输结束：${ok.length}/${results.length} 段成功`);
    if (ok.length === 0) throw new Error(`反向打洞全部失败：${results.map((r) => r.error).join("; ")}`);
    return { segments: results.length, okSegments: ok.length };
  }

  /**
   * 听众侧：主动发起反向打洞并收齐（正常方向失败后的兜底）。
   *
   * 顺序对照 src/stores/music.ts 的 tryReverseReceive：
   *   ① 先发 p2p:reverse_transfer_request 通知 DJ 挂起（带 parallel）
   *   ② 本端作 **offerer**（sender:"answerer"）建 K 条并行连接（tag p0..pK-1）
   *   ③ 按段收片 → 按 baseChunk 映射回全局 index 组装
   */
  async fetchSongReverse(songId, opts = {}) {
    const K = Math.min(Math.max(opts.parallel ?? 2, 1), 4);
    const timeoutMs = opts.timeoutMs ?? 90000;
    if (!opts.peerId) throw new Error("fetchSongReverse 需要 opts.peerId（DJ 的 user_id）");
    const requestAt = Date.now();

    // ① 通知 DJ 挂起反向传输
    this.send("p2p:reverse_transfer_request", {
      to_user_id: opts.peerId,
      song_id: songId,
      ...(K > 1 ? { parallel: K } : {}),
    });
    await sleep(500);   // 给 DJ 一点时间挂上接收端，否则首条 offer 会落空

    // ② 建 K 条 offerer 连接（本端只收，不 send）
    const conns = [];
    for (let k = 0; k < K; k++) {
      const tag = K > 1 ? `p${k}` : "";
      const conn = this._registerP2P(new P2PConnection({
        peerId: opts.peerId,
        tag,
        role: "offerer",
        sender: "answerer",   // ★ reverse：发起方不 send，由 answerer（DJ）发数据
        signal: (type, to, payload) => this.send(type, { to_user_id: to, ...payload }),
        timeoutMs: 15000,
        onDiagnose: (s) => this.log(`[p2p reverse 接收 p${k}] ${s}`),
      }));
      conns.push(conn);
    }

    // ③ 并发发起 + 收齐
    const results = await Promise.all(conns.map(async (conn, k) => {
      try {
        const payload = await conn.runAsOfferer();
        return { ok: true, k, payload };
      } catch (e) {
        return { ok: false, k, error: e.message };
      } finally {
        this._unregisterP2P(conn);
      }
    }));

    const okRes = results.filter((r) => r.ok);
    const bytes = okRes.reduce((n, r) => n + r.payload.bytes, 0);
    const totalMs = Date.now() - requestAt;

    /*
     * 按段组装成完整文件：
     * 每段的全局起点 = meta.baseChunk（单连接时为 0），段内 index 是局部的。
     * 这与 src/stores/music.ts 的 `globalIndex = baseChunk + index` 一致。
     */
    let buf = null;
    let globalChunks = 0;
    if (okRes.length > 0) {
      for (const r of okRes) {
        const g = r.payload.globalChunks || 0;
        globalChunks = Math.max(globalChunks, g, (r.payload.baseChunk || 0) + r.payload.chunks);
      }
      const expectedSize = opts.expectedSize ?? null;
      /*
       * 按「片」重组：每段的 buf 是段内连续分片拼起来的，要按 chunkSize 切回片，
       * 再用 baseChunk 放回全局位置。这与接收端 music.ts 的
       * `globalIndex = (baseChunk ?? 0) + index` 是同一套映射。
       */
      const chunkSize = okRes[0].payload.meta.chunkSize;
      const assembled = new Array(globalChunks);
      for (const r of okRes) {
        const base = r.payload.baseChunk || 0;
        for (let i = 0; i < r.payload.chunks; i++) {
          assembled[base + i] = r.payload.buf.subarray(i * chunkSize, (i + 1) * chunkSize);
        }
      }
      const missing = assembled.filter((x) => !x).length;
      if (missing === 0) {
        buf = Buffer.concat(assembled);
        if (expectedSize != null && buf.length !== expectedSize) {
          return { ok: false, path: "p2p-reverse", reasons: results.filter((r) => !r.ok).map((r) => r.error), bytes,
            reason: `反向后总长度不符：${buf.length} ≠ ${expectedSize}` };
        }
      } else {
        return { ok: false, path: "p2p-reverse", bytes, reason: `反向后仍缺 ${missing} 片（共 ${globalChunks}）`,
          okSegments: okRes.length, totalSegments: K, reasons: results.filter((r) => !r.ok).map((r) => r.error) };
      }
    }

    if (!buf) {
      return { ok: false, path: "p2p-reverse", bytes, reason: "反向打洞未收到任何段",
        okSegments: 0, totalSegments: K, reasons: results.filter((r) => !r.ok).map((r) => r.error) };
    }
    const gotSha = sha256(buf);
    const ok = opts.expectedSha256 ? gotSha === opts.expectedSha256 : true;
    return {
      ok, path: "p2p-reverse", viaP2P: true, reverse: true,
      chunks: globalChunks, expectedTotal: globalChunks, bytes: buf.length, sha256: gotSha,
      okSegments: okRes.length, totalSegments: K,
      timing: { totalMs, firstChunkMs: null },
      reason: ok ? null : `sha256 不符：${gotSha.slice(0, 12)}… ≠ ${opts.expectedSha256?.slice(0, 12)}…`,
    };
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
   * @param {{ throttleMs?: number, failOnRequest?: (msg)=>boolean,
   *           p2p?: boolean, p2pChunkSize?: number, djBroadcast?: boolean }} opts
   */
  startServing(songId, filePath, opts = {}) {
    const info = chunkFile(filePath, opts.chunkSize ?? RELAY_CHUNK_SIZE);
    /*
     * P2P 单独用一套更小的分片：werift 单条 DataChannel 消息上限 64KB 且不会自动分片
     * （浏览器会自动分片，所以生产端 128KB 没问题）。分片大小经 meta 告知对端，
     * 因此换大小不影响互通 —— 与真实应用对传也成立。
     */
    const p2pChunkSize = opts.p2pChunkSize ?? WERIFT_SAFE_CHUNK_SIZE;
    const p2pInfo = p2pChunkSize === info.chunkSize ? info : chunkFile(filePath, p2pChunkSize);
    const state = { ...info, filePath, p2pInfo, servedTo: new Set(), transfers: 0, p2pTransfers: 0 };
    this.serving.set(songId, state);
    this.log(`开始持有「${songId}」：${info.size} 字节；中转 ${info.totalChunks} 片(128KB) / ` +
      `P2P ${p2pInfo.totalChunks} 片(${p2pChunkSize / 1024}KB)，sha256=${info.sha256.slice(0, 12)}…`);
    /** 并发守卫：与真实持有端一致（music.ts 的 activeTransfers），按「歌+请求者」去重 */
    const activeTransfers = new Set();

    this.on(S2C.SONG_REQUESTED, async (msg) => {
      if (msg.song_id !== songId) return;
      if (opts.failOnRequest?.(msg)) {
        this.log(`按配置对 ${msg.requester_user_id} 回传 transfer_failed`);
        this.send(C2S.TRANSFER_FAILED, { song_id: songId });
        return;
      }
      const requester = msg.requester_user_id;
      const transferKey = `${songId}|${requester}`;
      if (activeTransfers.has(transferKey)) return;   // 同一请求者重复请求只开一个循环
      activeTransfers.add(transferKey);

      /*
       * 传歌期间每 5s 广播一次 sync_state —— 与真实持有端一致（music.ts:1182）。
       * 不做这件事会引发真实出现过的 bug：听众下载可能耗时很久，期间位置不再更新，
       * 下载完 seek 回的是**下载开始时**的旧位置，表现为"下载完从头播放"。
       * 只有 opts.djBroadcast 打开时才做（场景自己决定是否模拟 DJ 播放）。
       */
      const progressSync = opts.djBroadcast
        ? setInterval(() => void this._broadcastCurrentState(), 5000)
        : null;

      try {
        state.servedTo.add(requester);
        state.transfers++;

        /*
         * 路径选择 —— 逐条对齐 music.ts:1185-1192：
         *   `if (evt.p2p && requesterId && fromChunk === 0)` → 先试 P2P 直传（媒体不经服务器）；
         *   失败（建连超时/读片失败）自动回退服务器中转。
         * 注意门控用的是**服务器透传过来的** p2p 字段，不是请求者本地意愿。
         */
        const fromChunk = Number(msg.from_chunk ?? 0);
        const wantsP2P = msg.p2p === true && opts.p2p !== false && fromChunk === 0;
        state.lastRequestedP2P = msg.p2p;
        if (wantsP2P) {
          this.log(`收到请求（第 ${state.transfers} 次，带 p2p 标志），尝试 P2P 直传 → ${requester}`);
          try {
            await this._serveViaP2P(songId, state, requester, msg.tag ?? "");
            return;
          } catch (e) {
            this.warn(`P2P 失败（${e.message}），回退服务器中转`);
            state.p2pFailures = (state.p2pFailures ?? 0) + 1;
          }
        } else {
          const why = msg.p2p !== true
            ? (msg.p2p === undefined ? "，服务器未透传 p2p 字段" : "，请求方未请求 P2P")
            : "，续传（from_chunk>0）不走 P2P";
          this.log(`收到请求（第 ${state.transfers} 次${why}），走服务器中转`);
        }
        await this._streamChunks(songId, state, fromChunk, opts.throttleMs ?? 0);
      } finally {
        if (progressSync) clearInterval(progressSync);
        activeTransfers.delete(transferKey);
      }
    });

    /*
     * 反向打洞（reverse）：持有端挂起，等下载端主导打洞。
     *
     * 对照 src/stores/music.ts 的持有端 reverse 分支 + EXTERNAL-INTERFACES.md §6：
     * 正常方向（持有端作 offerer）建连失败时，下载端发
     * `p2p:reverse_transfer_request { to_user_id, song_id?, parallel? }`，
     * 服务器定向转发给持有端 → 持有端挂起 answerer+sender，
     * 在**收到的** channel 上发数据（DataChannel 全双工）。
     *
     * 默认开启（真实持有端总是支持），可用 `opts.reverse === false` 关掉。
     */
    if (opts.reverse !== false) {
      this.on("p2p:reverse_transfer_request", async (msg) => {
        if (msg.song_id && msg.song_id !== songId) return;
        const parallel = Number(msg.parallel ?? 1);
        state.reverseRequests = (state.reverseRequests ?? 0) + 1;
        this.log(`收到反向打洞请求（from=${msg.from_user_id} parallel=${parallel}）→ 挂起 answerer+sender`);
        try {
          await this._serveReverse(songId, state, parallel);
        } catch (e) {
          this.warn(`反向传输失败：${e.message}`);
        }
      });
    }
    return state;
  }

  // ── DJ 侧：模拟播放时钟（供 full-chain 场景验证"下载完重对齐"）────────

  /** 开始"播放"：记录虚拟播放时钟，并广播一次状态 */
  startDjPlayback(songId, { positionMs = 0, playing = true, volume = 80 } = {}) {
    this._playback = { songId, startedAt: Date.now(), basePositionMs: positionMs, playing, volume };
    this.broadcastState({ songId, playing, positionMs: this._currentPositionMs(), volume });
    /*
     * 服务器收到听众的 music:request_state 时会向 DJ 单发 music:state_request，
     * DJ 收到后应**立即广播一次实时 sync_state**（protocol 文档 §395-396）。
     * 挂上这个处理既模拟真实 DJ，又顺带验证了服务器这条转达链路是否真的通。
     */
    this.on(S2C.STATE_REQUEST, () => {
      this.log("收到 music:state_request（服务器转达听众要状态）→ 立即广播实时 state");
      this.stateRequestCount = (this.stateRequestCount ?? 0) + 1;
      void this._broadcastCurrentState();
    });
  }

  _currentPositionMs() {
    const p = this._playback;
    if (!p) return 0;
    return p.playing ? p.basePositionMs + (Date.now() - p.startedAt) : p.basePositionMs;
  }

  _broadcastCurrentState() {
    const p = this._playback;
    if (!p) return;
    this.broadcastState({
      songId: p.songId, playing: p.playing,
      positionMs: this._currentPositionMs(), volume: p.volume,
    });
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

    /*
     * P2P 优先 + 自动回退中转 —— 与真实客户端一致的行为。
     *
     * 真实链路（src/stores/music.ts）：请求带 p2p=true → 服务器挑持有者 →
     * 持有者优先 P2P 直传，失败自动回退服务器中转（music:offer_song 分片）。
     * 所以这里同时挂上"接收 P2P"和"等中转 transfer_done"两条路，谁先成就用谁；
     * 只测 P2P 而不测回退，就漏掉了最关键的降级路径。
     */
    let rx = null;
    if (opts.p2p && fromChunk === 0) rx = this.prepareP2PReceive(timeoutMs);

    this.send(C2S.REQUEST_SONG, {
      song_id: songId,
      ...(fromChunk > 0 ? { from_chunk: fromChunk } : {}),
      ...(opts.p2p ? { p2p: true } : {}),
    });

    const relayPromise = this.waitFor(S2C.TRANSFER_DONE, (m) => m.song_id === songId, timeoutMs);

    let usedPath = "relay";
    let p2pBuf = null;
    let p2pError = null;
    let p2pMs = null;
    let done = null;

    if (rx) {
      const p2pStart = Date.now();
      const outcome = await Promise.race([
        rx.waitComplete().then((b) => ({ src: "p2p", buf: b })).catch((e) => ({ src: "p2p-failed", error: e.message })),
        relayPromise.then((d) => ({ src: "relay", done: d })),
      ]);
      if (outcome.src === "p2p") {
        usedPath = "p2p";
        p2pBuf = outcome.buf;
        p2pMs = Date.now() - p2pStart;
      } else if (outcome.src === "p2p-failed") {
        // P2P 失败 → 持有者会回退中转，继续等中转完成
        p2pError = outcome.error;
        usedPath = "relay-fallback";
        done = await relayPromise;
      } else {
        usedPath = "relay";
        done = outcome.done;
      }
    } else {
      done = await relayPromise;
    }

    // P2P 成功：直接用它重组（不经过服务器中转）
    if (usedPath === "p2p" && p2pBuf) {
      const gotSha = sha256(p2pBuf.buf);
      const ok = opts.expectedSha256 ? gotSha === opts.expectedSha256 : true;
      return {
        ok, path: "p2p", viaP2P: true,
        chunks: p2pBuf.chunks, expectedTotal: p2pBuf.chunks, bytes: p2pBuf.buf.length, sha256: gotSha,
        timing: { totalMs: p2pMs, firstChunkMs: null },
        reason: ok ? null : `sha256 不符：${gotSha.slice(0, 12)}… ≠ ${opts.expectedSha256?.slice(0, 12)}…`,
      };
    }

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
        path: usedPath, viaP2P: false, p2pError,
        chunks: chunks.length, expectedTotal, fromChunk,
        gotDone: !!done, timing,
        sha256: null, bytes: chunks.reduce((n, c) => n + Buffer.from(c.data_base64, "base64").length, 0),
      };
    }

    if (!expectedTotal || chunks.length !== expectedTotal) {
      return {
        ok: false, path: usedPath, viaP2P: false, p2pError,
        reason: `分片不全：${chunks.length}/${expectedTotal || "?"}${p2pError ? `（P2P 也曾失败：${p2pError}）` : ""}`,
        chunks: chunks.length, expectedTotal, gotDone: !!done, timing,
      };
    }
    const buf = assembleChunks(chunks, expectedTotal, opts.expectedSize ?? null);
    const gotSha = sha256(buf);
    const ok = opts.expectedSha256 ? gotSha === opts.expectedSha256 : true;
    return {
      ok: ok && !!done,
      path: usedPath, viaP2P: false, p2pError,
      chunks: chunks.length, expectedTotal, bytes: buf.length, sha256: gotSha, gotDone: !!done, timing,
      reason: ok ? null : `sha256 不符：${gotSha.slice(0, 12)}… ≠ ${opts.expectedSha256?.slice(0, 12)}…`,
    };
  }

  close() {
    for (const c of this._p2p) c.close();
    try { this.ws?.close(); } catch { /* ignore */ }
  }
}

export { sleep };