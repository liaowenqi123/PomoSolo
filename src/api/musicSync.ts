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
