/**
 * P2P 传输模块（WebRTC DataChannel）
 *
 * Phase 0：经服务器 WS 信令（peer:offer / peer:answer / peer:ice）牵线，
 * 两端 NAT 打洞成功后由 DataChannel 直连传输（音乐传歌 / 安装包种子）。
 *
 * - 前端（WebView2/Chromium）原生支持 RTCPeerConnection，零新增依赖
 * - 信令走现有 WS（Rust `p2p_signal` 命令 → 服务器定向转发，见 server-planning/ws_server.py）
 * - 数据传输协议（DataChannel）：
 *   1. 控制消息（字符串 JSON）：`{"t":"meta","size":N,"totalChunks":M,"chunkSize":K}`
 *   2. 数据消息（二进制）：4 字节大端 chunk_index + chunk 原始字节
 * - 压缩传输（v4.6.4，传歌省带宽，由发送端设置选择）：
 *   - 发送端开启压缩后先发 `{"t":"hello","v":2}` 协商，对端回 `{"t":"hello-ack","compress":1}`
 *     （旧版客户端不回 → 1.2s 后按旧格式不压缩发送，完全向后兼容）
 *   - 协商成功：meta 带 `"compress":1`，数据帧改为 `4 字节 index + 1 字节压缩标志 + payload`，
 *     分片经 deflate-raw 压缩（压缩后反而更大→发原片，保证不劣于不压缩）
 * - 可靠性：DataChannel 默认 ordered+reliable；失败/超时由调用方回退
 *   （音乐传歌回退服务器中转；更新下载回退服务器/GitHub）
 */

export type P2PSignalType = "peer:offer" | "peer:answer" | "peer:ice" | "peer:bye";

export interface PeerSignalPayload {
  type: P2PSignalType;
  from_user_id: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export interface P2PTransferCallbacks {
  /** 传输进度（接收端视角的已收字节数） */
  onProgress?: (receivedBytes: number, totalBytes: number, percent: number) => void;
  /** 传输完成（bytes 字节 / ms 耗时 / speedBps 平均速率） */
  onComplete?: (stats: { bytes: number; ms: number; speedBps: number }) => void;
  /** 建连或传输失败 */
  onError?: (err: string) => void;
  /** WebRTC 建连成功（DataChannel 可传输；前端据此标记"P2P 直连中"） */
  onOpen?: () => void;
}

export interface P2PStartOptions {
  /** 对端 user_id */
  peerId: string;
  /**
   * offerer = 发送端（发起 WebRTC + DataChannel，主动推数据）
   * answerer = 接收端（等待对端 offer，通过 ondatachannel 收数据）
   */
  role: "offerer" | "answerer";
  /** 发送端提供：读第 index 片（0-based），返回原始字节 */
  sendChunk?: (index: number, totalChunks: number) => Promise<Uint8Array>;
  /** 发送端已知文件总字节数（接收端从 meta 获得） */
  totalBytes?: number;
  /** 接收端落盘：收到第 index 片 */
  onChunk?: (chunk: Uint8Array, index: number, totalChunks: number) => Promise<void>;
  /** STUN 服务器（获取 NAT 映射地址用）；空数组 = 只走 host 候选 */
  stunUrls?: string[];
  /** 单片字节数（默认 128KB） */
  chunkSize?: number;
  /**
   * 发送端启用压缩传输（传歌省带宽，v4.6.4）：
   * 开启后与对端做 hello 协商（新对端 → deflate-raw 压缩分片；旧对端 → 自动回退不压缩，完全兼容）
   */
  compress?: boolean;
  /** 建连超时（默认 8s，超时回调 onError 并关闭） */
  timeoutMs?: number;
  /** 信令发送（默认走 Tauri invoke p2p_signal；测试注入假实现） */
  signal?: (type: P2PSignalType, toUserId: string, payload: Record<string, unknown>) => Promise<void>;
  /** 诊断回调：输出 ICE 候选/状态变化（排障 P2P 打洞失败用，UI 可直接展示） */
  onDiagnose?: (info: string) => void;
  callbacks?: P2PTransferCallbacks;
}

export interface P2PHandle {
  close: () => void;
}

// 国内可达性优先的 STUN 列表（v4.6.0-beta 实测 Google STUN 在大陆常被墙/不稳定，
// 仅 cloudflare 单点时对称 NAT 下打洞成功率低；多 STUN 并行收集提高 srflx 候选获取率）
const DEFAULT_STUN = [
  "stun:stun.cloudflare.com:3478",
  "stun:stun.miwifi.com:3478",
  "stun:stun.chat.bilibili.com:3478",
  "stun:stun.l.google.com:19302",
];
const DEFAULT_CHUNK_SIZE = 128 * 1024;
const DEFAULT_TIMEOUT_MS = 8_000;
/** 压缩协商超时：hello 发出后对端（旧版）不回 hello-ack 的最大等待，随后按不压缩旧格式发送 */
const COMPRESS_NEGOTIATE_TIMEOUT = 1_200;

// ── 纯函数（协议编解码，便于单测）──

/** 编码分片：4 字节大端 index + 数据（返回 ArrayBuffer 视图，可直接 send） */
export function encodeChunk(index: number, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(4 + data.length);
  new DataView(buf.buffer).setUint32(0, index);
  buf.set(data, 4);
  return buf;
}

/** 解码分片：返回 { index, data } */
export function parseChunk(buf: Uint8Array): { index: number; data: Uint8Array } {
  const index = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0);
  return { index, data: buf.slice(4) };
}

