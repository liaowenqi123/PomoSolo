/**
 * 音乐清单与歌曲类型
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

export interface ManifestSong {
  /** 歌名（含扩展名，与桌面端一致，如 "番茄小宇宙 - 番茄钟.mp3"） */
  name: string;
  /**
   * bundled=内置离线曲目（/tracks）；library=服务器托管曲库（/music）；
   * local=P2P 收到后落盘的本地歌曲（IDB blob，运行时由 engine.registerLocalSong 登记，
   * 清单本身不会产生该值）。
   */
  source: "bundled" | "library" | "local";
  /** 预设标签（学习/运动/休息/主题曲…） */
  tag?: string | null;
  /** 标签颜色 */
  color?: string | null;
}

export interface MusicManifest {
  version: number;
  songs: ManifestSong[];
}
