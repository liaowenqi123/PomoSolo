/**
 * p2p.ts 模块测试（Phase 0）
 *
 * jsdom 无 RTCPeerConnection，WebRTC 建连/传输实测走 Docker + Node wrtc
 * （scripts/p2p-test/ 双端打洞测试）。此处覆盖纯协议函数与信令路由逻辑。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  encodeChunk,
  parseChunk,
  encodeChunkC,
  parseChunkC,
  buildMeta,
  parseMeta,
  compressChunk,
  decompressChunk,
  p2pReceive,
  p2pSend,
  handlePeerSignal,
} from "@/p2p";

describe("p2p 分片协议", () => {
  it("encodeChunk 写入大端 index + 数据", () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const buf = encodeChunk(258, data); // 0x102
    expect(buf.length).toBe(4 + 5);
    expect(new DataView(buf.buffer).getUint32(0)).toBe(258);
    expect(Array.from(buf.slice(4))).toEqual([1, 2, 3, 4, 5]);
  });

  it("parseChunk 还原 index 与数据（支持偏移视图）", () => {
    const data = new Uint8Array([9, 8, 7]);
    const buf = encodeChunk(0, data);
    const { index, data: out } = parseChunk(buf);
    expect(index).toBe(0);
    expect(Array.from(out)).toEqual([9, 8, 7]);
  });

  it("encode/parse 往返一致", () => {
    const payload = new Uint8Array(100).map((_, i) => i % 256);
    const { index, data } = parseChunk(encodeChunk(42, payload));
    expect(index).toBe(42);
    expect(Array.from(data)).toEqual(Array.from(payload));
  });

  it("encodeChunkC 写入大端 index + 压缩标志 + 数据", () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const buf = encodeChunkC(258, data, true); // 0x102, 压缩
    expect(buf.length).toBe(5 + 5);
    expect(new DataView(buf.buffer).getUint32(0)).toBe(258);
    expect(buf[4]).toBe(1);
    expect(Array.from(buf.slice(5))).toEqual([1, 2, 3, 4, 5]);
    // 未压缩标志 = 0
    const raw = encodeChunkC(1, data, false);
    expect(raw[4]).toBe(0);
  });

  it("parseChunkC 还原 index / 压缩标志 / 数据（压缩传输帧）", () => {
    const data = new Uint8Array([9, 8, 7]);
    const { index, compressed, data: out } = parseChunkC(encodeChunkC(42, data, true));
    expect(index).toBe(42);
    expect(compressed).toBe(true);
    expect(Array.from(out)).toEqual([9, 8, 7]);
    const raw = parseChunkC(encodeChunkC(7, data, false));
    expect(raw.compressed).toBe(false);
  });

  it("compressChunk/decompressChunk deflate-raw 往返一致（环境不支持时原样返回）", async () => {
    if (typeof CompressionStream === "undefined") return; // Node 18+/WebView2 才支持
    const payload = new Uint8Array(64 * 1024).map((_, i) => i % 8); // 高度可压缩
    const comp = await compressChunk(payload);
    if (comp.length >= payload.length) {
      // jsdom 下 Blob.stream() 可能不可用 → 走原样兜底（真实 Chromium/Node 环境才生效）
      expect(Array.from(comp)).toEqual(Array.from(payload));
      return;
    }
    expect(comp.length).toBeLessThan(payload.length);
    const out = await decompressChunk(comp);
    expect(Array.from(out)).toEqual(Array.from(payload));
  });
});

describe("p2p meta 控制消息", () => {
  it("buildMeta/parseMeta 往返一致", () => {
    const text = buildMeta(1024 * 1024, 8, 128 * 1024);
    const meta = parseMeta(text);
    expect(meta).toEqual({ size: 1024 * 1024, totalChunks: 8, chunkSize: 128 * 1024, compress: false });
  });

  it("buildMeta 带压缩标志 → parseMeta 识别 compress", () => {
    const text = buildMeta(1024 * 1024, 8, 128 * 1024, true);
    const meta = parseMeta(text);
    expect(meta?.compress).toBe(true);
    // 旧版对端可正常解析（忽略未知 compress 字段）
    expect(parseMeta(text)).toEqual({ size: 1024 * 1024, totalChunks: 8, chunkSize: 128 * 1024, compress: true });
  });

  it("parseMeta 拒绝非 meta 消息", () => {
    expect(parseMeta("hello")).toBeNull();
    expect(parseMeta("{}")).toBeNull();
    expect(parseMeta('{"t":"other"}')).toBeNull();
    expect(parseMeta("not json")).toBeNull();
  });

  it("buildMeta/parseMeta 带 baseChunk（v4.7.7 多连接并行分段传输）", () => {
    // 并行连接 k 的 meta 声明全局起始分片序号 baseChunk，接收端据此映射回全局 index 落盘
    const text = buildMeta(6, 2, 3, false, 10); // 全局起始 index 10，本段 2 片
    const meta = parseMeta(text);
    expect(meta?.baseChunk).toBe(10);
    expect(meta?.totalChunks).toBe(2);
    // 缺省 baseChunk=0 → meta 不带该字段（单连接整文件，向后兼容），解析回 0
    expect((parseMeta(buildMeta(6, 2, 3))?.baseChunk ?? 0)).toBe(0);
  });

  it("buildMeta/parseMeta 带 globalChunks（v4.7.8 并行段声明文件全局总数）", () => {
    // 并行连接 k 的 meta 同时声明文件全局分片总数（各段同一值），接收端据此"收齐即完成"
    const text = buildMeta(6, 2, 3, false, 10, 20); // 全局起始 10、本段 2 片、文件共 20 片
    const meta = parseMeta(text);
    expect(meta?.baseChunk).toBe(10);
    expect(meta?.globalChunks).toBe(20);
    // 缺省 globalChunks=0 → meta 不带该字段（旧持有端/单连接），解析回 0
    expect((parseMeta(buildMeta(6, 2, 3, false, 10))?.globalChunks ?? 0)).toBe(0);
  });
});

describe("p2p 信令路由", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    // 清空挂起接收，避免跨用例污染
    vi.unstubAllGlobals();
  });

  it("handlePeerSignal 忽略无 from_user_id 的消息", () => {
    expect(() => handlePeerSignal({ type: "peer:offer", sdp: {} })).not.toThrow();
    expect(() => handlePeerSignal({ type: "unknown" })).not.toThrow();
  });

  it("peer:offer 到达有挂起接收时移除挂起项，peer:bye 关闭连接", async () => {
    // 挂起接收 + 伪造全局 RTCPeerConnection（建连部分在 Node 实测，这里只验证路由状态）
    const closeSpy = vi.fn();
    const fakePc = {
      close: closeSpy,
      setRemoteDescription: vi.fn().mockResolvedValue(undefined),
      createAnswer: vi.fn().mockResolvedValue({ type: "answer", sdp: "x" }),
      setLocalDescription: vi.fn().mockResolvedValue(undefined),
      ondatachannel: null,
      onicecandidate: null,
      onconnectionstatechange: null,
      connectionState: "new",
    };
    vi.stubGlobal(
      "RTCPeerConnection",
      vi.fn().mockImplementation(() => fakePc),
    );
    const signal = vi.fn().mockResolvedValue(undefined);
    const handle = p2pReceive({
      peerId: "peer-A",
      role: "answerer",
      onChunk: vi.fn(),
      signal,
    });
    // 有挂起 → offer 被消费，不再抛错（建连回调走 stub）
    expect(() =>
      handlePeerSignal({ type: "peer:offer", from_user_id: "peer-A", sdp: { type: "offer" } }),
    ).not.toThrow();
    // answerer 应答流程异步发 peer:answer
    await vi.waitFor(() => expect(signal).toHaveBeenCalled());
    handle.close();
    // 再次到达（无挂起）→ 静默忽略
    expect(() =>
      handlePeerSignal({ type: "peer:offer", from_user_id: "peer-A", sdp: { type: "offer" } }),
    ).not.toThrow();
    // peer:bye 关闭活跃连接（清理定时器）
    handlePeerSignal({ type: "peer:bye", from_user_id: "peer-A" });
    expect(closeSpy).toHaveBeenCalled();
  });

  it("p2pReceive 重复注册同一 peerId 时替换旧挂起项", () => {
    const a = p2pReceive({ peerId: "x", role: "answerer", signal: vi.fn().mockResolvedValue(undefined) });
    const b = p2pReceive({ peerId: "x", role: "answerer", signal: vi.fn().mockResolvedValue(undefined) });
    expect(() =>
      handlePeerSignal({ type: "peer:offer", from_user_id: "x", sdp: { type: "offer" } }),
    ).not.toThrow();
    a.close();
    b.close();
  });

  it("offer 发起者与挂起 key 不匹配时（持有者≠DJ），唯一挂起项兜底接受（v4.6.0 修复）", async () => {
    // 场景：服务器 _pick_song_holder 选了非 DJ 的持有者 → offer 的 from_user_id ≠ 挂起的 djUserId。
    // 精确匹配不到但只有一个挂起接收 → 用该挂起项建连，避免 offer 被忽略导致 P2P 形同虚设。
    const closeSpy = vi.fn();
    const fakePc = {
      close: closeSpy,
      setRemoteDescription: vi.fn().mockResolvedValue(undefined),
      createAnswer: vi.fn().mockResolvedValue({ type: "answer", sdp: "x" }),
      setLocalDescription: vi.fn().mockResolvedValue(undefined),
      ondatachannel: null,
      onicecandidate: null,
      onconnectionstatechange: null,
      connectionState: "new",
    };
    vi.stubGlobal(
      "RTCPeerConnection",
      vi.fn().mockImplementation(() => fakePc),
    );
    const signal = vi.fn().mockResolvedValue(undefined);
    const onOpen = vi.fn();
    const handle = p2pReceive({
      peerId: "dj-user-id", // 挂起 key 是 DJ 的 user_id
      role: "answerer",
      onChunk: vi.fn(),
      signal,
      callbacks: { onOpen },
    });
    // 持有者并非 DJ：from_user_id = "holder-user-id" ≠ "dj-user-id"
    expect(() =>
      handlePeerSignal({
        type: "peer:offer",
        from_user_id: "holder-user-id",
        sdp: { type: "offer" },
      }),
    ).not.toThrow();
    // 唯一挂起项被消费 → 应答流程发起
    await vi.waitFor(() => expect(signal).toHaveBeenCalled());
    handle.close();
    // 挂起表已清空：后续无挂起 offer 静默忽略
    expect(() =>
      handlePeerSignal({ type: "peer:offer", from_user_id: "holder-user-id", sdp: { type: "offer" } }),
    ).not.toThrow();
    expect(closeSpy).not.toHaveBeenCalled(); // 新 offer 未建连
  });

  it("peer:ice 早于 offer 到达时缓冲，offer 建连后注入（关键 srflx 候选不丢失）", async () => {
    // 跨 NAT 打洞根因修复：offerer 的候选可能先于 peer:offer 到达 answerer，
    // v4.6.0 前 liveConnections 无此键直接丢弃 → 关键 srflx 候选丢失 → 打洞失败。
    const addIce = vi.fn().mockResolvedValue(undefined);
    const fakePc = {
      remoteDescription: null as RTCSessionDescriptionInit | null,
      addIceCandidate: addIce,
      close: vi.fn(),
      setRemoteDescription: vi.fn().mockImplementation(async () => {
        fakePc.remoteDescription = { type: "offer" };
      }),
      createAnswer: vi.fn().mockResolvedValue({ type: "answer", sdp: "x" }),
      setLocalDescription: vi.fn().mockResolvedValue(undefined),
      ondatachannel: null,
      onicecandidate: null,
      onconnectionstatechange: null,
      connectionState: "new",
    };
    vi.stubGlobal(
      "RTCPeerConnection",
      vi.fn().mockImplementation(() => fakePc),
    );
    const signal = vi.fn().mockResolvedValue(undefined);
    p2pReceive({ peerId: "peer-A", role: "answerer", onChunk: vi.fn(), signal });
    // 候选先到：liveConnections 尚无连接 → 缓冲而非丢弃
    handlePeerSignal({
      type: "peer:ice",
      from_user_id: "peer-A",
      candidate: { candidate: "srflx 1.2.3.4:9000", sdpMid: "0", sdpMLineIndex: 0 },
    });
    // offer 到达 → 建连 → 缓冲候选注入，最终 addIceCandidate 收到
    handlePeerSignal({ type: "peer:offer", from_user_id: "peer-A", sdp: { type: "offer" } });
    await vi.waitFor(() =>
      expect(addIce).toHaveBeenCalledWith(expect.objectContaining({ candidate: "srflx 1.2.3.4:9000" })),
    );
  });

  it("remoteDescription 未设置时的候选缓冲，setRemoteDescription 后统一 flush", async () => {
    // 连接已建但 offer/answer 尚未 settle：addIceCandidate 此时抛 InvalidStateError，
    // 不能吞掉候选，应缓冲到 setRemoteDescription 成功后注入。
    const addIce = vi.fn().mockResolvedValue(undefined);
    const fakePc = {
      remoteDescription: null, // 保持 null：模拟 remoteDescription 尚未设置
      addIceCandidate: addIce,
      close: vi.fn(),
      setRemoteDescription: vi.fn().mockResolvedValue(undefined),
      createAnswer: vi.fn().mockResolvedValue({ type: "answer", sdp: "x" }),
      setLocalDescription: vi.fn().mockResolvedValue(undefined),
      ondatachannel: null,
      onicecandidate: null,
      onconnectionstatechange: null,
      connectionState: "new",
    };
    vi.stubGlobal(
      "RTCPeerConnection",
      vi.fn().mockImplementation(() => fakePc),
    );
    const signal = vi.fn().mockResolvedValue(undefined);
    const handle = p2pReceive({ peerId: "peer-B", role: "answerer", onChunk: vi.fn(), signal });
    handlePeerSignal({ type: "peer:offer", from_user_id: "peer-B", sdp: { type: "offer" } });
    // offer 建连后、remoteDescription 设置前到达的候选 → 缓冲而非丢弃
    handlePeerSignal({
      type: "peer:ice",
      from_user_id: "peer-B",
      candidate: { candidate: "srflx 9.9.9.9:3478", sdpMid: "0", sdpMLineIndex: 0 },
    });
    await vi.waitFor(() =>
      expect(addIce).toHaveBeenCalledWith(expect.objectContaining({ candidate: "srflx 9.9.9.9:3478" })),
    );
    handlePeerSignal({ type: "peer:bye", from_user_id: "peer-B" });
    handle.close();
  });

  it("offer 发起者不匹配且存在多个挂起时不做兜底（避免误配对）", async () => {
    const fakePc = {
      close: vi.fn(),
      setRemoteDescription: vi.fn().mockResolvedValue(undefined),
      createAnswer: vi.fn().mockResolvedValue({ type: "answer", sdp: "x" }),
      setLocalDescription: vi.fn().mockResolvedValue(undefined),
      ondatachannel: null,
      onicecandidate: null,
      onconnectionstatechange: null,
      connectionState: "new",
    };
    vi.stubGlobal(
      "RTCPeerConnection",
      vi.fn().mockImplementation(() => fakePc),
    );
    const a = p2pReceive({ peerId: "peer-A", role: "answerer", signal: vi.fn().mockResolvedValue(undefined) });
    const b = p2pReceive({ peerId: "peer-B", role: "answerer", signal: vi.fn().mockResolvedValue(undefined) });
    // 两个挂起 + offer 来自第三方 → 不兜底（保持原忽略行为）
    expect(() =>
      handlePeerSignal({ type: "peer:offer", from_user_id: "peer-C", sdp: { type: "offer" } }),
    ).not.toThrow();
    a.close();
    b.close();
  });

  it("发送端发完数据后等接收端 ack 才完成（防丢尾包）", async () => {
    // 伪造 DataChannel：手动触发 open / 注入 ack 消息
    const sent: unknown[] = [];
    let openHandler: (() => void) | null = null;
    let msgHandler: ((e: { data: unknown }) => void) | null = null;
    const fakeChannel = {
      send: (d: unknown) => void sent.push(d),
      readyState: "open",
      bufferedAmount: 0,
      close: vi.fn(),
      set onopen(fn: (() => void) | null) {
        openHandler = fn;
      },
      get onopen() {
        return openHandler;
      },
      set onmessage(fn: ((e: { data: unknown }) => void) | null) {
        msgHandler = fn;
      },
      get onmessage() {
        return msgHandler;
      },
    };
    const fakePc = {
      close: vi.fn(),
      createDataChannel: vi.fn().mockReturnValue(fakeChannel),
      createOffer: vi.fn().mockResolvedValue({ type: "offer", sdp: "x" }),
      setLocalDescription: vi.fn().mockResolvedValue(undefined),
      onicecandidate: null,
      onconnectionstatechange: null,
      connectionState: "connected",
    };
    vi.stubGlobal(
      "RTCPeerConnection",
      vi.fn().mockImplementation(() => fakePc),
    );
    const onComplete = vi.fn();
    const onError = vi.fn();
    const sendChunk = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    p2pSend({
      peerId: "peer-A",
      role: "offerer",
      totalBytes: 3,
      chunkSize: 3,
      sendChunk,
      signal: vi.fn().mockResolvedValue(undefined),
      callbacks: { onComplete, onError },
    });
    // 触发 open → 开始发送（meta + 1 片）
    await vi.waitFor(() => expect(openHandler).toBeTruthy());
    openHandler!();
    await vi.waitFor(() => expect(sent.length).toBe(2));
    // 尚未收到 ack → onComplete 未触发
    expect(onComplete).not.toHaveBeenCalled();
    // 接收端回 ack → 发送端安全完成
    msgHandler!({ data: JSON.stringify({ t: "ack" }) });
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onError).not.toHaveBeenCalled();
  });

  it("接收端收齐最后一篇时回 ack 并触发完成", async () => {
    const sent: unknown[] = [];
    let dcHandler: ((e: { channel: unknown }) => void) | null = null;
    let msgHandler: ((e: { data: unknown }) => void) | null = null;
    const fakeChannel = {
      send: (d: unknown) => void sent.push(d),
      readyState: "open",
      bufferedAmount: 0,
      close: vi.fn(),
      set onmessage(fn: ((e: { data: unknown }) => void) | null) {
        msgHandler = fn;
      },
      get onmessage() {
        return msgHandler;
      },
    };
    const fakePc = {
      close: vi.fn(),
      setRemoteDescription: vi.fn().mockResolvedValue(undefined),
      createAnswer: vi.fn().mockResolvedValue({ type: "answer", sdp: "x" }),
      setLocalDescription: vi.fn().mockResolvedValue(undefined),
      set ondatachannel(fn: ((e: { channel: unknown }) => void) | null) {
        dcHandler = fn;
      },
      get ondatachannel() {
        return dcHandler;
      },
      onicecandidate: null,
      onconnectionstatechange: null,
      connectionState: "new",
    };
    vi.stubGlobal(
      "RTCPeerConnection",
      vi.fn().mockImplementation(() => fakePc),
    );
    const onComplete = vi.fn();
    const onChunk = vi.fn().mockResolvedValue(undefined);
    p2pReceive({
      peerId: "peer-A",
      role: "answerer",
      onChunk,
      signal: vi.fn().mockResolvedValue(undefined),
      callbacks: { onComplete },
    });
    handlePeerSignal({ type: "peer:offer", from_user_id: "peer-A", sdp: { type: "offer" } });
    await vi.waitFor(() => expect(dcHandler).toBeTruthy());
    dcHandler!({ channel: fakeChannel });
    // 先收 meta，再收最后一片（index 0 + totalChunks 1）
    msgHandler!({ data: buildMeta(3, 1, 3) });
    msgHandler!({ data: encodeChunk(0, new Uint8Array([1, 2, 3])) });
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    // 收齐后回 ack（发送端等它安全关闭）
    expect(sent.some((d) => typeof d === "string" && d.includes('"t":"ack"'))).toBe(true);
  });

  it("并行分段：接收端 onChunk 携带 baseChunk（v4.7.7 映射回全局 index 落盘）", async () => {
    // 多连接并行传输：本连接 meta.baseChunk=10（全局起始片），帧 index 为段内局部序号，
    // 接收端 onChunk 第 4 参收到 baseChunk，据此算出全局 index 落盘。
    const sent: unknown[] = [];
    let dcHandler: ((e: { channel: unknown }) => void) | null = null;
    let msgHandler: ((e: { data: unknown }) => void) | null = null;
    const fakeChannel = {
      send: (d: unknown) => void sent.push(d),
      readyState: "open",
      bufferedAmount: 0,
      close: vi.fn(),
      set onmessage(fn: ((e: { data: unknown }) => void) | null) {
        msgHandler = fn;
      },
      get onmessage() {
        return msgHandler;
      },
    };
    const fakePc = {
      close: vi.fn(),
      setRemoteDescription: vi.fn().mockResolvedValue(undefined),
      createAnswer: vi.fn().mockResolvedValue({ type: "answer", sdp: "x" }),
      setLocalDescription: vi.fn().mockResolvedValue(undefined),
      set ondatachannel(fn: ((e: { channel: unknown }) => void) | null) {
        dcHandler = fn;
      },
      get ondatachannel() {
        return dcHandler;
      },
      onicecandidate: null,
      onconnectionstatechange: null,
      connectionState: "new",
    };
    vi.stubGlobal(
      "RTCPeerConnection",
      vi.fn().mockImplementation(() => fakePc),
    );
    const onChunk = vi.fn().mockResolvedValue(undefined);
    p2pReceive({
      peerId: "peer-A",
      role: "answerer",
      tag: "p1", // 并行连接 tag
      onChunk,
      signal: vi.fn().mockResolvedValue(undefined),
    });
    handlePeerSignal({ type: "peer:offer", from_user_id: "peer-A", tag: "p1", sdp: { type: "offer" } });
    await vi.waitFor(() => expect(dcHandler).toBeTruthy());
    dcHandler!({ channel: fakeChannel });
    // meta 带 baseChunk=10，本段 2 片；帧 index 为段内局部 0/1
    msgHandler!({ data: buildMeta(6, 2, 3, false, 10) });
    msgHandler!({ data: encodeChunk(0, new Uint8Array([1, 2, 3])) });
    msgHandler!({ data: encodeChunk(1, new Uint8Array([4, 5, 6])) });
    await vi.waitFor(() => expect(onChunk).toHaveBeenCalledTimes(2));
    // onChunk(chunk, 段内index, 段total, baseChunk)：base=10 → 全局 index = 10/11
    expect(onChunk).toHaveBeenNthCalledWith(1, expect.any(Uint8Array), 0, 2, 10);
    expect(onChunk).toHaveBeenNthCalledWith(2, expect.any(Uint8Array), 1, 2, 10);
  });

  it("reverse：answerer+sender 在收到的 channel 上发数据（v4.7.5 解耦）", async () => {
    // 下载端正常方向打不通 → reverse：持有端作 answerer 拿到 DataChannel 后发数据。
    // 验证发送逻辑按 isSender 判定（sender:"answerer" → 非 offerer 也 send）。
    const sent: unknown[] = [];
    let dcHandler: ((e: { channel: unknown }) => void) | null = null;
    let openHandler: (() => void) | null = null;
    const fakeChannel = {
      send: (d: unknown) => void sent.push(d),
      readyState: "open",
      bufferedAmount: 0,
      close: vi.fn(),
      set onopen(fn: (() => void) | null) {
        openHandler = fn;
      },
      get onopen() {
        return openHandler;
      },
    };
    const fakePc = {
      close: vi.fn(),
      setRemoteDescription: vi.fn().mockResolvedValue(undefined),
      createAnswer: vi.fn().mockResolvedValue({ type: "answer", sdp: "x" }),
      setLocalDescription: vi.fn().mockResolvedValue(undefined),
      set ondatachannel(fn: ((e: { channel: unknown }) => void) | null) {
        dcHandler = fn;
      },
      get ondatachannel() {
        return dcHandler;
      },
      onicecandidate: null,
      onconnectionstatechange: null,
      connectionState: "new",
    };
    vi.stubGlobal(
      "RTCPeerConnection",
      vi.fn().mockImplementation(() => fakePc),
    );
    const sendChunk = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    p2pReceive({
      peerId: "peer-A",
      role: "answerer",
      sender: "answerer", // reverse：持有端（answerer）发数据
      totalBytes: 3,
      chunkSize: 3,
      sendChunk,
      signal: vi.fn().mockResolvedValue(undefined),
    });
    handlePeerSignal({ type: "peer:offer", from_user_id: "peer-A", sdp: { type: "offer" } });
    await vi.waitFor(() => expect(dcHandler).toBeTruthy());
    dcHandler!({ channel: fakeChannel });
    // channel open → answerer 侧按 isSender 判定主动发数据（meta + 分片）
    await vi.waitFor(() => expect(openHandler).toBeTruthy());
    openHandler!();
    await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(2));
    expect(sendChunk).toHaveBeenCalled();
    // 首条为 meta 控制消息
    expect(JSON.parse(sent[0] as string).t).toBe("meta");
  });

  it("reverse：offerer+sender:answerer 只打洞不主动发数据，收片照常完成（v4.7.5 解耦）", async () => {
    // 下载端作 offerer 反向打洞，但数据由对端（answerer+sender）发出。
    // 验证本端 onopen 不 beginSend（isSender=false），收到分片后照常回 ack + 完成。
    const sent: unknown[] = [];
    let msgHandler: ((e: { data: unknown }) => void) | null = null;
    let openHandler: (() => void) | null = null;
    const fakeChannel = {
      send: (d: unknown) => void sent.push(d),
      readyState: "open",
      bufferedAmount: 0,
      close: vi.fn(),
      set onopen(fn: (() => void) | null) {
        openHandler = fn;
      },
      get onopen() {
        return openHandler;
      },
      set onmessage(fn: ((e: { data: unknown }) => void) | null) {
        msgHandler = fn;
      },
      get onmessage() {
        return msgHandler;
      },
    };
    const fakePc = {
      close: vi.fn(),
      createDataChannel: vi.fn().mockReturnValue(fakeChannel),
      createOffer: vi.fn().mockResolvedValue({ type: "offer", sdp: "x" }),
      setLocalDescription: vi.fn().mockResolvedValue(undefined),
      onicecandidate: null,
      onconnectionstatechange: null,
      connectionState: "connected",
    };
    vi.stubGlobal(
      "RTCPeerConnection",
      vi.fn().mockImplementation(() => fakePc),
    );
    const onComplete = vi.fn();
    const sendChunk = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    p2pSend({
      peerId: "peer-A",
      role: "offerer",
      sender: "answerer", // reverse：本机作 offerer 但只收不发
      totalBytes: 3,
      chunkSize: 3,
      sendChunk,
      signal: vi.fn().mockResolvedValue(undefined),
      onChunk: vi.fn().mockResolvedValue(undefined),
      callbacks: { onComplete },
    });
    await vi.waitFor(() => expect(openHandler).toBeTruthy());
    openHandler!();
    // open 不触发发送：无 meta/分片发出，sendChunk 未被调用
    expect(sendChunk).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
    // 对端发 meta + 分片 → 本端照常收片 + 回 ack + 完成
    msgHandler!({ data: buildMeta(3, 1, 3) });
    msgHandler!({ data: encodeChunk(0, new Uint8Array([1, 2, 3])) });
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(sent.some((d) => typeof d === "string" && d.includes('"t":"ack"'))).toBe(true);
  });

  it("发送分片时 dc.send 抛异常 → onError 触发且连接被清理（v4.7.7 发送端不静默死亡）", async () => {
    // 实测 bug 根因：DataChannel 缓冲满/通道异常时 dc.send 抛 OperationError，
    // 无 try/catch 时异常被顶层 async 吞掉 → 发送端静默停止、对端永久等待。
    // 修复后：sendWithBackpressure 捕获异常 → onError + cleanup，对端可及时回退。
    const sent: unknown[] = [];
    let sendCount = 0;
    let openHandler: (() => void) | null = null;
    const fakeChannel = {
      send: (d: unknown) => {
        sent.push(d);
        sendCount += 1;
        if (sendCount >= 2) throw new Error("buffer full"); // meta 成功、首个分片抛错
      },
      readyState: "open",
      bufferedAmount: 0,
      close: vi.fn(),
      set onopen(fn: (() => void) | null) {
        openHandler = fn;
      },
      get onopen() {
        return openHandler;
      },
    };
    const closeSpy = vi.fn();
    const fakePc = {
      close: closeSpy,
      createDataChannel: vi.fn().mockReturnValue(fakeChannel),
      createOffer: vi.fn().mockResolvedValue({ type: "offer", sdp: "x" }),
      setLocalDescription: vi.fn().mockResolvedValue(undefined),
      onicecandidate: null,
      onconnectionstatechange: null,
      connectionState: "connected",
    };
    vi.stubGlobal(
      "RTCPeerConnection",
      vi.fn().mockImplementation(() => fakePc),
    );
    const onComplete = vi.fn();
    const onError = vi.fn();
    const sendChunk = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    p2pSend({
      peerId: "peer-A",
      role: "offerer",
      totalBytes: 3,
      chunkSize: 3,
      sendChunk,
      signal: vi.fn().mockResolvedValue(undefined),
      callbacks: { onComplete, onError },
    });
    await vi.waitFor(() => expect(openHandler).toBeTruthy());
    openHandler!();
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("发送分片失败"));
    // 发送端异常后主动清理连接（不再挂死），对端可感知通道关闭回退
    expect(closeSpy).toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("建连成功但无数据进展 → 30s 无进展超时触发 onError（v4.7.7 不再永久挂起）", () => {
    // 实测 bug：offer 已到、连接已建，但数据因任何原因不到（发送端静默死亡等），
    // 此前建连后无任何超时兜底 → 下载端 UI 永久卡"准备下载"无进度。
    // 修复后：onopen 即启动 progressTimer，超时无进展 → onError，由调用方回退。
    vi.useFakeTimers();
    try {
      let dcHandler: ((e: { channel: unknown }) => void) | null = null;
      let openHandler: (() => void) | null = null;
      const fakeChannel = {
        send: vi.fn(),
        readyState: "open",
        bufferedAmount: 0,
        close: vi.fn(),
        set onopen(fn: (() => void) | null) {
          openHandler = fn;
        },
        get onopen() {
          return openHandler;
        },
      };
      const fakePc = {
        close: vi.fn(),
        setRemoteDescription: vi.fn().mockResolvedValue(undefined),
        createAnswer: vi.fn().mockResolvedValue({ type: "answer", sdp: "x" }),
        setLocalDescription: vi.fn().mockResolvedValue(undefined),
        set ondatachannel(fn: ((e: { channel: unknown }) => void) | null) {
          dcHandler = fn;
        },
        get ondatachannel() {
          return dcHandler;
        },
        onicecandidate: null,
        onconnectionstatechange: null,
        // 通道 open 时连接必然已 connected（8s 建连超时被 guard 跳过，只测 30s 无进展超时）
        connectionState: "connected",
      };
      vi.stubGlobal(
        "RTCPeerConnection",
        vi.fn().mockImplementation(() => fakePc),
      );
      const onOpen = vi.fn();
      const onError = vi.fn();
      p2pReceive({
        peerId: "peer-A",
        role: "answerer",
        onChunk: vi.fn(),
        signal: vi.fn().mockResolvedValue(undefined),
        callbacks: { onOpen, onError },
      });
      handlePeerSignal({ type: "peer:offer", from_user_id: "peer-A", sdp: { type: "offer" } });
      // offer 建连（同步挂好 ondatachannel）→ 通道 open → 启动无进展超时
      dcHandler!({ channel: fakeChannel });
      openHandler!();
      expect(onError).not.toHaveBeenCalled();
      // 30s 无任何数据到达 → 超时触发 onError（调用方可据此回退 reverse/服务器/GitHub）
      vi.advanceTimersByTime(30_000);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(expect.stringContaining("P2P 传输超时"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("缓冲超过阈值时等 bufferedamountlow 排空再发（背压，v4.7.7 防缓冲满抛错）", async () => {
    // 对端消费慢：bufferedAmount 持续增长到超过实现上限后 dc.send 抛 OperationError
    //（发送端静默死亡的直接诱因）。修复后缓冲超阈值先暂停等待排空，传输不中断。
    const sent: unknown[] = [];
    let amount = 600 * 1024; // > 512KB 背压阈值
    let openHandler: (() => void) | null = null;
    const listeners: Record<string, Array<() => void>> = {};
    const fakeChannel = {
      send: (d: unknown) => void sent.push(d),
      get bufferedAmount() {
        return amount;
      },
      readyState: "open",
      close: vi.fn(),
      addEventListener: (evt: string, fn: () => void) => {
        (listeners[evt] ??= []).push(fn);
      },
      removeEventListener: (evt: string, fn: () => void) => {
        listeners[evt] = (listeners[evt] ?? []).filter((f) => f !== fn);
      },
      set onopen(fn: (() => void) | null) {
        openHandler = fn;
      },
      get onopen() {
        return openHandler;
      },
    };
    const fakePc = {
      close: vi.fn(),
      createDataChannel: vi.fn().mockReturnValue(fakeChannel),
      createOffer: vi.fn().mockResolvedValue({ type: "offer", sdp: "x" }),
      setLocalDescription: vi.fn().mockResolvedValue(undefined),
      onicecandidate: null,
      onconnectionstatechange: null,
      connectionState: "connected",
    };
    vi.stubGlobal(
      "RTCPeerConnection",
      vi.fn().mockImplementation(() => fakePc),
    );
    const sendChunk = vi.fn().mockResolvedValue(new Uint8Array(new Array(64 * 1024).fill(7)));
    const onError = vi.fn();
    p2pSend({
      peerId: "peer-A",
      role: "offerer",
      totalBytes: 3 * 64 * 1024,
      chunkSize: 64 * 1024,
      sendChunk,
      signal: vi.fn().mockResolvedValue(undefined),
      callbacks: { onError },
    });
    await vi.waitFor(() => expect(openHandler).toBeTruthy());
    openHandler!();
    // meta 已发；首个分片因缓冲超阈值进入背压等待（注册了 bufferedamountlow 监听）
    await vi.waitFor(() => expect(sent.length).toBe(1));
    await vi.waitFor(() => expect(listeners.bufferedamountlow ?? []).toHaveLength(1));
    // 对端消费排空缓冲 → 触发 bufferedamountlow → 继续发送
    amount = 0;
    (listeners.bufferedamountlow ?? []).forEach((fn) => fn());
    await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(2));
    expect(onError).not.toHaveBeenCalled();
  });

  it("同 peer 多 tag：offer 按 tag 路由到对应挂起接收，互不干扰（v4.7.7）", async () => {
    // 测试工具"3 种打洞方式"：同一对端并发多条连接（A 打洞 tag="a" + B 打洞 tag="b"），
    // 信令带 tag → handlePeerSignal 按 peerId:tag 路由，避免错配。
    const fakePc = {
      close: vi.fn(),
      setRemoteDescription: vi.fn().mockResolvedValue(undefined),
      createAnswer: vi.fn().mockResolvedValue({ type: "answer", sdp: "x" }),
      setLocalDescription: vi.fn().mockResolvedValue(undefined),
      ondatachannel: null,
      onicecandidate: null,
      onconnectionstatechange: null,
      connectionState: "new",
    };
    vi.stubGlobal(
      "RTCPeerConnection",
      vi.fn().mockImplementation(() => fakePc),
    );
    const signal = vi.fn().mockResolvedValue(undefined);
    const ha = p2pReceive({ peerId: "peer-A", role: "answerer", tag: "a", signal, callbacks: { onError: vi.fn() } });
    const hb = p2pReceive({ peerId: "peer-A", role: "answerer", tag: "b", signal, callbacks: { onError: vi.fn() } });
    // tag=a 的 offer → 命中 tag=a 挂起（消费后仅剩 tag=b）
    handlePeerSignal({ type: "peer:offer", from_user_id: "peer-A", tag: "a", sdp: { type: "offer" } });
    await vi.waitFor(() => expect(signal).toHaveBeenCalled());
    // tag=b 的 offer 仍可用（未被误消费）
    expect(() =>
      handlePeerSignal({ type: "peer:offer", from_user_id: "peer-A", tag: "b", sdp: { type: "offer" } }),
    ).not.toThrow();
    await vi.waitFor(() => expect(signal).toHaveBeenCalledTimes(2));
    // 无对应 tag 的 offer：仍有两个挂起（size=2 不触发唯一兜底）→ 忽略不配对
    handlePeerSignal({ type: "peer:offer", from_user_id: "peer-A", tag: "x", sdp: { type: "offer" } });
    expect(fakePc.close).not.toHaveBeenCalled(); // 未建连
    ha.close();
    hb.close();
  });

  it("duplex-test：offerer 先推一程→duplex_switch→收对端一程→duplex_done 完成双向（v4.7.7）", async () => {
    const sent: unknown[] = [];
    let openHandler: (() => void) | null = null;
    let msgHandler: ((e: { data: unknown }) => void) | null = null;
    const fakeChannel = {
      send: (d: unknown) => void sent.push(d),
      readyState: "open",
      bufferedAmount: 0,
      close: vi.fn(),
      set onopen(fn: (() => void) | null) {
        openHandler = fn;
      },
      get onopen() {
        return openHandler;
      },
      set onmessage(fn: ((e: { data: unknown }) => void) | null) {
        msgHandler = fn;
      },
      get onmessage() {
        return msgHandler;
      },
    };
    const fakePc = {
      close: vi.fn(),
      createDataChannel: vi.fn().mockReturnValue(fakeChannel),
      createOffer: vi.fn().mockResolvedValue({ type: "offer", sdp: "x" }),
      setLocalDescription: vi.fn().mockResolvedValue(undefined),
      onicecandidate: null,
      onconnectionstatechange: null,
      connectionState: "connected",
    };
    vi.stubGlobal(
      "RTCPeerConnection",
      vi.fn().mockImplementation(() => fakePc),
    );
    const onDirection = vi.fn();
    const onDuplexComplete = vi.fn();
    const onError = vi.fn();
    p2pSend({
      peerId: "peer-A",
      role: "offerer",
      mode: "duplex-test",
      tag: "a",
      totalBytes: 6,
      chunkSize: 3,
      signal: vi.fn().mockResolvedValue(undefined),
      callbacks: { onDirection, onDuplexComplete, onError },
    });
    await vi.waitFor(() => expect(openHandler).toBeTruthy());
    openHandler!();
    // 本机推一程：meta + 2 分片 + duplex_switch（共 4 条）
    await vi.waitFor(() => expect(sent.length).toBe(4));
    await vi.waitFor(() =>
      expect(sent.some((d) => typeof d === "string" && d.includes("duplex_switch"))).toBe(true),
    );
    await vi.waitFor(() => expect(onDirection).toHaveBeenCalledWith("self", expect.objectContaining({ bytes: 6 })));
    // 对端推一程回来（meta + 2 分片）→ 收齐记录 peer 方向
    msgHandler!({ data: buildMeta(6, 2, 3) });
    msgHandler!({ data: encodeChunk(0, new Uint8Array([1, 2, 3])) });
    msgHandler!({ data: encodeChunk(1, new Uint8Array([4, 5, 6])) });
    await vi.waitFor(() =>
      expect(onDirection).toHaveBeenCalledWith("peer", expect.objectContaining({ bytes: 6 })),
    );
    // 对端发 duplex_done → 双向全部完成
    msgHandler!({ data: JSON.stringify({ t: "duplex_done" }) });
    await vi.waitFor(() => expect(onDuplexComplete).toHaveBeenCalledTimes(1));
    expect(onDuplexComplete).toHaveBeenCalledWith(
      expect.objectContaining({ self: expect.anything(), peer: expect.anything() }),
    );
    expect(onError).not.toHaveBeenCalled();
  });

  it("duplex-test：answerer 先收对端一程→收到 duplex_switch 再推一程→duplex_done 完成（v4.7.7）", async () => {
    const sent: unknown[] = [];
    let dcHandler: ((e: { channel: unknown }) => void) | null = null;
    let openHandler: (() => void) | null = null;
    let msgHandler: ((e: { data: unknown }) => void) | null = null;
    const fakeChannel = {
      send: (d: unknown) => void sent.push(d),
      readyState: "open",
      bufferedAmount: 0,
      close: vi.fn(),
      set onopen(fn: (() => void) | null) {
        openHandler = fn;
      },
      get onopen() {
        return openHandler;
      },
      set onmessage(fn: ((e: { data: unknown }) => void) | null) {
        msgHandler = fn;
      },
      get onmessage() {
        return msgHandler;
      },
    };
    const fakePc = {
      close: vi.fn(),
      setRemoteDescription: vi.fn().mockResolvedValue(undefined),
      createAnswer: vi.fn().mockResolvedValue({ type: "answer", sdp: "x" }),
      setLocalDescription: vi.fn().mockResolvedValue(undefined),
      set ondatachannel(fn: ((e: { channel: unknown }) => void) | null) {
        dcHandler = fn;
      },
      get ondatachannel() {
        return dcHandler;
      },
      onicecandidate: null,
      onconnectionstatechange: null,
      connectionState: "new",
    };
    vi.stubGlobal(
      "RTCPeerConnection",
      vi.fn().mockImplementation(() => fakePc),
    );
    const onDirection = vi.fn();
    const onDuplexComplete = vi.fn();
    const onError = vi.fn();
    p2pReceive({
      peerId: "peer-A",
      role: "answerer",
      mode: "duplex-test",
      tag: "b",
      totalBytes: 6,
      chunkSize: 3,
      signal: vi.fn().mockResolvedValue(undefined),
      callbacks: { onDirection, onDuplexComplete, onError },
    });
    handlePeerSignal({ type: "peer:offer", from_user_id: "peer-A", tag: "b", sdp: { type: "offer" } });
    await vi.waitFor(() => expect(dcHandler).toBeTruthy());
    dcHandler!({ channel: fakeChannel });
    openHandler!(); // open：answerer 先不收不发，等对端推
    // 先收对端（offerer）一程：meta + 2 分片
    msgHandler!({ data: buildMeta(6, 2, 3) });
    msgHandler!({ data: encodeChunk(0, new Uint8Array([1, 2, 3])) });
    msgHandler!({ data: encodeChunk(1, new Uint8Array([4, 5, 6])) });
    await vi.waitFor(() =>
      expect(onDirection).toHaveBeenCalledWith("peer", expect.objectContaining({ bytes: 6 })),
    );
    // 收到 duplex_switch → 本机推一程（meta + 2 分片）+ duplex_done
    msgHandler!({ data: JSON.stringify({ t: "duplex_switch" }) });
    await vi.waitFor(() =>
      expect(sent.some((d) => typeof d === "string" && d.includes("duplex_done"))).toBe(true),
    );
    await vi.waitFor(() =>
      expect(onDirection).toHaveBeenCalledWith("self", expect.objectContaining({ bytes: 6 })),
    );
    await vi.waitFor(() => expect(onDuplexComplete).toHaveBeenCalledTimes(1));
    expect(onError).not.toHaveBeenCalled();
  });
});
