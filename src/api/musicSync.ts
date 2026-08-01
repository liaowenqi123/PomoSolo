/**
 * 同步听歌 API
 *
 * 对接自建服务器 WebSocket（server-planning/API-implementation.md 5.1）：
 * - 房间内一名 DJ 控制播放，其余听众同步
 * - 音频本地播放，服务器仅转发控制指令 + 时间戳
 * - 服务端推送通过 "ws-event" 事件监听（见 modules/ws.rs）
 *
 * 命令命名（Rust 端 snake_case）：
 * - music_sync_play / music_sync_pause / music_sync_seek / music_sync_next
 * - music_sync_volume / music_sync_add_song / music_sync_request_dj
 */
import { invoke } from "@tauri-apps/api/core";

/**
 * 同步播放（DJ 操作）。
 * 后端：`music_sync_play(song_id, position_ms) -> Result<(), String>`
 */
export function musicSyncPlay(songId: string, positionMs: number): Promise<void> {
  return invoke<void>("music_sync_play", { songId, positionMs });
}

/**
 * 同步暂停。
 * 后端：`music_sync_pause(position_ms) -> Result<(), String>`
 */
export function musicSyncPause(positionMs: number): Promise<void> {
  return invoke<void>("music_sync_pause", { positionMs });
}

/**
 * 同步跳转。
 * 后端：`music_sync_seek(position_ms) -> Result<(), String>`
 */
export function musicSyncSeek(positionMs: number): Promise<void> {
  return invoke<void>("music_sync_seek", { positionMs });
}

/**
 * 同步切歌。
 * 后端：`music_sync_next(song_id) -> Result<(), String>`
 */
export function musicSyncNext(songId: string): Promise<void> {
  return invoke<void>("music_sync_next", { songId });
}

/**
 * 同步音量（0-1）。
 * 后端：`music_sync_volume(volume) -> Result<(), String>`
 */
export function musicSyncVolume(volume: number): Promise<void> {
  return invoke<void>("music_sync_volume", { volume });
}

/**
 * 添加歌曲到同步歌单。
 * 后端：`music_sync_add_song(song_name, song_url) -> Result<(), String>`
 */
export function musicSyncAddSong(songName: string, songUrl: string): Promise<void> {
  return invoke<void>("music_sync_add_song", { songName, songUrl });
}

/**
 * 申请成为 DJ。
 * 后端：`music_sync_request_dj() -> Result<(), String>`
 */
export function musicSyncRequestDj(): Promise<void> {
  return invoke<void>("music_sync_request_dj");
}

/**
 * 广播 DJ 全量状态快照（歌曲 + 播放状态 + 进度 + 音量 + 传歌方案）。
 * 取代旧的动作消息（play/pause/seek/next），让听众端拿到完整状态而非单个动作。
 * 后端：`music_sync_state(song_id, playing, position_ms, volume, transfer_mode) -> Result<(), String>`
 */
export function musicSyncState(params: {
  songId: string;
  playing: boolean;
  positionMs: number;
  volume: number;
  transferMode: string;
}): Promise<void> {
  return invoke<void>("music_sync_state", {
    songId: params.songId,
    playing: params.playing,
    positionMs: params.positionMs,
    volume: params.volume,
    transferMode: params.transferMode,
  });
}

/**
 * 听众侧：请求拉取 DJ 正在播放但本地缺失的歌曲（P2P 传歌）。
 * 后端：`music_sync_request_song(song_id) -> Result<(), String>`
 */
export function musicSyncRequestSong(songId: string): Promise<void> {
  return invoke<void>("music_sync_request_song", { songId });
}

/**
 * 持有者（DJ）侧：回传歌曲分片给服务器，由服务器转发给请求者。
 * 后端：`music_sync_offer_song(song_id, chunk_index, total_chunks, chunk_size, data_base64) -> Result<(), String>`
 */
export function musicSyncOfferSong(params: {
  songId: string;
  chunkIndex: number;
  totalChunks: number;
  chunkSize: number;
  dataBase64: string;
}): Promise<void> {
  return invoke<void>("music_sync_offer_song", {
    songId: params.songId,
    chunkIndex: params.chunkIndex,
    totalChunks: params.totalChunks,
    chunkSize: params.chunkSize,
    dataBase64: params.dataBase64,
  });
}

/**
 * 持有者（DJ）侧：通知服务器本歌曲全部分片已发送完毕。
 * 后端：`music_sync_transfer_done(song_id) -> Result<(), String>`
 */
export function musicSyncTransferDone(songId: string): Promise<void> {
  return invoke<void>("music_sync_transfer_done", { songId });
}

/**
 * 持有者（DJ）侧：通知服务器本歌曲传输失败（如中途取消/文件丢失）。
 * 后端：`music_sync_transfer_failed(song_id) -> Result<(), String>`
 */
export function musicSyncTransferFailed(songId: string): Promise<void> {
  return invoke<void>("music_sync_transfer_failed", { songId });
}

/**
 * DJ 侧：广播当前传歌方案（immediate 边下边播 / wait_all 全员就绪统一播）。
 * 听众端据此显示对应提示。
 * 后端：`music_sync_set_config(transfer_mode) -> Result<(), String>`
 */
export function musicSyncSetConfig(transferMode: string): Promise<void> {
  return invoke<void>("music_sync_set_config", { transferMode });
}

/**
 * 听众侧：请求服务器补发当前同步状态快照。
 * 用于"加入已有 DJ 的同步听歌"时对齐（开启同步后立即恢复 DJ 正在播的歌/进度/状态）。
 * 后端：`music_sync_request_state() -> Result<(), String>`，服务器收到后向该客户端回发房间最近一次 music:sync_state。
 */
export function musicSyncRequestState(): Promise<void> {
  return invoke<void>("music_sync_request_state");
}
