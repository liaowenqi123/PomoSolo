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
  buildMeta,
  parseMeta,
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
});

describe("p2p meta 控制消息", () => {
  it("buildMeta/parseMeta 往返一致", () => {
    const text = buildMeta(1024 * 1024, 8, 128 * 1024);
    const meta = parseMeta(text);
    expect(meta).toEqual({ size: 1024 * 1024, totalChunks: 8, chunkSize: 128 * 1024 });
  });

  it("parseMeta 拒绝非 meta 消息", () => {
    expect(parseMeta("hello")).toBeNull();
    expect(parseMeta("{}")).toBeNull();
    expect(parseMeta('{"t":"other"}')).toBeNull();
    expect(parseMeta("not json")).toBeNull();
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
});
