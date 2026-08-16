/**
 * 音乐本地库索引（PWA 持久化"我的歌"）
 *
 * 问题：P2P 收到的歌 / 播放缓存的曲库歌，数据本身在 IndexedDB / Cache API，
 * 但"哪些歌被我下载过"这份名单此前没有落盘 —— 歌名只在内存（engine.songInfo/
 * order），一刷新/更新就消失（尽管字节还在磁盘上）。这就是"下载的歌/P2P 传的
 * 歌全部消失"的根因之一。
 *
 * 方案：把"本地库歌名"记到 localStorage（pomo-pwa:library）：
 * - local   = P2P 收到并已合并落盘到 IDB 的歌（engine.registerLocalSong 时记录）
 * - library = 从服务器曲库缓存到 Cache API 的歌（开关：可选记录，见下）
 * 启动时 preflight.ts 据此 + IDB/Cache 实际字节，把这些歌重新并入播放列表。
 *
 * 这里提供一个幂等的歌名清单 + 一个"曲库缓存快照"辅助（扫描 Cache API 的
 * /music/ 命中），保证即使版本更新 / 清单变化 / 强制刷新，已下载的歌也不丢。
 *
 * 部门：PWA部门 —— 2026-08
 */
import { LS_PREFIX } from "../config";

export type LibrarySource = "local" | "library";

export interface LibraryEntry {
  name: string;
  source: LibrarySource;
}

interface LibraryState {
  /** 清单结构版本（迁移用） */
  version: number;
  entries: LibraryEntry[];
}

const KEY = LS_PREFIX + "library";
const STATE_VERSION = 1;

function loadState(): LibraryState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { version: STATE_VERSION, entries: [] };
    const parsed = JSON.parse(raw) as Partial<LibraryState>;
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries.filter(
          (e): e is LibraryEntry =>
            !!e && typeof e.name === "string" && (e.source === "local" || e.source === "library"),
        )
      : [];
    return { version: STATE_VERSION, entries };
  } catch {
    return { version: STATE_VERSION, entries: [] };
  }
}

function saveState(state: LibraryState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("[PWA library] save failed:", e);
  }
}

/** 幂等记录一首歌进本地库（local：P2P 落盘 / library：曲库缓存） */
export function rememberSong(name: string, source: LibrarySource): void {
  const s = loadState();
  if (s.entries.some((e) => e.name === name && e.source === source)) return;
  s.entries.push({ name, source });
  saveState(s);
}

/** 从本地库移除一首歌（删除歌曲时调用，配合清理 IDB / Cache） */
export function forgetSong(name: string): void {
  const s = loadState();
  const before = s.entries.length;
  s.entries = s.entries.filter((e) => e.name !== name);
  if (s.entries.length !== before) saveState(s);
}

/** 读取本地库全量（按记录顺序） */
export function getLibrary(): LibraryEntry[] {
  return loadState().entries;
}

/** 读取指定来源的歌名 */
export function getLibraryNames(source: LibrarySource): string[] {
  return loadState()
    .entries.filter((e) => e.source === source)
    .map((e) => e.name);
}
