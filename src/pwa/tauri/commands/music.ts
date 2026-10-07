/**
 * 音乐播放器命令（PWA 实现：浏览器音频引擎 + localStorage 元数据 + IndexedDB）
 *
 * 与桌面端 Rust commands/music.rs 对齐。播放事件（进度/状态/歌单）由
 * pwa/src/music/engine.ts 经事件总线回传给复用的 music store。
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

import { audioEngine } from "../../music/engine";
import { getSongBytes } from "../../music/bytes";
import {
  idbSaveChunk,
  idbAssembleBlob,
  idbDeleteSong,
} from "../../music/idb";
import { loadMusicMeta, saveMusicMeta, type MusicMeta } from "../../storage";

export const CHUNK_SIZE = 128 * 1024;

// ===== 播放控制 =====

export async function cmdMusicTogglePlay(): Promise<void> {
  await audioEngine.toggle();
}

export async function cmdMusicNext(): Promise<void> {
  await audioEngine.next();
}

export async function cmdMusicPrev(): Promise<void> {
  await audioEngine.prev();
}

export async function cmdMusicSeek(args: Record<string, unknown>): Promise<void> {
  await audioEngine.seek(Number(args.seconds ?? 0));
}

export async function cmdMusicSetVolume(args: Record<string, unknown>): Promise<void> {
  audioEngine.setVolume(Number(args.volume ?? 0));
}

export async function cmdMusicSetAutoNext(args: Record<string, unknown>): Promise<void> {
  audioEngine.setAutoNext(!!args.enabled);
}

export async function cmdMusicSetPlayMode(args: Record<string, unknown>): Promise<void> {
  audioEngine.setPlayMode(String(args.mode ?? "shuffle") as "shuffle" | "order" | "loop");
}

// ===== 状态查询（fire-and-forget，经事件回传） =====

export async function cmdMusicGetStatus(): Promise<void> {
  audioEngine.emitStatus();
}

export async function cmdMusicGetPlaylist(): Promise<void> {
  audioEngine.emitPlaylist();
}

export async function cmdMusicGetDevices(): Promise<void> {
  // PWA 无输出设备选择：回传空列表
  const { emit } = await import("../../eventBus");
  emit("music-devices", { devices: [], current: -1 });
}

export async function cmdMusicSetDevice(): Promise<void> {
  /* PWA 无设备切换 */
}

// ===== 歌曲管理 =====

export async function cmdMusicPlaySong(args: Record<string, unknown>): Promise<void> {
  const songName = String(args.songName ?? "");
  if (!songName) return;
  await audioEngine.play(songName, 0);
}

export async function cmdMusicPlaySongAt(args: Record<string, unknown>): Promise<void> {
  const songName = String(args.songName ?? "");
  const positionSec = Number(args.positionSec ?? 0);
  if (!songName) return;
  await audioEngine.play(songName, Math.max(0, positionSec));
}

export async function cmdMusicDeleteSong(args: Record<string, unknown>): Promise<{
  success: boolean;
  error?: string;
}> {
  const songName = String(args.songName ?? "");
  const ok = await audioEngine.deleteSong(songName);
  return ok ? { success: true } : { success: false, error: "歌曲不存在" };
}

// ===== 标签管理（localStorage 元数据） =====

function meta(): MusicMeta {
  return loadMusicMeta();
}

export async function cmdMusicGetCustomTags(): Promise<{
  success: boolean;
  customTags?: Record<string, string>;
  error?: string;
}> {
  return { success: true, customTags: meta().customTags };
}

export async function cmdMusicAddCustomTag(args: Record<string, unknown>): Promise<{
  success: boolean;
  error?: string;
}> {
  const name = String(args.tagName ?? "");
  const color = String(args.color ?? "#8c8c8c");
  if (!name) return { success: false, error: "标签名不能为空" };
  const m = meta();
  m.customTags[name] = color;
  saveMusicMeta(m);
  return { success: true };
}

export async function cmdMusicDeleteCustomTag(args: Record<string, unknown>): Promise<{
  success: boolean;
  error?: string;
}> {
  const name = String(args.tagName ?? "");
  const m = meta();
  delete m.customTags[name];
  saveMusicMeta(m);
  return { success: true };
}

export async function cmdMusicUpdateTag(args: Record<string, unknown>): Promise<{
  success: boolean;
  error?: string;
}> {
  const songName = String(args.songName ?? "");
  if (!songName) return { success: false, error: "歌曲名不能为空" };
  const tag = args.tag === null || args.tag === undefined ? null : String(args.tag);
  const color = args.color === null || args.color === undefined ? null : String(args.color);
  const m = meta();
  if (tag) {
    m.tags[songName] = { name: tag, color };
  } else {
    delete m.tags[songName];
  }
  saveMusicMeta(m);
  audioEngine.setTagOverride(songName, tag ? { name: tag, color } : null);
  return { success: true };
}

