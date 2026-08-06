/**
 * P2P 双端实测：经真实服务器 WS 信令牵线，WebRTC DataChannel 直连传文件并测速率。
 *
 * 用法（环境变量）：
 *   P2P_SERVER     http://115.159.49.112          （REST 认证用）
 *   P2P_WS         ws://115.159.49.112:3001        （WS 信令）
 *   P2P_USERNAME   测试用户名（自己）
 *   P2P_PASSWORD   密码
 *   P2P_ME_ID      自己的 user id
 *   P2P_PEER_ID    对端 user id
 *   P2P_ROLE       offerer（发送端）| answerer（接收端）
 *   P2P_BYTES      传输字节数（默认 5MB）
 *   P2P_CHUNK      单片字节数（默认 16KB，werift 纯 JS 实现消息上限保守）
 *   P2P_TIMEOUT    建连超时 ms（默认 10s）
 *
 * 传输协议与 src/p2p.ts 一致：meta JSON + 4 字节大端 index 前缀的二进制分片。
 */
import process from "node:process";
import { RTCPeerConnection, RTCIceCandidate } from "werift";
import { ensureUser } from "./auth.js";
import { Signaling } from "./signaling.js";

const SERVER = process.env.P2P_SERVER ?? "http://115.159.49.112";
const WS_BASE = process.env.P2P_WS ?? "ws://115.159.49.112";
const USERNAME = process.env.P2P_USERNAME ?? "";
const PASSWORD = process.env.P2P_PASSWORD ?? "";
const ME_ID = process.env.P2P_ME_ID ?? "";
const PEER_ID = process.env.P2P_PEER_ID ?? "";
const ROLE = process.env.P2P_ROLE ?? "";
const BYTES = Number(process.env.P2P_BYTES ?? 5 * 1024 * 1024);
const CHUNK_SIZE = Number(process.env.P2P_CHUNK ?? 16 * 1024);
const TIMEOUT_MS = Number(process.env.P2P_TIMEOUT ?? 10_000);

const STUN_URLS = ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"];

function parseChunk(buf) {
  const index = buf.readUInt32BE(0);
  return { index, data: buf.subarray(4) };
}

function encodeChunk(index, data) {
  const out = Buffer.alloc(4 + data.length);
  out.writeUInt32BE(index, 0);
  data.copy(out, 4);
  return out;
}

function buildMeta(size, totalChunks, chunkSize) {
  return JSON.stringify({ t: "meta", size, totalChunks, chunkSize });
}

