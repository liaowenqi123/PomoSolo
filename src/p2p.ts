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
  /** 建连超时（默认 8s，超时回调 onError 并关闭） */
  timeoutMs?: number;
  /** 信令发送（默认走 Tauri invoke p2p_signal；测试注入假实现） */
  signal?: (type: P2PSignalType, toUserId: string, payload: Record<string, unknown>) => Promise<void>;
  callbacks?: P2PTransferCallbacks;
}

export interface P2PHandle {
  close: () => void;
}

const DEFAULT_STUN = ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"];
const DEFAULT_CHUNK_SIZE = 128 * 1024;
const DEFAULT_TIMEOUT_MS = 8_000;

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

export interface ChunkMeta {
  size: number;
  totalChunks: number;
  chunkSize: number;
}

/** 构建 meta 控制消息（JSON 字符串） */
export function buildMeta(size: number, totalChunks: number, chunkSize: number): string {
  return JSON.stringify({ t: "meta", size, totalChunks, chunkSize });
}

/** 解析 meta 控制消息 */
export function parseMeta(text: string): ChunkMeta | null {
  try {
    const o = JSON.parse(text);
    if (o && o.t === "meta" && typeof o.size === "number" && typeof o.totalChunks === "number") {
      return { size: o.size, totalChunks: o.totalChunks, chunkSize: o.chunkSize ?? 0 };
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
  const timeoutTimer = setTimeout(() => {
    if (!completed && pc.connectionState !== "connected") {
      timedOut = true;
      callbacks.onError?.(`P2P 建连超时（${opts.peerId}）`);
      cleanup();
    }
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const signal = opts.signal ?? defaultSignal;

  function cleanup() {
    if (closed) return;
    closed = true;
    clearTimeout(timeoutTimer);
    if (ackTimer) clearTimeout(ackTimer);
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
    cleanup();
  }

  function wireChannel(channel: RTCDataChannel) {
    dc = channel;
    channel.onopen = () => {
      if (isOfferer) {
        void sendFile();
      }
    };
    channel.onmessage = (e: MessageEvent) => {
      if (typeof e.data === "string") {
        const meta = parseMeta(e.data);
        if (meta) {
          totalBytes = meta.size;
          totalChunks = meta.totalChunks;
          callbacks.onProgress?.(0, totalBytes, 0);
          return;
        }
        // 接收端收齐后的确认（发送端依赖它安全关闭，防丢尾包）
        if (isOfferer && e.data.includes('"t":"ack"')) {
          onComplete();
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
        callbacks.onError?.("P2P 通道关闭");
      }
      cleanup();
    };
    channel.onerror = () => {
      callbacks.onError?.("P2P 通道错误");
      cleanup();
    };
  }

  async function handleBinary(raw: ArrayBuffer) {
    const bytes = new Uint8Array(raw);
    const { index, data } = parseChunk(bytes);
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

  async function sendFile() {
    if (!dc || completed) return;
    const sendChunk = opts.sendChunk;
    if (!sendChunk || typeof opts.totalBytes !== "number") {
      callbacks.onError?.("发送端缺少 sendChunk/totalBytes");
      cleanup();
      return;
    }
    totalChunks = Math.ceil(opts.totalBytes / chunkSize);
    dc.send(buildMeta(opts.totalBytes, totalChunks, chunkSize));
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
      dc.send(encodeChunk(i, data));
    }
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

  const controller: PeerConnectionController = {
    peerId: opts.peerId,
    pc,
    close: cleanup,
    onAnswer: async (sdp) => {
      if (sdp && !closed) {
        await pc.setRemoteDescription(sdp);
      }
    },
    onIce: async (candidate) => {
      if (candidate && !closed) {
        try {
          await pc.addIceCandidate(candidate);
        } catch {
          /* 时序竞态：已建连时忽略 */
        }
      }
    },
  };

  pc.onicecandidate = (e) => {
    if (e.candidate && !closed) {
      void signal("peer:ice", opts.peerId, { candidate: e.candidate.toJSON() }).catch(() => {});
    }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "connected") {
      clearTimeout(timeoutTimer);
    }
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
      const opts = pendingReceivers.get(from);
      if (!opts) return; // 没有挂起的接收 → 忽略
      pendingReceivers.delete(from);
      try {
        const controller = establishConnection(opts, opts.callbacks ?? {}, sdp);
        liveConnections.set(from, controller);
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
      void liveConnections.get(from)?.onIce(candidate);
      break;
    }
    case "peer:bye": {
      liveConnections.get(from)?.close();
      liveConnections.delete(from);
      break;
    }
    default:
      break;
  }
}