/**
 * 压缩传输分片编码：4 字节大端 index + 1 字节压缩标志（1=payload 为 deflate-raw 压缩数据）+ payload。
 * 仅压缩传输使用（meta.compress=1）；不压缩仍走 encodeChunk/parseChunk 旧格式，兼容旧版对端。
 */
export function encodeChunkC(index: number, data: Uint8Array, compressed: boolean): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(5 + data.length);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, index);
  buf[4] = compressed ? 1 : 0;
  buf.set(data, 5);
  return buf;
}

/** 解析压缩传输分片：返回 { index, compressed, data } */
export function parseChunkC(buf: Uint8Array): { index: number; compressed: boolean; data: Uint8Array } {
  const index = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0);
  const compressed = buf[4] === 1;
  return { index, compressed, data: buf.slice(5) };
}

// ── 压缩（浏览器原生 CompressionStream = Chromium zlib，128KB 片开销微秒级，不吃算力）──

function compressionSupported(): boolean {
  return typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
}

/** deflate-raw 压缩单个分片；环境不支持或压缩失败时原样返回（jsdom 测试/旧内核兜底） */
export async function compressChunk(data: Uint8Array): Promise<Uint8Array> {
  if (!compressionSupported()) return data;
  try {
    // slice() 转成 ArrayBuffer-backed 视图以满足 BlobPart 类型约束
    const stream = new Blob([data.slice()]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return data;
  }
}

/** deflate-raw 解压单个分片；环境不支持或解压失败时原样返回 */
export async function decompressChunk(data: Uint8Array): Promise<Uint8Array> {
  if (!compressionSupported()) return data;
  try {
    const stream = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return data;
  }
}

/** 解析 hello-ack 协商回包（对端不支持/非该消息 → 返回空对象） */
function parseHelloAck(text: string): { compress?: boolean } {
  try {
    const o = JSON.parse(text);
    if (o && o.t === "hello-ack") return { compress: o.compress === true };
  } catch {
    /* 非 JSON */
  }
  return {};
}

export interface ChunkMeta {
  size: number;
  totalChunks: number;
  chunkSize: number;
  /** 压缩传输标志（v4.6.4）：meta.compress=1 时数据帧为 index+标志+payload 格式 */
  compress?: boolean;
}

/** 构建 meta 控制消息（JSON 字符串）；compress=true 时带压缩标志（旧版对端解析忽略未知字段） */
export function buildMeta(size: number, totalChunks: number, chunkSize: number, compress = false): string {
  return JSON.stringify({ t: "meta", size, totalChunks, chunkSize, ...(compress ? { compress: 1 } : {}) });
}

/** 解析 meta 控制消息 */
export function parseMeta(text: string): ChunkMeta | null {
  try {
    const o = JSON.parse(text);
    if (o && o.t === "meta" && typeof o.size === "number" && typeof o.totalChunks === "number") {
      return { size: o.size, totalChunks: o.totalChunks, chunkSize: o.chunkSize ?? 0, compress: o.compress === 1 };
    }
  } catch {
    /* 非 meta 消息 */
  }
  return null;
}

// ── 连接注册表（handlePeerSignal 路由用）──

/** 接收端挂起表：peerId → 等待对端 offer 的选项 */
const pendingReceivers = new Map<string, P2PStartOptions>();
/** 活跃连接表：peerId → 连接控制器 */
const liveConnections = new Map<string, PeerConnectionController>();
/**
 * 早于连接建立的 ICE 候选缓冲：peerId → 候选列表。
 *
 * trickle ICE 竞态：offerer 的候选可能在 peer:offer 之前到达 answerer
 * （此时 liveConnections 尚无此键），若直接丢弃会丢失关键 srflx 候选，
 * 跨 NAT 打洞失败（v4.6.0 实测"P2P 打不穿、8s 超时回退服务器中转"的根因）。
 * 等 offer 建连后统一注入。
 */
const earlyCandidates = new Map<string, RTCIceCandidateInit[]>();

interface PeerConnectionController {
  peerId: string;
  pc: RTCPeerConnection;
  close: () => void;
  /** 收到对端 answer */
  onAnswer: (sdp?: RTCSessionDescriptionInit) => Promise<void>;
  /** 收到对端 ICE 候选 */
  onIce: (candidate?: RTCIceCandidateInit) => Promise<void>;
}

function defaultSignal(type: P2PSignalType, toUserId: string, payload: Record<string, unknown>) {
  return import("@tauri-apps/api/core").then(({ invoke }) =>
    invoke("p2p_signal", { msgType: type, toUserId, payload }),
  );
}

function createPeerConnection(opts: P2PStartOptions, callbacks: P2PTransferCallbacks) {
  const pc = new RTCPeerConnection({
    iceServers: (opts.stunUrls ?? DEFAULT_STUN).map((url) => ({ urls: url })),
  });
  return pc;
}

/**
 * 接收端（answerer）：挂起等待对端 offer。应在发起 music:request_song 时同步调用。
 */
export function p2pReceive(opts: P2PStartOptions): P2PHandle {
  const prev = pendingReceivers.get(opts.peerId);
  if (prev) pendingReceivers.delete(opts.peerId);
  pendingReceivers.set(opts.peerId, opts);
  return {
    close: () => {
      pendingReceivers.delete(opts.peerId);
    },
  };
}

/**
 * 发送端（offerer）：立即发起 WebRTC 握手并推送数据。
 */
export function p2pSend(opts: P2PStartOptions): P2PHandle {
  try {
    const controller = establishConnection(opts, opts.callbacks ?? {});
    return { close: () => controller.close() };
  } catch (e) {
    opts.callbacks?.onError?.(`P2P 建连失败: ${String(e)}`);
    return { close: () => {} };
  }
}

/** 建连 + 传输主流程（offerer 主动；answerer 收到 offer 后进入） */
function establishConnection(
  opts: P2PStartOptions,
  callbacks: P2PTransferCallbacks,
  incomingOffer?: RTCSessionDescriptionInit,
): PeerConnectionController {
  const pc = createPeerConnection(opts, callbacks);
  const isOfferer = opts.role === "offerer";
  // remoteDescription 设置前的候选缓冲：addIceCandidate 在 remoteDescription 为 null 时
  // 抛 InvalidStateError，若被上层 catch 吞掉 → 关键候选永久丢失 → 打洞失败。
  // setRemoteDescription 成功后统一 flush（trickle ICE 竞态修复）。
  const bufferedCandidates: RTCIceCandidateInit[] = [];
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE;
  let dc: RTCDataChannel | null = null;
  let closed = false;
  let timedOut = false;
  let completed = false;
  let totalBytes = opts.totalBytes ?? 0;
  let totalChunks = 0;
  let receivedBytes = 0;
  const startTime = Date.now();
  let ackTimer: ReturnType<typeof setTimeout> | null = null;
  // ── 压缩传输状态（v4.6.4）──
  const compressEnabled = opts.compress === true;
  /** 发送端：协商结果（对端支持压缩 + 本端可用） */
  let negotiatedCompress = false;
  /** 接收端：从 meta 得知本次传输是否压缩 */
  let transferCompressed = false;
  /** 发送端：是否已开始发送（防止协商回包与超时竞态导致重复发送） */
  let sendStarted = false;
  /** 发送端：全部数据分片是否已发出（进入等 ack 阶段）。
   *  v4.6.6：此时对端关闭通道 = 对端已收齐（回 ack 后正常 close），不再误报失败 */
  let allSent = false;
  let negotiateTimer: ReturnType<typeof setTimeout> | null = null;
  const timeoutTimer = setTimeout(() => {
    if (!completed && pc.connectionState !== "connected") {
      timedOut = true;
      diagnose(`超时：本地候选(${diagLocal.length}) ${diagLocal.join(" | ") || "无"}；对端候选 ${remoteIceCount} 个；ICE=${pc.iceConnectionState}`);
      diagnoseConclusion();
      callbacks.onError?.(`P2P 建连超时（${opts.peerId}）`);
      cleanup();
    }
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const signal = opts.signal ?? defaultSignal;

  // ── ICE 诊断（排障 P2P 打洞失败：收集候选/状态变化，输出到 console + onDiagnose）──
  const diagLocal: string[] = [];
  let remoteIceCount = 0;
  /** 对端候选类型（从原始 SDP candidate 提取 typ 字段） */
  const remoteTypes: string[] = [];
  /** 诊断结论只输出一次 */
  let conclusionDone = false;
  function diagnose(info: string) {
    console.warn(`[P2P-diagnose] ${opts.role} peer=${opts.peerId} ${info}`);
    opts.onDiagnose?.(info);
  }

  /**
   * 诊断结论（自动分析两侧候选 → NAT 类型推断），超时/连接失败时输出一次。
   * 用于直接回答"为什么打洞打不通"，避免肉眼看候选列表。
   */
  function diagnoseConclusion() {
    if (conclusionDone) return;
    conclusionDone = true;
    let host = 0;
    let srflx = 0;
    let relay = 0;
    const srflxPorts = new Set<string>();
    for (const line of diagLocal) {
      if (line.includes(":host:")) host += 1;
      else if (line.includes(":srflx:")) {
        srflx += 1;
        srflxPorts.add(line.slice(line.lastIndexOf(":") + 1));
      } else if (line.includes(":relay:")) relay += 1;
    }
    const rt: Record<string, number> = {};
    for (const t of remoteTypes) rt[t] = (rt[t] ?? 0) + 1;
    const parts: string[] = [];
    if (srflx === 0) {
      parts.push("本机无公网候选（STUN 失败或 UDP 出站被拦）");
    } else if (srflx > 1 && srflxPorts.size > 1) {
      parts.push(`本机疑似对称 NAT（${srflx} 个 srflx 端口各异，打洞需端口预测，成功率低）`);
    } else {
      parts.push("本机有公网候选");
    }
    const rsrflx = rt.srflx ?? 0;
    const rhost = rt.host ?? 0;
    if (rsrflx > 0) {
      parts.push(`对端有公网候选 srflx×${rsrflx}`);
    } else if (rhost > 0) {
      parts.push("对端仅有内网 host 候选（无公网 srflx）→ 不在同一局域网且对端 UDP 打洞路径不通");
    } else {
      parts.push(`对端候选 ${remoteIceCount} 个（无 srflx/host 归类，见明细）`);
    }
    if (srflx > 0 && rsrflx > 0) {
      parts.push("两侧都有公网候选仍连不上 → 一侧为对称 NAT/CGNAT 或运营商丢 UDP，建议加 TURN 中继");
    }
    diagnose(`诊断结论：${parts.join("；")}`);
  }

  function cleanup() {
    if (closed) return;
    closed = true;
    clearTimeout(timeoutTimer);
    if (ackTimer) clearTimeout(ackTimer);
    if (negotiateTimer) clearTimeout(negotiateTimer);
    try {
      pc.close();
    } catch {
      /* 忽略 */
    }
    liveConnections.delete(opts.peerId);
  }

  function onComplete() {
    if (completed) return;
    completed = true;
    const ms = Date.now() - startTime;
    const speedBps = ms > 0 ? Math.round((receivedBytes * 8 * 1000) / ms) : 0;
    callbacks.onComplete?.({ bytes: receivedBytes, ms, speedBps });
    if (isOfferer) {
      cleanup();
    } else {
      // 接收端：延迟关闭连接，给发送端留出收到 ack 的时间。
      // v4.6.6：立即 pc.close() 会让 ack 未送达/触发对端 onclose → 发送端误报"通道关闭/错误"
      setTimeout(cleanup, 500);
    }
  }

  function wireChannel(channel: RTCDataChannel) {
    dc = channel;
    channel.onopen = () => {
      if (isOfferer) {
        void beginSend();
      }
    };
    channel.onmessage = (e: MessageEvent) => {
      if (typeof e.data === "string") {
        if (isOfferer) {
          // 压缩协商回包：对端支持压缩 → 立即按压缩发；不支持 → 立即按不压缩发（不等超时）
          const helloAck = parseHelloAck(e.data);
          if (helloAck.compress !== undefined) {
            if (negotiateTimer) {
              clearTimeout(negotiateTimer);
              negotiateTimer = null;
            }
            if (helloAck.compress && compressionSupported()) {
              negotiatedCompress = true;
              void sendFile(true);
            } else if (!sendStarted) {
              void sendFile(false);
            }
            return;
          }
          // 接收端收齐后的确认（发送端依赖它安全关闭，防丢尾包）
          if (e.data.includes('"t":"ack"')) {
            onComplete();
          }
          return;
        }
        // answerer：对端询问压缩能力 → 回 hello-ack（本端可解压才报支持）
        if (e.data.includes('"t":"hello"')) {
          try {
            dc?.send(JSON.stringify({ t: "hello-ack", compress: compressionSupported() }));
          } catch {
            /* 通道已断则无需回包 */
          }
          return;
        }
        const meta = parseMeta(e.data);
        if (meta) {
          totalBytes = meta.size;
          totalChunks = meta.totalChunks;
          transferCompressed = meta.compress === true;
          if (transferCompressed) diagnose("压缩传输：对端启用分片压缩");
          callbacks.onProgress?.(0, totalBytes, 0);
          return;
        }
        return;
      }
      // 二进制：ArrayBuffer / Buffer(ArrayBufferView) / Blob
      if (e.data instanceof Blob) {
        void e.data.arrayBuffer().then(handleBinary).catch(() => callbacks.onError?.("解析分片失败"));
        return;
      }
      if (e.data instanceof ArrayBuffer) {
        void handleBinary(e.data);
        return;
      }
      if (ArrayBuffer.isView(e.data)) {
        const view = e.data as ArrayBufferView;
        const copy = new Uint8Array(view.byteLength);
        copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
        void handleBinary(copy.buffer as ArrayBuffer);
        return;
      }
    };
    channel.onclose = () => {
      if (!completed) {
        if (isOfferer && allSent) {
          // 数据已全部发出、对端已收齐并正常关闭通道 → 视为传输成功
          onComplete();
        } else {
          callbacks.onError?.("P2P 通道关闭");
        }
      }
      cleanup();
    };
    channel.onerror = () => {
      if (!completed) {
        if (isOfferer && allSent) {
          // 全部数据发出后对端关闭导致的级联错误 → 视为传输成功（数据已收齐）
          onComplete();
        } else {
          callbacks.onError?.("P2P 通道错误");
        }
      }
      cleanup();
    };
  }

  async function handleBinary(raw: ArrayBuffer) {
    const bytes = new Uint8Array(raw);
    let index: number;
    let data: Uint8Array;
    if (transferCompressed) {
      // 压缩传输帧：[index][flag][payload]，flag=1 时 payload 为 deflate-raw 压缩数据
      const p = parseChunkC(bytes);
      index = p.index;
      data = p.compressed ? await decompressChunk(p.data) : p.data;
    } else {
      // 旧格式帧：[index][payload]（与旧版对端兼容）
      const p = parseChunk(bytes);
      index = p.index;
      data = p.data;
    }
    receivedBytes += data.length;
    const percent = totalBytes > 0 ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : 0;
    callbacks.onProgress?.(receivedBytes, totalBytes, percent);
    try {
      await opts.onChunk?.(data, index, totalChunks);
    } catch {
      callbacks.onError?.("接收分片落盘失败");
      cleanup();
      return;
    }
    if (totalChunks > 0 && index + 1 >= totalChunks) {
      // 接收端收齐：先回 ack（发送端等它确认后才安全关闭，防丢尾包），再完成
      try {
        dc?.send(JSON.stringify({ t: "ack" }));
      } catch {
        /* 通道已断则无需确认 */
      }
      onComplete();
    }
  }

  /**
   * 发送端开场（v4.6.4）：开启压缩 → 先 hello 协商（新对端回 hello-ack → 压缩；
   * 旧版对端不回 → 超时后按旧格式不压缩，完全兼容）；未开启 → 直接旧格式发送。
   */
  async function beginSend() {
    if (!dc || completed) return;
    if (compressEnabled) {
      negotiateTimer = setTimeout(() => {
        negotiateTimer = null;
        if (!sendStarted) void sendFile(false);
      }, COMPRESS_NEGOTIATE_TIMEOUT);
      try {
        dc.send(JSON.stringify({ t: "hello", v: 2 }));
      } catch {
        /* 通道异常由 sendFile 兜底 */
      }
    } else {
      await sendFile(false);
    }
  }

  async function sendFile(useCompress: boolean) {
    if (!dc || completed || sendStarted) return;
    sendStarted = true;
    const sendChunk = opts.sendChunk;
    if (!sendChunk || typeof opts.totalBytes !== "number") {
      callbacks.onError?.("发送端缺少 sendChunk/totalBytes");
      cleanup();
      return;
    }
    totalChunks = Math.ceil(opts.totalBytes / chunkSize);
    dc.send(buildMeta(opts.totalBytes, totalChunks, chunkSize, useCompress));
    if (useCompress) diagnose("压缩传输：已启用（协商成功）");
    receivedBytes = opts.totalBytes; // 发送端进度按总量直接完成
    for (let i = 0; i < totalChunks; i++) {
      if (closed || dc.readyState !== "open") {
        callbacks.onError?.("P2P 通道中断");
        cleanup();
        return;
      }
      let data: Uint8Array;
      try {
        data = await sendChunk(i, totalChunks);
      } catch {
        callbacks.onError?.("读取发送分片失败");
        cleanup();
        return;
      }
      if (useCompress) {
        const comp = await compressChunk(data);
        // 压缩后反而更大（已压缩格式如 MP3/FLAC）→ 发原片，保证压缩不劣于不压缩
        const ok = comp.length < data.length;
        dc.send(encodeChunkC(i, ok ? comp : data, ok));
      } else {
        dc.send(encodeChunk(i, data));
      }
    }
    // 全部分片已发出：此后对端关闭通道视为"对端已收齐正常完成"（onclose/onerror 兜底判定成功）
    allSent = true;
    // 发送完成：等接收端 ack 确认收齐（最多 5s）再完成。
    // 发送端立即关闭会导致接收端丢尾包（纯软件栈缓冲未 flush），ack 兜底。
    ackTimer = setTimeout(() => {
      if (!completed) {
        completed = true;
        callbacks.onError?.("P2P 发送未收到接收确认");
        cleanup();
      }
    }, 5_000);
  }

  async function flushBufferedCandidates() {
    while (bufferedCandidates.length) {
      const c = bufferedCandidates.shift()!;
      try {
        await pc.addIceCandidate(c);
      } catch {
        /* 候选已失效（已建连/已关闭）忽略 */
      }
    }
  }

  const controller: PeerConnectionController = {
    peerId: opts.peerId,
    pc,
    close: cleanup,
    onAnswer: async (sdp) => {
      if (sdp && !closed) {
        await pc.setRemoteDescription(sdp);
        await flushBufferedCandidates();
      }
    },
    onIce: async (candidate) => {
      if (candidate && !closed) {
        remoteIceCount++;
        diagnose(`收到对端候选 ${candidate.candidate ?? "(end-of-candidates)"}`);
        // 提取候选类型（原始 SDP 里的 typ 字段），供诊断结论统计
        const typ = / typ (\w+)/.exec(candidate.candidate ?? "");
        if (typ) remoteTypes.push(typ[1]);
        if (pc.remoteDescription) {
          try {
            await pc.addIceCandidate(candidate);
          } catch {
            /* 时序竞态：已建连时忽略 */
          }
        } else {
          // remoteDescription 尚未设置（offer/answer 还在路上）→ 缓冲，
          // setRemoteDescription 成功后 flush，避免关键候选丢失
          bufferedCandidates.push(candidate);
        }
      }
    },
  };

  pc.onicecandidate = (e) => {
    if (e.candidate && !closed) {
      const c = e.candidate;
      diagLocal.push(`本地:${c.type}:${c.protocol}:${c.address}:${c.port}`);
      diagnose(`收集候选 ${c.type} ${c.protocol} ${c.address}:${c.port}`);
      void signal("peer:ice", opts.peerId, { candidate: e.candidate.toJSON() }).catch(() => {});
    }
  };
  pc.onconnectionstatechange = () => {
    diagnose(`连接状态=${pc.connectionState}`);
    if (pc.connectionState === "connected") {
      clearTimeout(timeoutTimer);
      callbacks.onOpen?.();
    } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
      // 连接失败/断开：输出诊断结论（NAT 类型推断），排障打洞失败
      diagnoseConclusion();
    }
  };
  pc.oniceconnectionstatechange = () => {
    diagnose(`ICE 状态=${pc.iceConnectionState}`);
  };

  liveConnections.set(opts.peerId, controller);

  if (isOfferer) {
    const channel = pc.createDataChannel("p2p", { ordered: true });
    wireChannel(channel);
    void (async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await signal("peer:offer", opts.peerId, { sdp: pc.localDescription });
      } catch (e) {
        callbacks.onError?.(`创建 offer 失败: ${String(e)}`);
        cleanup();
      }
    })();
  } else if (incomingOffer) {
    pc.ondatachannel = (e) => wireChannel(e.channel);
    void (async () => {
      try {
        await pc.setRemoteDescription(incomingOffer);
        await flushBufferedCandidates();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await signal("peer:answer", opts.peerId, { sdp: pc.localDescription });
      } catch (e) {
        callbacks.onError?.(`创建 answer 失败: ${String(e)}`);
        cleanup();
      }
    })();
  }

  return controller;
}