async function main() {
  if (!USERNAME || !PASSWORD || !ME_ID || !PEER_ID || !ROLE) {
    console.error("缺少必填环境变量（P2P_USERNAME/PASSWORD/ME_ID/PEER_ID/ROLE）");
    process.exit(2);
  }
  const { token } = await ensureUser(USERNAME, PASSWORD);
  const sig = new Signaling(WS_BASE, token);
  await sig.connect();
  console.log(`[${ROLE}] WS 已连接，me=${ME_ID} peer=${PEER_ID}`);

  const pc = new RTCPeerConnection({ iceServers: STUN_URLS.map((url) => ({ urls: url })) });
  const startTime = Date.now();
  let receivedBytes = 0;
  let totalChunks = 0;
  let gotMeta = false;
  let sentDone = false;
  let connMs = 0;
  let finished = false;

  function finish(ok, reason) {
    if (finished) return;
    finished = true;
    const ms = Date.now() - startTime;
    const speedBps = ms > 0 ? Math.round((receivedBytes * 8 * 1000) / ms) : 0;
    const line = ok
      ? `RESULT OK bytes=${receivedBytes} connMs=${connMs} totalMs=${ms} speed=${(speedBps / 1e6).toFixed(2)}Mbps`
      : `RESULT FAIL reason=${reason} bytes=${receivedBytes} ms=${ms}`;
    console.log(line);
    try {
      pc.close();
    } catch {}
    sig.close();
    process.exit(ok ? 0 : 1);
  }

  // 建连超时
  const connTimer = setTimeout(() => finish(false, "建连超时"), TIMEOUT_MS);

  pc.connectionStateChange.subscribe((state) => {
    console.log(`[${ROLE}] connectionState=${state}`);
    if (state === "connected") {
      connMs = Date.now() - startTime;
      clearTimeout(connTimer);
    } else if (state === "failed" || state === "closed") {
      if (!finished) finish(false, `连接${state}`);
    }
  });
  pc.onIceCandidate.subscribe((candidate) => {
    if (candidate) {
      const c = candidate.candidate ?? candidate;
      console.log(`[${ROLE}] ICE candidate type=${c.type} addr=${c.address ?? c.ip}:${c.port}`);
      sig.send("peer:ice", PEER_ID, { candidate });
    }
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function wireChannel(dc) {
    dc.onopen = () => {
      console.log(`[${ROLE}] DataChannel open`);
      if (ROLE === "offerer" && !sentDone) void sendFile(dc);
    };
    dc.onmessage = (msg) => {
      // werift: msg 为 { data: Buffer }（字符串消息则 data 为 string）
      const raw = Buffer.isBuffer(msg) ? msg : msg?.data;
      if (!raw) return;
      if (typeof raw === "string") {
        if (raw.includes('"t":"ack"')) {
          // 接收端已收完所有分片，发送端才能安全退出
          finish(true);
        } else if (raw.includes('"t":"meta"')) {
          const meta = JSON.parse(raw);
          totalChunks = meta.totalChunks;
          receivedBytes = 0;
          gotMeta = true;
          console.log(`[${ROLE}] meta: size=${meta.size} totalChunks=${totalChunks}`);
        }
        return;
      }
      const { index, data: chunk } = parseChunk(raw);
      receivedBytes += chunk.length;
      if (gotMeta && index + 1 >= totalChunks) {
        // 收完最后一篇：回 ack 再退出（防止发送端过早关闭导致数据丢失）
        dc.send(JSON.stringify({ t: "ack", bytes: receivedBytes }));
        console.log(`[${ROLE}] 全部 ${totalChunks} 片收齐，发送 ack`);
        setTimeout(() => finish(true), 1000);
      }
    };
  }

  async function sendFile(dc) {
    sentDone = true;
    const total = Math.ceil(BYTES / CHUNK_SIZE);
    console.log(`[offerer] 开始发送 ${BYTES} 字节 / ${total} 片`);
    dc.send(buildMeta(BYTES, total, CHUNK_SIZE));
    receivedBytes = BYTES; // 发送端按发送量统计
    const payload = Buffer.alloc(CHUNK_SIZE, 7);
    for (let i = 0; i < total; i++) {
      if (dc.readyState !== "open") {
        finish(false, `通道中断(readyState=${dc.readyState})`);
        return;
      }
      dc.send(encodeChunk(i, payload));
      // 背压：werift 纯 JS flush 是异步的，缓冲过大就等 drain
      if (i % 8 === 0) {
        while (dc.bufferedAmount > 512 * 1024) await sleep(10);
      }
    }
    // 等接收端 ack（最多 10s），确认收齐后才安全退出
    const ackTimer = setTimeout(() => finish(false, "未收到 ack"), 10_000);
    const origFinish = finish;
    // 收到 ack 时由 onmessage 里的 finish(true) 结束
    finish = (...args) => {
      clearTimeout(ackTimer);
      origFinish(...args);
    };
  }

  // 信令路由
  sig.on("peer:offer", async (msg) => {
    if (ROLE !== "answerer") return;
    console.log("[answerer] 收到 peer:offer");
    pc.onDataChannel.subscribe((dc) => wireChannel(dc));
    try {
      await pc.setRemoteDescription(msg.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sig.send("peer:answer", PEER_ID, { sdp: pc.localDescription });
    } catch (e) {
      finish(false, `answer 失败: ${e.message}`);
    }
  });
  sig.on("peer:answer", async (msg) => {
    if (ROLE !== "offerer") return;
    await pc.setRemoteDescription(msg.sdp);
  });
  sig.on("peer:ice", (msg) => {
    if (msg.candidate) pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(() => {});
  });
  sig.on("peer:bye", (msg) => {
    if (msg.from_user_id === "__ws_closed__") finish(false, "WS 断开");
  });

  if (ROLE === "offerer") {
    const dc = pc.createDataChannel("p2p", { ordered: true });
    wireChannel(dc);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    console.log("[offerer] 发送 peer:offer");
    sig.send("peer:offer", PEER_ID, { sdp: pc.localDescription });
  } else {
    console.log("[answerer] 等待 peer:offer...");
  }
}

main().catch((e) => {
  console.error("运行失败:", e);
  process.exit(1);
});
