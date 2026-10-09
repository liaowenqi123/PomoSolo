/**
 * 传歌协议的权威定义与编解码（**虚拟客户端专用**）。
 *
 * ⚠️ 这里的每个消息名与字段都对照过客户端实现，改协议时必须同步本文件：
 *     · 线协议消息名/字段：src-tauri/src/commands/music_sync.rs
 *     · 信封格式 { type, ...params }：src-tauri/src/modules/ws.rs 的 send()
 *     · 协议契约文档：server-planning/EXTERNAL-INTERFACES.md
 *     · 分片大小 128KB/片（base64 ≈170KB，单消息上限 ≥512KB）
 *
 * 为什么虚拟客户端要说"真协议"而不是自造一套：
 *   只有这样，测试覆盖的才是**真实服务器 + 真实客户端都会走的路径**，
 *   而不是一套只在测试里成立的假协议。
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** 服务端中转分片大小：128KB（与协议文档一致） */
export const RELAY_CHUNK_SIZE = 128 * 1024;

/** 信封：{ type, ...params }。客户端发请求-响应类消息时附带的关联 id */
export function envelope(type, params = {}) {
  return JSON.stringify({ type, ...params });
}

// ── 客户端 → 服务器 ───────────────────────────────────────────────────
/** 加入房间（请求-响应，服务器回传同名 id） */
export const C2S = {
  ROOM_CREATE: "room:create",     // { name, max_members, password, description }
  ROOM_JOIN: "room:join",         // { room_id, password }
  ROOM_LEAVE: "room:leave",       // { room_id }
  REQUEST_DJ: "music:request_dj", // {}
  SYNC_STATE: "music:sync_state", // { song_id, playing, position_ms, volume, transfer_mode, dj_server_time? }
  SYNC_CONFIG: "music:sync_config", // { transfer_mode }
  REQUEST_SONG: "music:request_song", // { song_id, from_chunk?, p2p? }
  OFFER_SONG: "music:offer_song",     // { song_id, chunk_index, total_chunks, chunk_size, data_base64 }
  TRANSFER_DONE: "music:transfer_done",     // { song_id }
  TRANSFER_FAILED: "music:transfer_failed", // { song_id }
  REQUEST_STATE: "music:request_state",     // {}
};

// ── 服务器 → 客户端 ───────────────────────────────────────────────────
export const S2C = {
  ROOM_CREATED: "room:created",   // { room: { id, name, ... }, id }
  ROOM_JOINED: "room:joined",     // { id }
  ROOM_MEMBERS: "room:members",   // { members: [{ userId, username, online }] }
  MEMBER_JOINED: "room:member_joined",
  MEMBER_LEFT: "room:member_left",
  DJ_CHANGED: "music:dj_changed", // { dj_user_id, dj_username }
  SONG_REQUESTED: "music:song_requested", // { song_id, requester_user_id, p2p? } ← 只发给持有者
  SONG_CHUNK: "music:song_chunk",         // { song_id, chunk_index, total_chunks, chunk_size, data_base64 }
  TRANSFER_DONE: "music:transfer_done",   // { song_id }
  TRANSFER_FAILED: "music:transfer_failed",
  SONGS_READY: "music:songs_ready",       // { song_id }  wait_all 全员就绪
  SONG_WAITING: "music:song_waiting",     // wait_all 有人缺歌
  STATE_REQUEST: "music:state_request",   // 服务器转达：有听众要状态，DJ 应立刻广播
  SYNC_STATE: "music:sync_state",         // 广播（含 timestamp_server）
  SYNC_CONFIG: "music:sync_config",
};

/** 把文件按 RELAY_CHUNK_SIZE 切分（返回 Buffer 数组 + 元信息） */
export function chunkFile(filePath, chunkSize = RELAY_CHUNK_SIZE) {
  const buf = readFileSync(filePath);
  const totalChunks = Math.max(1, Math.ceil(buf.length / chunkSize));
  const chunks = [];
  for (let i = 0; i < totalChunks; i++) {
    chunks.push(buf.subarray(i * chunkSize, Math.min((i + 1) * chunkSize, buf.length)));
  }
  return { buf, chunks, totalChunks, chunkSize, size: buf.length, sha256: sha256(buf) };
}

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * 把收到的分片重组为完整 Buffer。
 * 按 chunk_index 排序（不依赖到达顺序），并校验片数与总长度。
 */
export function assembleChunks(chunks, expectedTotal, expectedSize = null) {
  const ordered = [...chunks].sort((a, b) => a.chunk_index - b.chunk_index);
  const seen = new Set();
  for (const c of ordered) {
    if (seen.has(c.chunk_index)) throw new Error(`分片重复：index=${c.chunk_index}`);
    seen.add(c.chunk_index);
  }
  if (expectedTotal != null && ordered.length !== expectedTotal) {
    throw new Error(`分片数不符：收到 ${ordered.length}，期望 ${expectedTotal}`);
  }
  const buf = Buffer.concat(ordered.map((c) => Buffer.from(c.data_base64, "base64")));
  if (expectedSize != null && buf.length !== expectedSize) {
    throw new Error(`总长度不符：重组 ${buf.length}，期望 ${expectedSize}`);
  }
  return buf;
}