/**
 * 处理服务器转发的 peer:* 信令（由 store 的 handleSyncWsEvent 分发调用）。
 * - peer:offer → 有挂起接收则建立应答连接
 * - peer:answer / peer:ice → 路由到活跃连接
 * - peer:bye → 关闭对应连接
 */
export function handlePeerSignal(evt: Record<string, unknown>): void {
  const type = evt.type as P2PSignalType;
  const from = typeof evt.from_user_id === "string" ? evt.from_user_id : "";
  if (!from) return;
  const sdp = evt.sdp as RTCSessionDescriptionInit | undefined;
  const candidate = evt.candidate as RTCIceCandidateInit | undefined;

  switch (type) {
    case "peer:offer": {
      // 优先精确匹配发起者；否则回退到"当前唯一挂起的接收"。
      // 服务器选持有者优先 DJ 但不保证是 DJ（_pick_song_holder 可能选任一成员），
      // 此时 offer 的 from_user_id ≠ 听众挂起的 djUserId → 精确匹配不到 → 用唯一挂起兜底，
      // 否则 offer 被忽略、8s 后回退服务器中转（v4.6.0-beta 实测 P2P 形同虚设的根因之一）。
      let opts = pendingReceivers.get(from);
      if (!opts && pendingReceivers.size === 1) {
        const only = pendingReceivers.values().next().value;
        if (only) {
          opts = only;
          pendingReceivers.delete(only.peerId);
        }
      }
      if (!opts) {
        console.warn("[P2P] 收到 peer:offer 但无挂起接收，忽略:", from);
        return; // 没有挂起的接收 → 忽略
      }
      pendingReceivers.delete(from);
      try {
        const controller = establishConnection(opts, opts.callbacks ?? {}, sdp);
        liveConnections.set(from, controller);
        // 注入早于 offer 到达的候选（trickle ICE 竞态修复：否则关键 srflx 候选丢失）
        const buffered = earlyCandidates.get(from);
        if (buffered && buffered.length) {
          earlyCandidates.delete(from);
          for (const c of buffered) void controller.onIce(c);
        }
      } catch (e) {
        opts.callbacks?.onError?.(`P2P 建连失败: ${String(e)}`);
      }
      break;
    }
    case "peer:answer": {
      void liveConnections.get(from)?.onAnswer(sdp);
      break;
    }
    case "peer:ice": {
      const conn = liveConnections.get(from);
      if (conn) {
        void conn.onIce(candidate);
      } else if (candidate) {
        // 连接尚未建立（offer 可能还在路上）→ 缓冲，offer 建连后统一注入
        const arr = earlyCandidates.get(from) ?? [];
        arr.push(candidate);
        earlyCandidates.set(from, arr);
      }
      break;
    }
    case "peer:bye": {
      liveConnections.get(from)?.close();
      liveConnections.delete(from);
      earlyCandidates.delete(from);
      break;
    }
    default:
      break;
  }
}

