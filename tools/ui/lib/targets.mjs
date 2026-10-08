/**
 * 内置截图目标与视口预设
 *
 * 视口**不是随便挑的**：
 *  - `desktop` / `garden` 取自 `src-tauri/tauri.conf.json` 的真实窗口尺寸（520×560 / 400×520），
 *    用来回答"桌面端真机上到底长什么样"；
 *  - PWA 的断点取自 `src/pwa/README.md`（560 / 1200 / 1920×1200），并额外取**边界值**（±1px），
 *    因为布局 bug 最爱藏在断点那一像素上。
 */

export const VIEWPORTS = {
  // ── 桌面端真机尺寸 ──
  desktop: { width: 520, height: 560, label: "桌面主窗口真机 520×560" },
  garden: { width: 400, height: 520, label: "菜园子窗口真机 400×520" },

  // ── 手机 ──
  "mobile-sm": { width: 360, height: 640, label: "小屏手机 360×640" },
  mobile: { width: 390, height: 844, label: "主流手机 390×844" },
  "mobile-lg": { width: 430, height: 932, label: "大屏手机 430×932" },

  // ── PWA 断点边界（560 是手机/桌面分界）──
  "bp-560-below": { width: 559, height: 800, label: "PWA 断点下沿 559×800" },
  "bp-560": { width: 560, height: 800, label: "PWA 断点 560×800" },
  tablet: { width: 834, height: 1112, label: "平板 834×1112" },
  "bp-1200-below": { width: 1199, height: 900, label: "PWA 断点下沿 1199×900" },
  "bp-1200": { width: 1200, height: 900, label: "PWA 断点上沿 1200×900" },

  // ── 桌面 ──
  laptop: { width: 1280, height: 800, label: "笔记本 1280×800" },
  "bp-1920-below": { width: 1919, height: 1199, label: "PWA 高档位断点下沿 1919×1199" },
  fhd: { width: 1920, height: 1080, label: "1080p 1920×1080" },
  "bp-1920-1200": { width: 1920, height: 1200, label: "PWA 高档位断点 1920×1200" },
  qhd: { width: 2560, height: 1440, label: "2K 2560×1440" },
};

/**
 * 内置目标。`views` 是默认视口列表；`serve` 指向 lib/servers.mjs 里的 dev server。
 * `bg` 用于透明窗口（桌面端 `transparent:true`），铺一层底色才看得见圆角与边界。
 */
export const TARGETS = {
  desktop: {
    label: "桌面端（Tauri 前端 dev server + IPC mock）",
    url: "http://127.0.0.1:18421/",
    serve: "desktop",
    views: ["desktop"],
    bg: "#2b2b2b",
    mock: true,
    scenario: "fresh",
    note: "对应 Tauri 主窗口真实尺寸 520×560；浏览器里没有 Tauri，已注入 IPC mock，否则会卡在启动遮罩",
  },
  "desktop-garden": {
    label: "桌面端 · 菜园子窗口",
    url: "http://127.0.0.1:18421/garden.html",
    serve: "desktop",
    views: ["garden"],
    bg: "#2b2b2b",
    mock: true,
    scenario: "garden-rich",
    note: "对应 Tauri 第二个窗口（garden.html）真实尺寸 400×520；已注入 mock 并摆出有作物的菜园",
  },
  "desktop-views": {
    label: "桌面端 · 多分辨率巡检",
    url: "http://127.0.0.1:18421/",
    serve: "desktop",
    views: ["desktop", "laptop", "fhd", "qhd"],
    bg: "#2b2b2b",
    mock: true,
    scenario: "fresh",
    note: "同一页面在几种窗口尺寸下的表现（查响应式与溢出）",
  },
  pwa: {
    label: "PWA（浏览器端，自带 shim 无需 mock）",
    url: "http://127.0.0.1:5199/",
    serve: "pwa",
    views: ["mobile", "bp-560-below", "bp-560", "bp-1200-below", "bp-1200", "fhd"],
    note: "覆盖 PWA 的手机/桌面断点与边界值",
  },
  "pwa-mobile": {
    label: "PWA · 手机",
    url: "http://127.0.0.1:5199/",
    serve: "pwa",
    views: ["mobile-sm", "mobile", "mobile-lg"],
  },
  "pwa-desktop": {
    label: "PWA · 桌面（含大屏档位）",
    url: "http://127.0.0.1:5199/",
    serve: "pwa",
    views: ["laptop", "bp-1920-below", "bp-1920-1200", "qhd"],
  },
  gallery: {
    label: "组件画廊（mock 数据，桌面端真实组件）",
    url: "http://127.0.0.1:5299/",
    serve: "gallery",
    views: ["desktop"],
    bg: "#2b2b2b",
    note: "一比一渲染 src/ 下的真实组件，数据来自 mock 层；可查任意组件/状态",
  },
};

/** 解析 `--view` 参数：接受预设名或 `宽x高` */
export function resolveView(spec) {
  if (!spec) throw new Error("视口为空");
  const m = /^(\d+)\s*[x×*]\s*(\d+)$/i.exec(String(spec).trim());
  if (m) {
    return { width: Number(m[1]), height: Number(m[2]), label: `${m[1]}×${m[2]}` };
  }
  const v = VIEWPORTS[spec];
  if (!v) {
    throw new Error(`未知视口 "${spec}"。可用预设：${Object.keys(VIEWPORTS).join(", ")}；或直接写 宽x高，如 800x600`);
  }
  return v;
}