// ===== 音乐库管理（目录树 / 播放集合 Set，PWA 实现 = localStorage 元数据） =====

/** 设置播放集合：PWA 播放引擎本身在前端，队列为 UI 本地状态，命令 no-op */
export async function cmdMusicSetPlaylist(): Promise<{ success: boolean }> {
  return { success: true };
}

/** 清空播放集合：no-op（引擎由 UI 状态驱动停止） */
export async function cmdMusicClearPlaylist(): Promise<{ success: boolean }> {
  return { success: true };
}

function normalizePath(p: unknown): string {
  const s = String(p ?? "");
  return s.split("/").filter((x) => x.length > 0).join("/");
}

export async function cmdMusicMoveSong(args: Record<string, unknown>): Promise<{
  success: boolean;
  error?: string;
}> {
  const songName = String(args.song ?? "");
  if (!songName) return { success: false, error: "歌曲名不能为空" };
  const m = meta();
  m.paths[songName] = normalizePath(args.path);
  saveMusicMeta(m);
  return { success: true };
}

export async function cmdMusicMoveSongs(args: Record<string, unknown>): Promise<{
  success: boolean;
  updated?: number;
  error?: string;
}> {
  const songs = Array.isArray(args.songs) ? (args.songs as unknown[]).map(String) : [];
  if (songs.length === 0) return { success: false, error: "歌曲列表为空" };
  const path = normalizePath(args.path);
  const m = meta();
  for (const s of songs) m.paths[s] = path;
  saveMusicMeta(m);
  return { success: true, updated: songs.length };
}

export async function cmdMusicMoveSongIfDefault(args: Record<string, unknown>): Promise<{
  success: boolean;
  set?: boolean;
  error?: string;
}> {
  const songName = String(args.song ?? "");
  if (!songName) return { success: false, error: "歌曲名不能为空" };
  const m = meta();
  const cur = m.paths[songName] ?? "";
  if (cur) return { success: true, set: false };
  m.paths[songName] = normalizePath(args.defaultPath);
  saveMusicMeta(m);
  return { success: true, set: true };
}

export async function cmdMusicSetSongTags(args: Record<string, unknown>): Promise<{
  success: boolean;
  error?: string;
}> {
  const songName = String(args.song ?? "");
  if (!songName) return { success: false, error: "歌曲名不能为空" };
  const tags = Array.isArray(args.tags)
    ? (args.tags as unknown[]).map((t) => String(t)).filter((t) => t.length > 0)
    : [];
  const m = meta();
  m.multiTags[songName] = tags;
  m.tags[songName] = tags[0]
    ? { name: tags[0], color: m.customTags[tags[0]] ?? null }
    : { name: "自定义", color: null };
  saveMusicMeta(m);
  return { success: true };
}

export async function cmdMusicRenameDir(args: Record<string, unknown>): Promise<{
  success: boolean;
  updated?: number;
  error?: string;
}> {
  const oldPath = String(args.oldPath ?? "");
  const newName = String(args.newName ?? "").trim();
  if (!oldPath || !newName) return { success: false, error: "参数不完整" };
  if (newName.includes("/")) return { success: false, error: "新名称不能包含 /" };
  const segs = oldPath.split("/").filter(Boolean);
  if (segs.length === 0) return { success: false, error: "「未分类」不可重命名" };
  const newPath = segs.length > 1 ? `${segs.slice(0, -1).join("/")}/${newName}` : newName;
  const m = meta();
  let updated = 0;
  for (const s of Object.keys(m.paths)) {
    const p = m.paths[s];
    if (p === oldPath) {
      m.paths[s] = newPath;
      updated += 1;
    } else if (p.startsWith(`${oldPath}/`)) {
      m.paths[s] = `${newPath}${p.slice(oldPath.length)}`;
      updated += 1;
    }
  }
  if (updated > 0) saveMusicMeta(m);
  return { success: true, updated };
}

export async function cmdMusicDeleteDir(args: Record<string, unknown>): Promise<{
  success: boolean;
  updated?: number;
  error?: string;
}> {
  const path = String(args.path ?? "");
  if (!path) return { success: false, error: "「未分类」不可删除" };
  const m = meta();
  let updated = 0;
  for (const s of Object.keys(m.paths)) {
    const p = m.paths[s];
    if (p === path || p.startsWith(`${path}/`)) {
      m.paths[s] = "";
      updated += 1;
    }
  }
  if (updated > 0) saveMusicMeta(m);
  return { success: true, updated };
}

