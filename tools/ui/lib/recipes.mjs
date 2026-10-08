/**
 * 截图配方（recipe）：一次命令，把一组"真实界面状态"全部截下来
 *
 * 为什么用配方而不是另建组件画廊：
 *   本项目多数界面是**状态机驱动**的（面板开合、模式切换、弹窗），
 *   直接用真实 app + IPC mock 点开面板，比另建画廊更贴近真机、也不会与实现漂移。
 *   组件级的极端状态（例如"成就墙只剩 1 个成就"）用 mock 场景覆盖。
 *
 * 配方字段：
 *   target / url / serve / bg / mock / scenario   目标级（同 shot.mjs 的同名参数）
 *   views                                         默认视口
 *   shots[]                                       每个 shot：
 *     name      产物文件名前缀（也是索引里的标识）
 *     clicks[]  依次点击的选择器
 *     evals[]   依次执行的脚本
 *     waitFor   等待页面条件
 *     wait      额外等待 ms
 *     full      整页截图
 *     selector  只截某元素
 *     views     覆盖默认视口
 *     scenario  覆盖 mock 场景
 */

/** 桌面端主窗口右侧那排图标按钮（见 src/components/HeaderButtons.vue，用 title 选择最稳） */
const EXPAND = '[title="展开/收起"]';
const openPanel = (title) => [EXPAND, `[title="${title}"]`];

export const RECIPES = {
  /** 桌面端主窗口：主界面 + 所有面板（真实窗口尺寸 520×560） */
  "desktop-panels": {
    label: "desktop-panels",
    target: "desktop",
    views: ["desktop"],
    shots: [
      { name: "00-main", clicks: [] },
      { name: "01-settings", clicks: openPanel("设置") },
      { name: "02-stats", clicks: openPanel("数据统计") },
      { name: "03-tutorial", clicks: openPanel("教程") },
      { name: "04-ai", clicks: openPanel("AI规划助手") },
      { name: "05-charts", clicks: openPanel("图表") },
      { name: "06-studyroom", clicks: openPanel("自习室") },
      { name: "07-auth", clicks: openPanel("云端登录") },
      { name: "08-dark", clicks: [...openPanel("切换深色模式")] },
    ],
  },

  /** 菜园子窗口（独立窗口 400×520） */
  "desktop-garden": {
    label: "desktop-garden",
    target: "desktop-garden",
    views: ["garden"],
    shots: [
      { name: "00-garden-rich", scenario: "garden-rich" },
      { name: "01-garden-empty", scenario: "fresh" },
    ],
  },

  /** 主窗口在几种 mock 状态下的样子（查"数据少/多"引起的布局问题） */
  "desktop-states": {
    label: "desktop-states",
    target: "desktop",
    views: ["desktop"],
    shots: [
      { name: "00-fresh", scenario: "fresh" },
      { name: "01-focusing", scenario: "focusing" },
      { name: "02-music-playing", scenario: "music-playing" },
      { name: "03-cloud-signed-in", scenario: "cloud-signed-in", clicks: openPanel("云端登录") },
      { name: "04-charts-rich", scenario: "charts-rich", clicks: openPanel("图表") },
    ],
  },

  /**
   * 音乐库面板（v4.8 重点）：三个选项卡各截一张
   * 面板入口在播放器里，class 见 src/components/MusicPlayer.vue
   */
  "desktop-music-library": {
    label: "desktop-music-library",
    target: "desktop",
    scenario: "music-playing",
    views: ["desktop"],
    shots: [
      { name: "00-player", clicks: [] },
      { name: "01-panel-browse", clicks: [".music-playlist-btn"] },
      { name: "02-panel-dir", clicks: [".music-playlist-btn", '.music-playlist__tabs button:nth-of-type(1)'] },
      { name: "03-panel-filter", clicks: [".music-playlist-btn", '.music-playlist__tabs button:nth-of-type(2)'] },
      { name: "04-panel-playlist", clicks: [".music-playlist-btn", '.music-playlist__tabs button:nth-of-type(3)'] },
    ],
  },

  /** 桌面端响应式巡检：同一页面在几种尺寸下（查溢出/挤压） */
  "desktop-responsive": {
    label: "desktop-responsive",
    target: "desktop",
    views: ["desktop", "laptop", "fhd", "qhd"],
    shots: [{ name: "main" }],
  },

  /** PWA：手机 / 桌面 / 断点边界全覆盖 */
  "pwa-screens": {
    label: "pwa-screens",
    target: "pwa",
    views: ["mobile-sm", "mobile", "mobile-lg", "bp-560-below", "bp-560", "tablet", "bp-1200-below", "bp-1200", "fhd", "bp-1920-1200"],
    shots: [{ name: "pwa" }],
  },

  /** 全量巡检：主窗口所有面板 + 菜园子 + 状态 + PWA（耗时较长） */
  "full-sweep": {
    label: "full-sweep",
    target: "desktop",
    views: ["desktop"],
    shots: [
      { name: "00-main" },
      { name: "01-settings", clicks: openPanel("设置") },
      { name: "02-stats", clicks: openPanel("数据统计") },
      { name: "03-charts", clicks: openPanel("图表") },
      { name: "04-ai", clicks: openPanel("AI规划助手") },
      { name: "05-studyroom", clicks: openPanel("自习室") },
      { name: "06-tutorial", clicks: openPanel("教程") },
      { name: "07-auth", clicks: openPanel("云端登录") },
      { name: "08-music-panel", clicks: [".music-playlist-btn"] },
      { name: "09-laptop", views: ["laptop"] },
      { name: "10-fhd", views: ["fhd"] },
    ],
  },
};

/** 列出所有配方（--list-recipes） */
export function listRecipes() {
  return Object.entries(RECIPES).map(([k, r]) => ({
    name: k,
    label: r.label ?? k,
    target: r.target ?? r.url ?? "(自定义 url)",
    shots: (r.shots ?? []).map((s) => s.name),
  }));
}
