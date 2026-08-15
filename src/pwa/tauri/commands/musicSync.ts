/**
 * 同步听歌命令（PWA 实现：WebSocket 发送）
 *
 * 与桌面端 Rust commands/music_sync.rs 完全对齐（消息名/字段名一致）。
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

import { send as wsSend } from "../../ws";

export async function cmdMusicSyncPlay(args: Record<string, unknown>): Promise<void> {
  await wsSend("music:play", {
    song_id: String(args.songId ?? ""),
    position_ms: Number(args.positionMs ?? 0),
  }, { withId: false });
}

export async function cmdMusicSyncPause(args: Record<string, unknown>): Promise<void> {
  await wsSend("music:pause", { position_ms: Number(args.positionMs ?? 0) }, { withId: false });
}

export async function cmdMusicSyncSeek(args: Record<string, unknown>): Promise<void> {
  await wsSend("music:seek", { position_ms: Number(args.positionMs ?? 0) }, { withId: false });
}

export async function cmdMusicSyncNext(args: Record<string, unknown>): Promise<void> {
  await wsSend("music:next", { song_id: String(args.songId ?? "") }, { withId: false });
}

export async function cmdMusicSyncVolume(args: Record<string, unknown>): Promise<void> {
  await wsSend("music:volume", { volume: Number(args.volume ?? 0) }, { withId: false });
}

export async function cmdMusicSyncAddSong(args: Record<string, unknown>): Promise<void> {
  await wsSend("music:add_song", {
    song_name: String(args.songName ?? ""),
    song_url: String(args.songUrl ?? ""),
  }, { withId: false });
}

export async function cmdMusicSyncRequestDj(): Promise<void> {
  await wsSend("music:request_dj", {}, { withId: false });
}

export async function cmdMusicSyncState(args: Record<string, unknown>): Promise<void> {
  const params: Record<string, unknown> = {
    song_id: String(args.songId ?? ""),
    playing: !!args.playing,
    position_ms: Number(args.positionMs ?? 0),
    volume: Number(args.volume ?? 0),
    transfer_mode: String(args.transferMode ?? "immediate"),
  };
  if (args.djServerTime !== undefined && Number(args.djServerTime) > 0) {
    params.dj_server_time = Number(args.djServerTime);
  }
  await wsSend("music:sync_state", params, { withId: false });
}

/** 测量与服务器的时钟偏移：3 次 ping 取 RTT 最小一次（与桌面端算法一致） */
export async function cmdMusicSyncMeasureTimeOffset(): Promise<number> {
  let best: { rtt: number; offset: number } | null = null;
  for (let i = 0; i < 3; i++) {
    const t1 = Date.now();
    const resp = (await wsSend("ping", {})) ?? {};
    const t2 = Date.now();
    const serverTime = Number(resp.server_time ?? 0);
    if (!serverTime) continue;
    const rtt = t2 - t1;
    const offset = serverTime + Math.floor(rtt / 2) - t2;
    if (!best || rtt < best.rtt) best = { rtt, offset };
  }
  if (!best) throw new Error("测量时钟偏移失败");
  return best.offset;
}

export async function cmdMusicSyncRequestSong(args: Record<string, unknown>): Promise<void> {
  const params: Record<string, unknown> = { song_id: String(args.songId ?? "") };
  const fromChunk = Number(args.fromChunk ?? 0);
  if (fromChunk > 0) params.from_chunk = fromChunk;
  if (args.p2p === true) params.p2p = true;
  // 诊断埋点：p2p=false 表示听众侧 djUserId 未就绪（收不到 dj_changed）→ 只能服务器中转
  console.log("[PWA] request_song:", { songId: params.song_id, fromChunk, p2p: !!params.p2p });
  await wsSend("music:request_song", params, { withId: false });
}

export async function cmdMusicSyncOfferSong(args: Record<string, unknown>): Promise<void> {
  await wsSend("music:offer_song", {
    song_id: String(args.songId ?? ""),
    chunk_index: Number(args.chunkIndex ?? 0),
    total_chunks: Number(args.totalChunks ?? 0),
    chunk_size: Number(args.chunkSize ?? 0),
    data_base64: String(args.dataBase64 ?? ""),
  }, { withId: false });
}

export async function cmdMusicSyncTransferDone(args: Record<string, unknown>): Promise<void> {
  await wsSend("music:transfer_done", { song_id: String(args.songId ?? "") }, { withId: false });
}

export async function cmdMusicSyncTransferFailed(args: Record<string, unknown>): Promise<void> {
  await wsSend("music:transfer_failed", { song_id: String(args.songId ?? "") }, { withId: false });
}

export async function cmdMusicSyncSetConfig(args: Record<string, unknown>): Promise<void> {
  await wsSend("music:sync_config", { transfer_mode: String(args.transferMode ?? "immediate") }, { withId: false });
}

export async function cmdMusicSyncRequestState(): Promise<void> {
  await wsSend("music:request_state", {}, { withId: false });
}

/** P2P 反向打洞请求：p2p:reverse_transfer_request */
export async function cmdP2PReverseTransferRequest(
  args: Record<string, unknown>,
): Promise<void> {
  const params: Record<string, unknown> = {
    to_user_id: String(args.toUserId ?? ""),
    song_id: String(args.songId ?? ""),
    version: String(args.version ?? ""),
  };
  if (Number(args.parallel) > 1) params.parallel = Number(args.parallel);
  await wsSend("p2p:reverse_transfer_request", params, { withId: false });
}
