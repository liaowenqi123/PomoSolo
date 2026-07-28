/**
 * 音乐播放器 API
 *
 * 对应 Electron 旧版 ipc-music.js + musicPlayer.js 中的 window.electronAPI 调用。
 * 音乐播放通过 Rust 后端调用 Python 子进程（music.py），前端只管 UI 与状态同步。
 *
 * 命令命名（Rust 端 snake_case）：
 * - music_toggle_play / music_next / music_prev
 * - music_seek(seconds)
 * - music_set_volume(volume) / music_get_status
 * - music_set_play_mode(mode) / music_get_playlist
 * - music_get_devices / music_set_device(device_id)
 * - music_play_song(song_name) / music_delete_song(song_name)
 *
 * 后端事件（通过 @tauri-apps/api/event 的 listen 监听）：
 * - music-ready / music-status / music-track-change
 * - music-play-state / music-progress / music-devices
 * - music-no-music / music-play-error / music-volume-change
 * - music-play-mode / music-playlist / music-song-missing
 */
import { invoke } from "@tauri-apps/api/core";

// ===== 类型定义 =====

export type PlayMode = "shuffle" | "order" | "loop";

export interface MusicDevice {
  id: number;
  name: string;
  hostapi: string;
  is_default?: boolean;
}

export interface MusicStatus {
  playing: boolean;
  name: string;
  current: number;
  duration: number;
  has_prev?: boolean;
  play_mode?: PlayMode;
}

export interface PlaylistSong {
  name: string;
  tag?: string;
  tagColor?: string | null;
}

export interface PlaylistData {
  songs: PlaylistSong[] | string[];
  current_index?: number;
  current_song?: string;
}

export interface MusicReadyPayload {
  name: string;
  duration: number;
  has_prev?: boolean;
}

export interface MusicPlayStatePayload {
  playing: boolean;
}

export interface MusicProgressPayload {
  current: number;
  duration: number;
}

export interface MusicDevicesPayload {
  devices: MusicDevice[];
  current: number;
}

export interface MusicVolumePayload {
  volume: number;
}

export interface MusicPlayModePayload {
  mode: PlayMode;
}

export interface MusicPlayErrorPayload {
  message: string;
}

export interface MusicSongMissingPayload {
  message?: string;
}

// ===== 播放控制 =====

/** 切换播放/暂停 */
export function musicTogglePlay(): Promise<void> {
  return invoke<void>("music_toggle_play");
}

/** 下一首 */
export function musicNext(): Promise<void> {
  return invoke<void>("music_next");
}

/** 上一首 */
export function musicPrev(): Promise<void> {
  return invoke<void>("music_prev");
}

/** 跳转到指定时间（秒） */
export function musicSeek(seconds: number): Promise<void> {
  return invoke<void>("music_seek", { seconds });
}

/** 设置音量（0-1） */
export function musicSetVolume(volume: number): Promise<void> {
  return invoke<void>("music_set_volume", { volume });
}

/** 设置播放模式 */
export function musicSetPlayMode(mode: PlayMode): Promise<void> {
  return invoke<void>("music_set_play_mode", { mode });
}

// ===== 状态查询 =====

/** 获取当前播放状态 */
export function musicGetStatus(): Promise<MusicStatus> {
  return invoke<MusicStatus>("music_get_status");
}

/** 获取播放列表 */
export function musicGetPlaylist(): Promise<PlaylistData> {
  return invoke<PlaylistData>("music_get_playlist");
}

/** 获取输出设备列表 */
export function musicGetDevices(): Promise<MusicDevicesPayload> {
  return invoke<MusicDevicesPayload>("music_get_devices");
}

/** 设置输出设备 */
export function musicSetDevice(deviceId: number): Promise<void> {
  return invoke<void>("music_set_device", { deviceId });
}

// ===== 歌曲管理 =====

/** 播放指定歌曲 */
export function musicPlaySong(songName: string): Promise<void> {
  return invoke<void>("music_play_song", { songName });
}

/** 删除歌曲 */
export function musicDeleteSong(songName: string): Promise<{ success: boolean; error?: string }> {
  return invoke<{ success: boolean; error?: string }>("music_delete_song", { songName });
}

// ===== 标签管理 =====

export interface CustomTagResult {
  success: boolean;
  customTags?: Record<string, string>;
  error?: string;
}

/** 获取自定义标签 */
export function musicGetCustomTags(): Promise<CustomTagResult> {
  return invoke<CustomTagResult>("music_get_custom_tags");
}

/** 添加自定义标签 */
export function musicAddCustomTag(
  tagName: string,
  color: string,
): Promise<{ success: boolean; error?: string }> {
  return invoke<{ success: boolean; error?: string }>("music_add_custom_tag", { tagName, color });
}

/** 删除自定义标签 */
export function musicDeleteCustomTag(tagName: string): Promise<{ success: boolean; error?: string }> {
  return invoke<{ success: boolean; error?: string }>("music_delete_custom_tag", { tagName });
}

/** 更新歌曲标签 */
export function musicUpdateTag(
  songName: string,
  tag: string,
  color: string | null,
): Promise<{ success: boolean; error?: string }> {
  return invoke<{ success: boolean; error?: string }>("music_update_tag", { songName, tag, color });
}
