/**
 * 多客户端传歌测试：在**不启动任何 GUI 客户端**的前提下，用 N 个虚拟客户端
 * 经**真实服务器**跑完整条传歌链路。
 *
 * 为什么要这个工具：
 *   传歌功能横跨「DJ 读分片 → 服务器转发 → 听众重组 → 完整性」四段，
 *   而手工验证需要开两个客户端 + 建房间 + 请求当 DJ + 切歌，成本极高且不可重复。
 *   虚拟客户端说的是**真协议**（消息名/字段对照 src-tauri/src/commands/music_sync.rs），
 *   所以测的是真实服务器 + 真实客户端都会走的路径。
 *
 * 用法：
 *   node transfer-test.mjs --scenario all
 *   node transfer-test.mjs --scenario relay-1to1
 *   node transfer-test.mjs --scenario relay-fanout --listeners 4
 *   node transfer-test.mjs --scenario resume
 *   node transfer-test.mjs --scenario waitall
 *   node transfer-test.mjs --scenario p2p-1to1                 # WebRTC 直连
 *   node transfer-test.mjs --scenario full-chain              # 整条听众链路（sync 驱动）
 *   # 让虚拟听众去拉**真实应用**（应用当 DJ）正在放的歌 —— 需应用已建房并请求过 DJ：
 *   node transfer-test.mjs --scenario listener-only --room <roomId> --song "Are you lost.mp3"
 *
 * 可选参数：
 *   --song <文件名>     默认 "Are you lost.mp3"（3.3MB，跑得快）
 *   --song-path <路径>  默认 ../music-player/music/<song>
 *   --listeners <N>     扇出场景的听众数，默认 3
 *   --ws <地址>         默认 wss://api.pomogrow.top
 *   --keep-room         跑完不删房间（排查用）
 *   --verbose           打印每条 WS 消息（会很吵）
 */
import process from "node:process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ensureUser, testUsers } from "./auth.js";
import { VirtualClient, sleep } from "./lib/client.js";
import { S2C } from "./lib/protocol.js";

// ── 参数 ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { scenario: "all", song: "Are you lost.mp3", listeners: 3, ws: "wss://api.pomogrow.top", verbose: false, keepRoom: false, room: null, songPath: null };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === "--scenario") a.scenario = v();
    else if (k === "--song") a.song = v();
    else if (k === "--song-path") a.songPath = v();
    else if (k === "--listeners") a.listeners = Number(v());
    else if (k === "--ws") a.ws = v();
    else if (k === "--room") a.room = v();
    else if (k === "--verbose") a.verbose = true;
    else if (k === "--keep-room") a.keepRoom = true;
    else if (k === "--help" || k === "-h") { printHelp(); process.exit(0); }
    else { console.error(`未知参数：${k}`); printHelp(); process.exit(2); }
  }
  a.songPath = a.songPath ?? fileURLToPath(new URL(`../../music-player/music/${a.song}`, import.meta.url));
  return a;
}

function printHelp() {
  console.log(`多客户端传歌测试

  --scenario <name>   all | relay-1to1 | relay-fanout | resume | waitall | p2p-1to1 | p2p-reverse | full-chain | listener-only
  --song <文件名>     默认 "Are you lost.mp3"
  --song-path <路径>  覆盖源文件路径
  --listeners <N>     扇出听众数（默认 3）
  --room <roomId>     listener-only 场景必填：真实应用所在的房间
  --ws <地址>         默认 wss://api.pomogrow.top
  --keep-room         跑完不删房间
  --verbose           打印每条 WS 消息`);
}

const args = parseArgs(process.argv);
const SONG = args.song;
const SONG_PATH = args.songPath;

// ── 结果收集与输出 ────────────────────────────────────────────────────
const results = [];   // { scenario, check, state: 'PASS'|'FAIL'|'INFO', detail }
function record(scenario, check, state, detail = "") {
  results.push({ scenario, check, state, detail });
  const icon = state === "PASS" ? "✅" : state === "FAIL" ? "❌" : "ℹ️ ";
  console.log(`  ${icon} ${check}${detail ? ` — ${detail}` : ""}`);
}

