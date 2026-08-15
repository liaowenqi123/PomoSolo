/**
 * PWA 运行时配置
 *
 * 部署目标：start.pomogrow.top（PWA 站点）+ api.pomogrow.top（后端，主部门 v4.7.11 迁移后的权威域名，
 * HTTPS 443 已生效，见 server-planning/EXTERNAL-INTERFACES.md）。
 *
 * - 生产环境默认同源：API_ORIGIN 为空字符串 → 所有 /api、/ws、/music 相对当前域名（start.pomogrow.top）解析，
 *   由服务器部门做反代（见 server-planning/PWA-requirements.md）；
 * - 开发环境默认指向 https://api.pomogrow.top（HTTPS，WS 自动 wss，需要服务器 CORS，见 PWA-requirements P2）；
 *   如需覆盖用 VITE_API_ORIGIN 环境变量（如内网 IP http://115.159.49.112 迁移期兼容）。
 *
 * 部门：PWA部门 —— 2026-08 PWA 第一版
 */

export const API_ORIGIN: string =
  ((import.meta.env.VITE_API_ORIGIN as string | undefined) ?? "").replace(/\/+$/, "") ||
  (import.meta.env.DEV ? "https://api.pomogrow.top" : "");

/** REST API 基地址 */
export const API_BASE: string = `${API_ORIGIN}/api/v1`;

/** 服务器托管音乐静态目录（同源反代/静态托管后为 /music） */
export const MUSIC_BASE: string = `${API_ORIGIN}/music`;

/** PWA 版本号（manifest / 设置面板展示；只在"要发布"时改，服务器部门见版本号变化即发布） */
export const PWA_VERSION: string = "0.4.1";

/** PWA 内置曲目清单路径（public/music-manifest.json，构建时由 scripts/generate-music-manifest.mjs 生成） */
export const MANIFEST_URL: string = "/music-manifest.json";

/** 音乐缓存（Cache API）名称 */
export const MUSIC_CACHE = "pomo-pwa-music-v1";

/** localStorage 命名空间 */
export const LS_PREFIX = "pomo-pwa:";
