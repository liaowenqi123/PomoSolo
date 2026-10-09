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
import { P2PSender, P2PReceiver, WERIFT_SAFE_CHUNK_SIZE } from "./p2p.js";

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
    /** 活跃的 P2P 发送方（持有者侧）：按 peerId:tag 路由回信令 */
    this._senders = [];
    /** 活跃的 P2P 接收方（听众侧） */
    this._receivers = [];
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

  // ── P2P 信令路由与发送/接收 ─────────────────────────────────────────

  /**
   * 把 peer:* 信令分发给活跃的 P2P 连接。
   * 对照 src/p2p.ts 的 handlePeerSignal：offer 建应答连接、answer/ice 路由到活跃连接。
   * 同一对端可能有多条连接（反向打洞），这里按 tag 区分。
   */
  async _routeP2PSignal(msg) {
    const from = msg.from_user_id;
    const tag = msg.tag ?? "";
    if (msg.type === "peer:offer") {
      // 找一个正在等这条传输的接收方（不按 tag 严格匹配：虚拟端通常只等一条）
      const rx = this._receivers.find((r) => !r.pc && (r.expectFrom == null || r.expectFrom === from));
      if (!rx) { this.log(`收到 peer:offer（from=${from}）但没有等待中的接收方，忽略`); return; }
      rx.expectFrom = from;
      try { await rx.handleOffer(msg); } catch (e) { this.warn("应答 peer:offer 失败", e.message); }
      return;
    }
    // answer / ice / bye：发给匹配的发送方与接收方
    for (const s of this._senders) {
      if (s.peerId === from && (s.tag ?? "") === tag) await s.handleSignal(msg).catch(() => {});
    }
    for (const r of this._receivers) {
      if (r.pc && (r.expectFrom == null || r.expectFrom === from)) await r.handleSignal(msg).catch(() => {});
    }
  }

  /** 持有者侧：把一首歌经 P2P 直传给某个请求者 */
  async _serveViaP2P(songId, state, requesterId, tag = "") {
    const sender = new P2PSender({
      peerId: requesterId,
      tag,
      // P2P 用更小的分片（werift 消息上限 64KB），不是中转用的 128KB
      chunks: state.p2pInfo.chunks,
      chunkSize: state.p2pInfo.chunkSize,
      size: state.size,
      signal: (type, to, payload) => this.send(type, { to_user_id: to, ...payload }),
      onDiagnose: (s) => this.log(`[p2p 发送] ${s}`),
    });
    this._senders.push(sender);
    try {
      const stats = await sender.run();
      state.p2pTransfers = (state.p2pTransfers ?? 0) + 1;
      state.lastP2PStats = stats;
      this.p2pStats = stats;
      this.log(`P2P 直传完成：${stats.bytes} 字节 / ${stats.sendMs}ms / ${(stats.speedBps / 1e6).toFixed(2)} Mbps`);
      return stats;
    } finally {
      this._senders = this._senders.filter((x) => x !== sender);
    }
  }

  /** 听众侧：准备接收一次 P2P 传输 */
  prepareP2PReceive(timeoutMs = 30000) {
    const rx = new P2PReceiver({
      signal: (type, to, payload) => this.send(type, { to_user_id: to, ...payload }),
      timeoutMs,
      onDiagnose: (s) => this.log(`[p2p 接收] ${s}`),
    });
    this._receivers.push(rx);
    return rx;
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
        rx.wait().then((b) => ({ src: "p2p", buf: b })).catch((e) => ({ src: "p2p-failed", error: e.message })),
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
    for (const s of this._senders) s.close();
    for (const r of this._receivers) r.close();
    try { this.ws?.close(); } catch { /* ignore */ }
  }
}

export { sleep };
