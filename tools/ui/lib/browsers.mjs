/**
 * 浏览器定位（UI 取证工具）
 *
 * 只用本机已安装的浏览器，不下载 Chromium、不新增 npm 依赖。
 * 见 .local/MACHINE.md §3：本机有 Chrome 与 Edge。
 *
 * 优先 Edge：它与 Tauri 桌面端同为 WebView2 内核，最接近真机渲染；
 * 其次 Chrome。可用环境变量 UI_BROWSER 指定绝对路径覆盖。
 */
import { existsSync } from "node:fs";

/** 候选浏览器（按优先级）。win32 用 `channel` 语义映射到具体路径。 */
const CANDIDATES = {
  win32: [
    { name: "edge", label: "Edge (WebView2 同内核，最接近桌面端真机)", paths: [
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ] },
    { name: "chrome", label: "Chrome", paths: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Users\\admin\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
    ] },
  ],
  darwin: [
    { name: "chrome", label: "Chrome", paths: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"] },
    { name: "edge", label: "Edge", paths: ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"] },
  ],
  linux: [
    { name: "chrome", label: "Chrome", paths: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"] },
    { name: "edge", label: "Edge", paths: ["/usr/bin/microsoft-edge"] },
  ],
};

/**
 * 找到可用的浏览器可执行文件。
 * @param {{ prefer?: "edge"|"chrome" }} [opts]
 * @returns {{ name: string, label: string, path: string }}
 */
export function findBrowser(opts = {}) {
  // 1) 环境变量显式覆盖
  const override = process.env.UI_BROWSER;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`UI_BROWSER 指向的文件不存在：${override}`);
    }
    return { name: "custom", label: `自定义 (${override})`, path: override };
  }

  const platform = process.platform;
  const list = CANDIDATES[platform];
  if (!list) {
    throw new Error(`不支持的平台 ${platform}；请用 UI_BROWSER=<浏览器可执行文件绝对路径> 指定`);
  }

  // 2) 按 prefer 排序
  const ordered = opts.prefer
    ? [...list].sort((a, b) => (a.name === opts.prefer ? -1 : b.name === opts.prefer ? 1 : 0))
    : list;

  for (const cand of ordered) {
    for (const p of cand.paths) {
      if (existsSync(p)) return { name: cand.name, label: cand.label, path: p };
    }
  }

  throw new Error(
    `未找到可用浏览器（找过：${list.flatMap((c) => c.paths).join(", ")}）。\n` +
    `请安装 Chrome/Edge，或用 UI_BROWSER=<绝对路径> 指定。`,
  );
}

/** 列出本机所有可用浏览器（给 --list-browsers 用） */
export function listBrowsers() {
  const platform = process.platform;
  const list = CANDIDATES[platform] ?? [];
  const out = [];
  for (const cand of list) {
    for (const p of cand.paths) {
      if (existsSync(p)) { out.push({ name: cand.name, label: cand.label, path: p }); break; }
    }
  }
  return out;
}