/** 用 REST 删房间，避免在服务器上留测试垃圾（协议文档已提过"僵尸房间"问题） */
async function deleteRoom(roomId, token) {
  try {
    const res = await fetch(`https://api.pomogrow.top/api/v1/rooms/${roomId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.status;
  } catch {
    return null;
  }
}

// ── 公共脚手架 ────────────────────────────────────────────────────────

/**
 * 建一个房间，放入 1 个 DJ + N 个听众。
 * @returns {{ roomId: string, dj: VirtualClient, listeners: VirtualClient[], cleanup: ()=>Promise<void> }}
 */
async function setup({ listeners: listenerCount, verbose }) {
  const users = testUsers(listenerCount + 1);
  const mk = async (i, label) => {
    const u = await ensureUser(users[i].username, users[i].password);
    const c = new VirtualClient({ label, wsBase: args.ws, verbose });
    c.id = u.id; c.username = u.username; c.token = u.token;
    await c.connect();
    return c;
  };

  const dj = await mk(0, "DJ");
  const listeners = [];
  for (let i = 0; i < listenerCount; i++) listeners.push(await mk(i + 1, `听众${i + 1}`));

  const roomId = await dj.createRoom(`transfer-test-${Date.now()}`);
  for (const l of listeners) await l.joinRoom(roomId);

  const cleanup = async () => {
    for (const c of [dj, ...listeners]) { try { c.leaveRoom(roomId); } catch { /* ignore */ } }
    await sleep(300);
    if (!args.keepRoom) await deleteRoom(roomId, dj.token);
    for (const c of [dj, ...listeners]) c.close();
  };
  return { roomId, dj, listeners, cleanup };
}

// ── 场景 ──────────────────────────────────────────────────────────────

/** 场景 1：服务器中转 1→1 + 完整性校验 */
async function scenarioRelay1to1() {
  console.log(`\n══ 场景 relay-1to1：服务器中转，1 个听众，校验逐字节一致 ══`);
  const { dj, listeners, cleanup } = await setup({ listeners: 1, verbose: args.verbose });
  try {
    await dj.requestDj();
    const served = dj.startServing(SONG, SONG_PATH);
    dj.broadcastState({ songId: SONG });
    await sleep(500);

    const r = await listeners[0].fetchSong(SONG, {
      expectedSha256: served.sha256, expectedSize: served.size, timeoutMs: 90000,
    });

    record("relay-1to1", "听众收齐并完整性一致", r.ok ? "PASS" : "FAIL",
      r.ok ? `${r.chunks}/${r.expectedTotal} 片，${r.bytes} 字节，sha256=${r.sha256.slice(0, 12)}…`
           : (r.reason ?? `收到 ${r.chunks}/${r.expectedTotal}`));
    record("relay-1to1", "DJ 收到过 song_requested", served.transfers > 0 ? "PASS" : "FAIL", `服务次数=${served.transfers}`);
    record("relay-1to1", "DJ 收到 transfer_done 之前的片序完整",
      served.totalChunks === r.expectedTotal ? "PASS" : "FAIL",
      `DJ 声称 ${served.totalChunks} 片，听众看到 total_chunks=${r.expectedTotal}`);

    /*
     * 分段计时：把"慢"归因到具体环节。只看总耗时无法区分
     *   ① 持有者发送慢（读盘 / base64 / 背压）
     *   ② 服务器中转慢
     *   ③ 接收端处理慢
     * 对比"DJ 发完耗时"与"听众收完耗时"即可区分。
     */
    if (r.timing?.totalMs != null) {
      const sendMs = served.lastSendMs;
      const recvMs = r.timing.totalMs;
      record("relay-1to1", "分段计时（定位瓶颈）", "INFO",
        `听众：首片 ${r.timing.firstChunkMs}ms，收完 ${recvMs}ms（${(r.bytes / (recvMs / 1000) / 1e6).toFixed(2)} MB/s）` +
        (sendMs != null
          ? `；DJ 发完 ${sendMs}ms（${(served.lastSentBytes / (sendMs / 1000) / 1e6).toFixed(2)} MB/s），` +
            `中转+接收额外 ${recvMs - sendMs}ms`
          : ""));
    }
  } finally {
    await cleanup();
  }
}

/** 场景 2：1 个 DJ → N 个听众（多客户端扇出），全部逐字节一致 */
async function scenarioRelayFanout() {
  const n = args.listeners;
  console.log(`\n══ 场景 relay-fanout：1 个 DJ → ${n} 个听众 ══`);
  const { dj, listeners, cleanup } = await setup({ listeners: n, verbose: args.verbose });
  try {
    await dj.requestDj();
    const served = dj.startServing(SONG, SONG_PATH);
    dj.broadcastState({ songId: SONG });
    await sleep(500);

    // 并发请求：验证服务器/DJ 能同时服务多个请求者
    const t0 = Date.now();
    const rs = await Promise.all(
      listeners.map((l) => l.fetchSong(SONG, {
        expectedSha256: served.sha256, expectedSize: served.size, timeoutMs: 120000,
      })),
    );
    const ms = Date.now() - t0;

    const okCount = rs.filter((r) => r.ok).length;
    const totalBytes = rs.reduce((a, r) => a + (r.bytes || 0), 0);
    const mbps = ms > 0 ? totalBytes / (ms / 1000) / 1e6 : 0;
    record("relay-fanout", `${n} 个听众全部收齐且完整性一致`, okCount === n ? "PASS" : "FAIL",
      `${okCount}/${n} 成功；${(totalBytes / 1e6).toFixed(2)} MB / ${ms}ms = **${mbps.toFixed(2)} MB/s 聚合**（每听众 ${(mbps / n).toFixed(2)} MB/s）`);
    record("relay-fanout", "DJ 侧服务的请求者数 == 听众数", served.servedTo.size === n ? "PASS" : "FAIL",
      `DJ 服务了 ${served.servedTo.size} 个不同请求者`);

    /*
     * 观察项（协议文档留了优化空间，不是断言）：
     * EXTERNAL-INTERFACES.md 提到服务器"可同时转发给房间内所有缺歌者，
     * 减少重复传输，由服务器实现取舍"。若已实现，DJ 只需服务 1 次；
     * 若未实现，N 个听众会让 DJ 上传 N 倍数据（带宽放大）。
     * 这是性能与成本上的实质差别，所以显式报出来。
     */
    const dedup = served.transfers === 1 && n > 1;
    record("relay-fanout", "服务器是否对多听众去重（DJ 只服务 1 次）", "INFO",
      dedup
        ? `已去重：DJ 仅服务 ${served.transfers} 次，服务器扇出`
        : `未去重：DJ 服务了 ${served.transfers} 次（= 听众数），上行带宽放大 ${served.transfers}×；` +
          `协议文档提到的"同时转发给所有缺歌者"尚未实现`);

    rs.forEach((r, i) => {
      if (!r.ok) record("relay-fanout", `听众${i + 1} 失败原因`, "FAIL", r.reason ?? `收到 ${r.chunks}/${r.expectedTotal}`);
    });
  } finally {
    await cleanup();
  }
}

/** 场景 3：断点续传（from_chunk）—— 验证服务器是否把 from_chunk 转发给持有者 */
async function scenarioResume() {
  console.log(`\n══ 场景 resume：断点续传（from_chunk）══`);
  const { dj, listeners, cleanup } = await setup({ listeners: 1, verbose: args.verbose });
  try {
    await dj.requestDj();
    const served = dj.startServing(SONG, SONG_PATH);
    dj.broadcastState({ songId: SONG });
    await sleep(500);

    const K = Math.floor(served.totalChunks / 2);
    const listener = listeners[0];
    const base = listener.count(S2C.SONG_CHUNK, (m) => m.song_id === SONG);
    listener.send("music:request_song", { song_id: SONG, from_chunk: K });

    // 等 DJ 收到请求，看它有没有拿到 from_chunk
    const req = await dj.waitFor(S2C.SONG_REQUESTED, (m) => m.song_id === SONG, 12000);
    record("resume", "DJ 收到 song_requested", req ? "PASS" : "FAIL");
    const forwarded = req && Number.isFinite(req.from_chunk) ? "PASS" : "FAIL";
    record("resume", "服务器把 from_chunk 转发给了持有者", forwarded,
      req ? `收到 from_chunk=${JSON.stringify(req.from_chunk)}（期望 ${K}）` : "未收到请求");

    // 等收完（只应收到后半段）
    const done = await listener.waitFor(S2C.TRANSFER_DONE, (m) => m.song_id === SONG, 60000);
    const chunks = listener.find(S2C.SONG_CHUNK, (m) => m.song_id === SONG).slice(base);
    const idx = chunks.map((c) => c.chunk_index).sort((a, b) => a - b);
    const expectCount = served.totalChunks - K;
    const onlyTail = idx.every((i) => i >= K);

    record("resume", `只收到后半段（${expectCount} 片，从 index ${K} 起）`,
      chunks.length === expectCount && onlyTail ? "PASS" : "FAIL",
      `实收 ${chunks.length} 片，index 范围 ${idx[0] ?? "-"}..${idx[idx.length - 1] ?? "-"}`);
    record("resume", "收到 transfer_done", done ? "PASS" : "FAIL");
    // 校验后半段字节与源文件对应区间一致
    if (chunks.length && onlyTail) {
      const { readFileSync } = await import("node:fs");
      const { createHash } = await import("node:crypto");
      const src = readFileSync(SONG_PATH);
      const tailExpected = src.subarray(K * served.chunkSize);
      const assembled = Buffer.concat([...chunks].sort((a, b) => a.chunk_index - b.chunk_index).map((c) => Buffer.from(c.data_base64, "base64")));
      const a = createHash("sha256").update(assembled).digest("hex");
      const b = createHash("sha256").update(tailExpected).digest("hex");
      record("resume", "续传片段与源文件对应区间逐字节一致", a === b ? "PASS" : "FAIL",
        `重组 ${assembled.length} 字节 vs 期望 ${tailExpected.length} 字节`);
    }
  } finally {
    await cleanup();
  }
}

/**
 * 场景 6：P2P 直连（WebRTC DataChannel）—— 媒体数据不经服务器。
 * 同时验证服务器是否把请求里的 p2p 标志透传给持有者（协议文档曾就此提问）。
 */
async function scenarioP2P1to1() {
  console.log(`\n══ 场景 p2p-1to1：WebRTC 直连（媒体不经服务器），校验逐字节一致 ══`);
  const { dj, listeners, cleanup } = await setup({ listeners: 1, verbose: args.verbose });
  try {
    await dj.requestDj();
    const served = dj.startServing(SONG, SONG_PATH, { p2p: true });
    dj.broadcastState({ songId: SONG });
    await sleep(500);

    const t0 = Date.now();
    const r = await listeners[0].fetchSong(SONG, {
      p2p: true, expectedSha256: served.sha256, expectedSize: served.size, timeoutMs: 120000,
    });
    const ms = Date.now() - t0;

    // 完整性与路径无关，必须通过
    record("p2p-1to1", "数据收齐且完整性一致", r.ok ? "PASS" : "FAIL",
      r.ok ? `${r.bytes} 字节，sha256=${r.sha256?.slice(0, 12)}…` : (r.reason ?? "未知"));

    /*
     * 服务器是否透传 p2p 字段 —— 这是 P2P 能否被触发的前提。
     * 真实持有端（music.ts:1188）就是靠这个字段决定要不要走直连的，
     * 所以服务器不透传 = 生产环境的 P2P 永远不会被触发。
     */
    const forwarded = served.lastRequestedP2P;
    record("p2p-1to1", "服务器把请求里的 p2p 标志透传给了持有者",
      forwarded === true ? "PASS" : "FAIL",
      forwarded === true ? "song_requested.p2p === true"
        : `song_requested.p2p === ${JSON.stringify(forwarded)}（真实持有端据此门控 P2P，不透传则生产上永远走中转）`);

    // 实际走了哪条路
    record("p2p-1to1", "实际使用 P2P 直连（而非回退中转）",
      r.path === "p2p" ? "PASS" : "INFO",
      r.path === "p2p"
        ? `P2P 直传 ${ms}ms，${(r.bytes / (ms / 1000) / 1e6).toFixed(2)} MB/s`
        : `走了 ${r.path}${r.p2pError ? `（P2P 失败：${r.p2pError}）` : ""}`
          + (forwarded !== true ? "；根因是服务器未透传 p2p 标志" : ""));

    // 与 2Mbps 中转对比 —— 这是 P2P 存在的意义
    if (r.path === "p2p") {
      const p2pMbps = r.bytes / (ms / 1000) * 8 / 1e6;
      // 2 Mbps = 250000 字节/秒，据此估"同样数据走中转要多久"
      const relayEstimateSec = r.bytes / (2 * 1e6 / 8);
      record("p2p-1to1", "P2P 速率 vs 服务器中转带宽上限", "INFO",
        `P2P ${p2pMbps.toFixed(2)} Mbps（${(r.bytes / (ms / 1000) / 1e6).toFixed(2)} MB/s，端到端 ${ms}ms）；` +
        `同样数据走 2Mbps 中转理论需 ${relayEstimateSec.toFixed(1)}s → 提速约 ${(relayEstimateSec / (ms / 1000)).toFixed(1)}x`);
    }
    if (served.p2pTransfers) {
      record("p2p-1to1", "持有端记录了 P2P 直传成功次数", "PASS", `${served.p2pTransfers} 次`);
    }
    if (served.p2pFailures) {
      record("p2p-1to1", "持有端 P2P 失败次数", "INFO", `${served.p2pFailures} 次（已回退中转）`);
    }
  } finally {
    await cleanup();
  }
}

/**
 * 场景 7：**整条听众链路**（sync_state 驱动）。
 *
 * 虚拟听众不再被手动喂 songId，而是像真实客户端那样自己走完：
 *   进房 → 开同步 → request_state 拿 DJ 状态 → 判断本地缺歌 → 请求下载
 *   → 收齐校验 → 再次 request_state 重对齐 → 校验"下载期间位置在推进"
 *
 * 最后一条正是真实出现过的 bug（"下载完从头播放"）：DJ 必须在传歌期间
 * 持续广播 sync_state，否则听众 seek 回的是下载**开始**时的旧位置。
 */
async function scenarioFullChain() {
  console.log(`\n══ 场景 full-chain：sync_state 驱动 → 缺歌检测 → 下载 → 重对齐 ══`);
  const { dj, listeners, cleanup } = await setup({ listeners: 1, verbose: args.verbose });
  const listener = listeners[0];
  try {
    await dj.requestDj();
    const served = dj.startServing(SONG, SONG_PATH, { p2p: true, djBroadcast: true });
    /*
     * DJ 开始「播放」：注册 state_request 处理器 + 广播初始状态。
     * 必须先于听众的 request_state —— DJ 收到 state_request 时要能广播出实时状态。
     */
    dj.startDjPlayback(SONG, { positionMs: 0 });
    await sleep(400);

    /** 等一条**新的** sync_state（不能用 waitFor：它先命中历史消息会让断言假通过） */
    async function waitNewState(fromCount, timeoutMs = 10000) {
      const ok = await listener.waitUntil(() => listener.count(S2C.SYNC_STATE) > fromCount, timeoutMs);
      if (!ok) return null;
      return listener.find(S2C.SYNC_STATE)[listener.count(S2C.SYNC_STATE) - 1];
    }

    // ① 听众开同步：请求状态，必须拿到**请求之后**新广播的状态
    const n0 = listener.count(S2C.SYNC_STATE);
    listener.send("music:request_state", {});
    const first = await waitNewState(n0);
    record("full-chain", "① 听众经 request_state 拿到 DJ 实时状态", first ? "PASS" : "FAIL",
      first ? `song_id=${first.song_id} playing=${first.playing} position=${first.position_ms}ms（新消息，非历史）`
            : "10s 内没收到**新的** sync_state");
    if (!first) return;

    // ② 判断本地是否缺歌（虚拟听众本地库为空 → 必然缺）
    record("full-chain", "② 缺歌检测（本地库为空 → 需要下载）", "PASS", `song_id=${first.song_id}`);

    // ③ 请求下载（P2P 优先，失败回退中转）
    const r = await listener.fetchSong(first.song_id, {
      p2p: true, expectedSha256: served.sha256, expectedSize: served.size, timeoutMs: 120000,
    });
    record("full-chain", "③ 下载完成且完整性一致", r.ok ? "PASS" : "FAIL",
      r.ok ? `经 ${r.path}，${r.bytes} 字节，sha256=${r.sha256.slice(0, 12)}…` : (r.reason ?? "未知"));

    // ④ 下载完重对齐：再要一次状态，同样只认新消息
    const posBefore = Number(first.position_ms ?? 0);
    const n1 = listener.count(S2C.SYNC_STATE);
    listener.send("music:request_state", {});
    const second = await waitNewState(n1);
    record("full-chain", "④ 下载后能重新对齐到 DJ 当前进度", second ? "PASS" : "FAIL",
      second ? `position ${posBefore} → ${second.position_ms}ms` : "10s 内没收到新的 sync_state");

    /*
     * ⑤ 关键断言：位置在下载期间**确实推进了**。
     * 若 DJ 传歌期间不广播（或不更新位置），听众拿到的仍是旧位置，
     * 表现就是「下载完从头播放」—— 这条断言就是为了钉死这个 bug。
     */
    if (second) {
      const posAfter = Number(second.position_ms ?? 0);
      record("full-chain", "⑤ 下载期间 DJ 位置在推进（防「下载完从头播放」）",
        posAfter > posBefore ? "PASS" : "FAIL",
        `position ${posBefore} → ${posAfter}ms（+${posAfter - posBefore}ms）；`
        + `DJ 收到 state_request 次数=${dj.stateRequestCount ?? 0}`);
    }

    // ⑥ 服务器转达链路：request_state 是否真被转成了 DJ 侧的 state_request
    record("full-chain", "⑥ 服务器把 request_state 转达给了 DJ（music:state_request）",
      (dj.stateRequestCount ?? 0) >= 2 ? "PASS" : "FAIL",
      `DJ 收到 ${dj.stateRequestCount ?? 0} 次 state_request（期望 ≥2，对应两次 request_state）`);

    // ⑦ 传歌期间 DJ 是否持续广播（下载耗时长时防位置过期）
    record("full-chain", "⑦ 传歌期间 DJ 持续广播状态", "INFO",
      `DJ 共广播 ${dj.count("music:sync_state")} 次 sync_state（初始 + 每次 state_request + 传歌期间每 5s）`);
  } finally {
    await cleanup();
  }
}

/**
 * 场景 8：**反向打洞**（reverse，v4.7.5）。
 *
 * 正常方向是持有端作 offerer；对称 NAT 下可能打不通 → 下载端主动打洞、
 * 持有端在**收到的** channel 上发数据。这是完全不同的 role/sender 组合
 * （offerer 收数据、answerer 发数据），且支持 parallel 多连接分段
 * （每段带 baseChunk/globalChunks），是传歌里最容易出错、也最没被覆盖的一条路径。
 */
async function scenarioP2PReverse() {
  console.log(`\n══ 场景 p2p-reverse：反向打洞（下载端作 offerer，持有端在收到的 channel 上发数据）══`);
  const { dj, listeners, cleanup } = await setup({ listeners: 1, verbose: args.verbose });
  const listener = listeners[0];
  try {
    await dj.requestDj();
    const served = dj.startServing(SONG, SONG_PATH, { p2p: true });
    dj.broadcastState({ songId: SONG });
    await sleep(400);

    // ── 单连接反向
    const r1 = await listener.fetchSongReverse(SONG, {
      peerId: dj.id, parallel: 1,
      expectedSha256: served.sha256, expectedSize: served.size, timeoutMs: 90000,
    });
    record("p2p-reverse", "① 单连接反向打洞传完且逐字节一致", r1.ok ? "PASS" : "FAIL",
      r1.ok ? `${r1.bytes} 字节，sha256=${r1.sha256.slice(0, 12)}…，端到端 ${r1.timing.totalMs}ms`
            : `${r1.reason ?? "未知"}${r1.reasons?.length ? `（段错误：${r1.reasons.join("; ")}）` : ""}`);
    record("p2p-reverse", "② 持有端收到反向打洞请求", (served.reverseRequests ?? 0) >= 1 ? "PASS" : "FAIL",
      `收到 ${served.reverseRequests ?? 0} 次 p2p:reverse_transfer_request`);

    // ── 并行多连接反向（每段带 baseChunk/globalChunks，段内 index 是局部序号）
    const rK = await listener.fetchSongReverse(SONG, {
      peerId: dj.id, parallel: 3,
      expectedSha256: served.sha256, expectedSize: served.size, timeoutMs: 120000,
    });
    record("p2p-reverse", "③ 并行 3 连接反向打洞传完且逐字节一致", rK.ok ? "PASS" : "FAIL",
      rK.ok ? `${rK.okSegments}/${rK.totalSegments} 段，${rK.bytes} 字节，sha256=${rK.sha256.slice(0, 12)}…，端到端 ${rK.timing.totalMs}ms`
            : `${rK.reason ?? "未知"}${rK.reasons?.length ? `（段错误：${rK.reasons.join("; ")}）` : ""}`);

    /*
     * ④ 分段映射正确性 —— 并行反向最危险的地方：
     * 每段 meta 只带**段内**片数，若接收端不做 baseChunk 映射就会把各段都从 0 开始拼，
     * 拼出错误文件（或提前判定收齐 → 残缺文件）。
     * ③ 的 sha256 一致已证明映射正确，这里把结论显式说出来便于排查。
     */
    if (rK.ok) {
      record("p2p-reverse", "④ 三段映射回全局序号后仍逐字节一致", "PASS",
        `${rK.okSegments} 段拼接后 ${rK.bytes} 字节，与源文件 sha256 相同（baseChunk 映射正确）`);
    }
    /*
     * ⑤ 服务器是否把 `parallel` 透传给持有者。
     *
     * 这条必须断言而不是观察：若服务器吞掉 `parallel`，持有端只会建 **1** 条
     * answerer 连接，但下载端仍会发起 3 条 offer —— 其中一条被应答并拿到**整份文件**，
     * 于是**测试照样通过、sha256 也一致**，可多连接并行其实根本没生效。
     * 这正是"看起来通过、实际没测到目标路径"的典型陷阱。
     */
    const holderSaw = await (async () => {
      const ok = await dj.waitUntil(() => (served.lastReverseParallel ?? 0) === 3
        && (served.lastReverseOkSegments ?? 0) === 3, 15000);
      return ok;
    })();
    record("p2p-reverse", "⑤ 服务器把 parallel=3 透传给持有端（否则并行没真正生效）",
      holderSaw ? "PASS" : "FAIL",
      `持有端实际收到 parallel=${served.lastReverseParallel ?? "(未记录)"}，`
      + `建了 ${served.lastReverseSegments ?? "-"} 条、成功 ${served.lastReverseOkSegments ?? "-"} 条`
      + (holderSaw ? "" : "；若持有端只建 1 条，则下载端的 3 条 offer 里只有一条被应答（拿到整份文件），测试会假通过"));
  } finally {
    await cleanup();
  }
}
/** 场景 4：wait_all 协调（观察服务器是否发 song_waiting / songs_ready） */
async function scenarioWaitAll() {
  console.log(`\n══ 场景 waitall：wait_all 模式的 song_waiting / songs_ready 协调 ══`);
  const { dj, listeners, cleanup } = await setup({ listeners: 1, verbose: args.verbose });
  try {
    await dj.requestDj();
    const served = dj.startServing(SONG, SONG_PATH);
    dj.setTransferMode("wait_all");
    dj.broadcastState({ songId: SONG, transferMode: "wait_all" });
    await sleep(600);

    const listener = listeners[0];
    const r = await listener.fetchSong(SONG, { expectedSha256: served.sha256, expectedSize: served.size, timeoutMs: 90000 });

    record("waitall", "wait_all 下仍能完成传输", r.ok ? "PASS" : "FAIL", r.reason ?? `${r.chunks}/${r.expectedTotal} 片`);

    // 这两个是**观察项**：服务器是否广播协调消息。
    // 触发条件可能依赖真实客户端才会上报的信息，虚拟客户端不一定满足，
    // 所以用 INFO 呈现事实、不武断判失败。
    const waiting = dj.find(S2C.SONG_WAITING).length + listener.find(S2C.SONG_WAITING).length;
    const ready = dj.find(S2C.SONGS_READY).length + listener.find(S2C.SONGS_READY).length;
    record("waitall", "是否收到 music:song_waiting", "INFO", `共 ${waiting} 条`);
    record("waitall", "是否收到 music:songs_ready", "INFO", `共 ${ready} 条`);
    if (ready > 0) record("waitall", "全员就绪广播链路可用", "PASS", "已观察到 songs_ready");
  } finally {
    await cleanup();
  }
}

/**
 * 场景 5：**真实应用当 DJ** + 虚拟听众。
 * 应用需要已经在某个房间里、已请求成为 DJ、并正在放这首歌。
 * 这条路径验证的是**应用自己的服务端逻辑**（真实 Rust 读分片 + 回传），
 * 而不是虚拟 DJ。
 */
async function scenarioListenerOnly() {
  console.log(`\n══ 场景 listener-only：真实应用当 DJ，虚拟听众拉歌 ══`);
  if (!args.room) {
    console.error("  ❌ 该场景需要 --room <roomId>（应用已建好的房间）");
    record("listener-only", "参数完整", "FAIL", "缺少 --room");
    return;
  }
  const users = testUsers(args.listeners);
  const listeners = [];
  for (let i = 0; i < args.listeners; i++) {
    const u = await ensureUser(users[i].username, users[i].password);
    const c = new VirtualClient({ label: `听众${i + 1}`, wsBase: args.ws, verbose: args.verbose });
    c.id = u.id; c.username = u.username; c.token = u.token;
    await c.connect();
    await c.joinRoom(args.room);
    listeners.push(c);
  }
  try {
    // 先问一次状态，确认房间里确实有 DJ 在放歌
    listeners[0].send("music:request_state", {});
    const st = await listeners[0].waitFor(S2C.SYNC_STATE, () => true, 10000);
    record("listener-only", "房间里存在 DJ 的同步状态", st ? "PASS" : "FAIL",
      st ? `song_id=${st.song_id} playing=${st.playing}` : "10 秒内没收到 sync_state（应用是否已请求 DJ？）");

    const t0 = Date.now();
    const rs = await Promise.all(listeners.map((l) => l.fetchSong(SONG, { timeoutMs: 180000 })));
    const okCount = rs.filter((r) => r.ok).length;
    record("listener-only", `${args.listeners} 个虚拟听众从真实应用拉到完整歌曲`,
      okCount === args.listeners ? "PASS" : "FAIL",
      `${okCount}/${args.listeners} 成功，耗时 ${Date.now() - t0}ms` +
      (okCount < args.listeners ? `；首个失败原因：${rs.find((r) => !r.ok)?.reason ?? "分片不全"}` : ""));

    // 应用是 DJ，我们不知道它本地文件的 sha；用"所有听众收到的一致"做交叉校验
    if (okCount === args.listeners && rs.every((r) => r.sha256)) {
      const same = new Set(rs.map((r) => r.sha256)).size === 1;
      record("listener-only", "各听众收到的内容彼此一致（交叉校验）", same ? "PASS" : "FAIL",
        `sha256=${rs[0].sha256.slice(0, 12)}…  字节=${rs[0].bytes}`);
      console.log(`\n  ⚠️ 注意：这条只证明"听众之间一致"，不证明"与源文件一致"——`);
      console.log(`     要证明与源文件一致，请把 --song 指向应用里那首歌、并让 --song-path 指向本地同一文件，`);
      console.log(`     或对比应用音乐目录里的文件 sha256：${rs[0].sha256}`);
    }
  } finally {
    for (const c of listeners) { try { c.leaveRoom(args.room); } catch { /* ignore */ } }
    await sleep(200);
    for (const c of listeners) c.close();
  }
}

// ── 入口 ──────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.P2P_SERVER && !args.room) {
    // 认证默认打 api.pomogrow.top，与 --ws 的主机应保持一致
  }
  console.log(`源文件：${SONG_PATH}`);
  if (!existsSync(SONG_PATH) && args.scenario !== "listener-only") {
    console.error(`❌ 找不到源文件：${SONG_PATH}\n   用 --song-path 指定，或 --song 换一首。`);
    process.exit(2);
  }
  const t0 = Date.now();

  const run = {
    "relay-1to1": scenarioRelay1to1,
    "relay-fanout": scenarioRelayFanout,
    resume: scenarioResume,
    waitall: scenarioWaitAll,
    "p2p-1to1": scenarioP2P1to1,
    "p2p-reverse": scenarioP2PReverse,
    "full-chain": scenarioFullChain,
    "listener-only": scenarioListenerOnly,
  };

  let crashed = null;
  try {
    if (args.scenario === "all") {
      /*
       * 逐个场景跑，并在**这里**捕获异常。
       * ⚠️ 踩过的坑：原来只有 try/finally，场景抛异常时会被 finally 里的
       * process.exit(0) 吞掉 —— 崩溃看起来像通过，且后面的场景静默不跑
       * （表现为"通过数变少但退出码 0"）。这类假信心比直接报错危险得多，
       * 所以场景级也要兜住并记成 FAIL。
       */
      for (const name of ["relay-1to1", "relay-fanout", "resume", "waitall", "p2p-1to1", "p2p-reverse", "full-chain"]) {
        try {
          await run[name]();
        } catch (e) {
          record(name, "场景执行未抛异常", "FAIL", `${e.message}（后续场景继续跑）`);
          console.error(`  ⚠️ 场景 ${name} 抛异常：`, e);
        }
      }
    } else if (run[args.scenario]) {
      await run[args.scenario]();
    } else {
      console.error(`未知场景：${args.scenario}`);
      printHelp();
      process.exit(2);
    }
  } catch (e) {
    crashed = e;
    record(args.scenario, "场景执行未抛异常", "FAIL", e.message);
    console.error(`\n❌ 场景 ${args.scenario} 抛异常：`, e);
  } finally {
    // ── 汇总（问题直接打在终端，不埋在文件里）──
    const pass = results.filter((r) => r.state === "PASS").length;
    const fail = results.filter((r) => r.state === "FAIL");
    const info = results.filter((r) => r.state === "INFO").length;
    console.log(`\n${"═".repeat(64)}`);
    console.log(`  汇总：${pass} 通过 / ${fail.length} 失败 / ${info} 观察   （耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）`);
    if (fail.length) {
      console.log(`\n  失败项：`);
      for (const f of fail) console.log(`    ❌ [${f.scenario}] ${f.check}${f.detail ? ` — ${f.detail}` : ""}`);
    }
    if (info) {
      console.log(`\n  观察项（非断言，用于了解服务器实际行为）：`);
      for (const i of results.filter((r) => r.state === "INFO")) console.log(`    ℹ️  [${i.scenario}] ${i.check} — ${i.detail}`);
    }
    console.log(`${"═".repeat(64)}\n`);
    process.exit(fail.length ? 1 : 0);
  }
}

main().catch((e) => { console.error("\n运行失败:", e); process.exit(1); });