// ── P2P 连通性测试工具（Phase 1.2+，设置面板"P2P 测试工具"）──
// 发起方推 2MB 测试数据测速（offerer）；目标端自动挂起接收（answerer），
// 测完回传 p2p:test_result 给发起方。信令复用 peer:* + p2p_signal，无新协议。

/** P2P 测试传输量：2MB（够测速、够短） */
const P2P_TEST_BYTES = 2 * 1024 * 1024;
const P2P_TEST_CHUNK_SIZE = 64 * 1024;

export interface P2PTestOptions {
  /** 测试数据字节数（默认 2MB） */
  bytes?: number;
  /** 单片字节数（默认 64KB） */
  chunkSize?: number;
  stunUrls?: string[];
  /** 建连超时（默认 12s） */
  timeoutMs?: number;
  signal?: (
    type: P2PSignalType,
    toUserId: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
  onOpen?: () => void;
  onProgress?: (percent: number) => void;
  onComplete?: (stats: { bytes: number; ms: number; speedBps: number }) => void;
  onError?: (err: string) => void;
  /** 诊断回调：ICE 候选/状态变化（P2P 面板直接展示，排障打洞失败） */
  onDiagnose?: (info: string) => void;
}

/**
 * 目标端回传结果的处理回调（发起方注册，收到 p2p:test_result 时被调用）。
 * 由 music store 的 handleSyncWsEvent 路由（目标端回传 → 服务器 → 发起方 ws-event）。
 */
let testResultHandler: ((result: {
  fromUserId: string;
  fromUsername: string;
  ok: boolean;
  ms: number;
  speedBps: number;
  bytes: number;
  error: string | null;
}) => void) | null = null;

/** 注册/清除测试结果处理器（P2PTestPanel 挂载时注册，卸载时清除） */
export function setP2PTestResultHandler(
  handler: typeof testResultHandler,
): void {
  testResultHandler = handler;
}

/** 由 handleSyncWsEvent 调用：目标端回传结果 → 转发给已注册的发起方 UI */
export function dispatchP2PTestResult(evt: Record<string, unknown>): void {
  testResultHandler?.({
    fromUserId: typeof evt.from_user_id === "string" ? evt.from_user_id : "",
    fromUsername: typeof evt.from_username === "string" ? evt.from_username : "",
    ok: evt.ok === true,
    ms: Number(evt.ms ?? 0),
    speedBps: Number(evt.speed_bps ?? 0),
    bytes: Number(evt.bytes ?? 0),
    error: typeof evt.error === "string" && evt.error ? evt.error : null,
  });
}

/** 发起方：推测试数据并测速（offerer，跨 NAT 打洞直连） */
export function p2pStartTest(peerId: string, opts: P2PTestOptions = {}): P2PHandle {
  const bytes = opts.bytes ?? P2P_TEST_BYTES;
  const chunkSize = opts.chunkSize ?? P2P_TEST_CHUNK_SIZE;
  const zeroChunk = new Uint8Array(chunkSize);
  return p2pSend({
    peerId,
    role: "offerer",
    totalBytes: bytes,
    chunkSize,
    timeoutMs: opts.timeoutMs ?? 12_000,
    stunUrls: opts.stunUrls,
    signal: opts.signal,
    onDiagnose: opts.onDiagnose,
    sendChunk: async () => zeroChunk,
    callbacks: {
      onOpen: () => opts.onOpen?.(),
      onProgress: (_received, _total, percent) => opts.onProgress?.(percent),
      onComplete: (stats) => opts.onComplete?.(stats),
      onError: (err) => opts.onError?.(err),
    },
  });
}

/** 目标端：自动挂起接收测试数据（answerer，测试完成后由调用方回传 p2p:test_result） */
export function p2pAcceptTest(fromUserId: string, opts: P2PTestOptions = {}): P2PHandle {
  return p2pReceive({
    peerId: fromUserId,
    role: "answerer",
    timeoutMs: opts.timeoutMs ?? 12_000,
    stunUrls: opts.stunUrls,
    signal: opts.signal,
    onDiagnose: opts.onDiagnose,
    onChunk: async () => {},
    callbacks: {
      onOpen: () => opts.onOpen?.(),
      onProgress: (_received, _total, percent) => opts.onProgress?.(percent),
      onComplete: (stats) => opts.onComplete?.(stats),
      onError: (err) => opts.onError?.(err),
    },
  });
}