// ===== P2P 传歌分片 =====

/** 读取分片（base64 版本，服务器中转用） */
export async function cmdMusicReadSongChunk(args: Record<string, unknown>): Promise<{
  success: boolean;
  song_name?: string;
  chunk_index?: number;
  total_chunks?: number;
  chunk_size?: number;
  data_base64?: string;
  error?: string;
}> {
  const songName = String(args.songName ?? "");
  const chunkIndex = Number(args.chunkIndex ?? 0);
  const info = audioEngine.getSongInfo(songName);
  if (!info) return { success: false, error: "歌曲不存在" };
  const bytes = await getSongBytes(songName, info.source);
  if (!bytes) return { success: false, error: "读取歌曲失败" };
  const totalChunks = Math.max(1, Math.ceil(bytes.length / CHUNK_SIZE));
  if (chunkIndex >= totalChunks) return { success: false, error: "分片越界" };
  const start = chunkIndex * CHUNK_SIZE;
  const slice = bytes.slice(start, start + CHUNK_SIZE);
  let dataBase64 = "";
  try {
    dataBase64 = await bytesToBase64(slice);
  } catch {
    return { success: false, error: "编码失败" };
  }
  return {
    success: true,
    song_name: songName,
    chunk_index: chunkIndex,
    total_chunks: totalChunks,
    chunk_size: CHUNK_SIZE,
    data_base64: dataBase64,
  };
}

/** 读取分片（二进制版本，WebRTC 直传用） */
export async function cmdMusicReadSongChunkBin(args: Record<string, unknown>): Promise<{
  success: boolean;
  error?: string;
  total_chunks?: number;
  chunk_size?: number;
  data?: number[];
}> {
  const songName = String(args.songName ?? "");
  const chunkIndex = Number(args.chunkIndex ?? 0);
  const info = audioEngine.getSongInfo(songName);
  if (!info) return { success: false, error: "歌曲不存在" };
  const bytes = await getSongBytes(songName, info.source);
  if (!bytes) return { success: false, error: "读取歌曲失败" };
  const totalChunks = Math.max(1, Math.ceil(bytes.length / CHUNK_SIZE));
  if (chunkIndex >= totalChunks) return { success: false, error: "分片越界" };
  const start = chunkIndex * CHUNK_SIZE;
  const slice = bytes.slice(start, start + CHUNK_SIZE);
  return {
    success: true,
    total_chunks: totalChunks,
    chunk_size: CHUNK_SIZE,
    data: Array.from(slice),
  };
}

/** 保存分片（base64 版本，服务器中转收片） */
export async function cmdMusicReceiveSongChunk(args: Record<string, unknown>): Promise<{
  success: boolean;
  error?: string;
}> {
  const songName = String(args.songName ?? "");
  const chunkIndex = Number(args.chunkIndex ?? 0);
  const b64 = String(args.dataBase64 ?? "");
  try {
    const bin = base64ToBytes(b64);
    await idbSaveChunk(songName, chunkIndex, bin.buffer as ArrayBuffer);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "保存分片失败" };
  }
}

/** 保存分片（二进制版本，WebRTC 直接收片） */
export async function cmdMusicReceiveSongChunkBin(args: Record<string, unknown>): Promise<{
  success: boolean;
  error?: string;
}> {
  const songName = String(args.songName ?? "");
  const chunkIndex = Number(args.chunkIndex ?? 0);
  const data = Array.isArray(args.data) ? (args.data as number[]) : [];
  try {
    const bytes = new Uint8Array(data);
    await idbSaveChunk(songName, chunkIndex, bytes.buffer as ArrayBuffer);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "保存分片失败" };
  }
}

/** 合并分片写入 IndexedDB 并刷新歌单 */
export async function cmdMusicFinalizeSong(args: Record<string, unknown>): Promise<{
  success: boolean;
  song_name?: string;
  error?: string;
}> {
  const songName = String(args.songName ?? "");
  const totalChunks = Number(args.totalChunks ?? 0);
  try {
    const blob = await idbAssembleBlob(songName, totalChunks);
    if (!blob) return { success: false, error: "分片不完整，合并失败" };
    audioEngine.registerLocalSong(songName, blob);
    audioEngine.emitPlaylist();
    return { success: true, song_name: songName };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "合并失败" };
  }
}

export async function cmdMusicClearLocalSong(args: Record<string, unknown>): Promise<{
  success: boolean;
  error?: string;
}> {
  const songName = String(args.songName ?? "");
  await idbDeleteSong(songName).catch(() => {});
  return { success: true };
}

// ===== 工具 =====

function bytesToBase64(bytes: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" });
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
