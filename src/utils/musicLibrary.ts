/**
 * 音乐库字段模型工具（表 + 树 投影）
 *
 * 概念（见 docs/modules/music-player-playlist-redesign.md v3）：
 * - 表：歌曲是唯一数据源，每条记录带字段 { path(目录归属), tags(多值标签), source(来源) }
 * - 树：目录路径（/ 分隔层级）实时投影为嵌套节点 —— 树不存数据，只从表中派生
 * - 播放集合：对任意查询结果（目录筛选 + 标签筛选 + 搜索）的快照，Set 语义
 */

export interface SongMeta {
  /** 目录归属路径（"" = 未分类） */
  path: string;
  /** 多值标签 */
  tags: string[];
  /** 来源（builtin / download / p2p / 空） */
  source: string;
}

export interface DirNode {
  /** 单段名称 */
  name: string;
  /** 完整路径（如 "导入/周杰伦"） */
  path: string;
  children: DirNode[];
  /** 直接包含的歌曲数（不含子目录） */
  count: number;
  /** 含子目录的歌曲总数 */
  subtreeCount: number;
}

/** 目录路径解析为分段（"" 或 "/" → 空数组） */
export function parseDirPath(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

/** 目录深度：未分类=0，一级目录=1，…… */
export function dirDepth(path: string): number {
  return parseDirPath(path).length;
}

/** 判断歌曲路径是否位于目录（或其子目录）下；dirPath 传 null 表示"全部"，恒真 */
export function isInDir(songPath: string, dirPath: string | null): boolean {
  if (dirPath === null) return true; // 全部
  if (songPath === dirPath) return true;
  return songPath.startsWith(dirPath + "/");
}

/** 是否未分类（空路径） */
export function isUncategorized(songPath: string): boolean {
  return songPath === "";
}

/** 重命名目录（同级替换最后一段为 newName，返回新路径；与 Rust rename_dir 逻辑一致） */
export function renameDirPath(oldPath: string, newName: string): string {
  const segs = parseDirPath(oldPath);
  if (segs.length === 0) return newName;
  const parent = segs.slice(0, -1).join("/");
  return parent ? `${parent}/${newName}` : newName;
}

/** 去掉扩展名的显示名 */
export function songDisplayName(name: string): string {
  return name.replace(/\.[^/.]+$/, "");
}

/** 内置歌曲判定（文件名去扩展名后以「 - 番茄钟」结尾，与 Rust is_builtin_song 一致） */
export function isBuiltinSong(name: string): boolean {
  return songDisplayName(name).trimEnd().endsWith(" - 番茄钟");
}

/**
 * 由记录集合构建目录树（实时派生；空目录不产生节点；重复路径计数去重）。
 */
export function buildDirTree(entries: Iterable<{ path: string }>): DirNode[] {
  const roots: DirNode[] = [];
  const index = new Map<string, DirNode>();
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.path)) continue; // 同路径去重（防御：同一首歌只计一次）
    seen.add(e.path);
    const segs = parseDirPath(e.path);
    if (segs.length === 0) continue; // 未分类不产生节点
    let parent: DirNode[] = roots;
    let acc = "";
    for (const seg of segs) {
      acc = acc ? `${acc}/${seg}` : seg;
      let node = index.get(acc);
      if (!node) {
        node = { name: seg, path: acc, children: [], count: 0, subtreeCount: 0 };
        index.set(acc, node);
        parent.push(node);
      }
      parent = node.children;
    }
    // 自底向上累计 subtreeCount（含自身，最深节点 subtreeCount 即其直接数量 + 1）
    for (let i = 1; i <= segs.length; i++) {
      const p = segs.slice(0, i).join("/");
      const node = index.get(p);
      if (!node) continue;
      node.subtreeCount += 1;
      if (i === segs.length) node.count += 1;
    }
  }
  return roots;
}

/** 收集目录树的全部节点路径（含各层级，用于统计"该目录下共多少歌"） */
export function collectDirPaths(nodes: DirNode[], prefix: string[] = []): string[] {
  const result: string[] = [];
  for (const n of nodes) {
    result.push(n.path);
    result.push(...collectDirPaths(n.children, [...prefix, n.path]));
  }
  return result;
}

/** 目录树的节点总数 */
export function countDirNodes(nodes: DirNode[]): number {
  let n = 0;
  for (const node of nodes) {
    n += 1 + countDirNodes(node.children);
  }
  return n;
}