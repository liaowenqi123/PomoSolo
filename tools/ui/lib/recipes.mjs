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

/* ══════════════════════════════════════════════════════════════════════════
 * 真实窗口驱动配方（desktop-drive.mjs 用）
 *
 * 与上面的浏览器配方区别：
 *   - 上面用 CSS 选择器 + CDP 输入（在**浏览器**里点）
 *   - 这里用 **UIA 无障碍名称**（在**真实 Tauri 窗口**里点）
 *
 * `expect` 是关键：点击后要求这些文案**从无到有**出现，否则判为点击未生效。
 * 不写 expect 的步骤只截图，不做点击验证。
 *
 * ⚠️ InvokePattern 会**绕过命中测试**（直接调 handler）——它能证明"逻辑通"，
 *    但不能证明"用户点得到"。要测遮挡/热区，加 --allow-sendinput 走真鼠标。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 按 HTML `title`（→ UIA HelpText）定位按钮 —— 比 emoji 稳定得多 */
const byTitle = (title) => ({ controlType: "Button", helpTextContains: title });

/** 真实窗口里那排图标按钮的 emoji 名称（**不推荐**，仅留作对照） */
const uiaBtn = (icon) => ({ name: icon, controlType: "Button" });

/**
 * 面板关闭按钮。
 *
 * ⚠️ **必须排除窗口控件**：`×` 这个名字同时属于
 *   · 窗口关闭按钮  `window-controls__btn window-controls__btn--close`
 *   · 各面板关闭按钮 `settings-panel__close` 等
 * 不加 `classNameNotContains` 就会匹配到**窗口关闭按钮**，一点就把整个应用关掉
 * （踩过：drive 第 3 步报"进程未运行"，因为第 2 步把应用关了）。
 */
const UIA_CLOSE = { name: "×", controlType: "Button", classNameNotContains: "window-controls" };

/**
 * 顶部图标栏的「展开/收起」。
 *
 * ⚠️ **点面板前后图标栏状态不同**：面板打开时图标栏是展开的（9 个按钮都在无障碍树里），
 * 面板关闭后图标栏**收起**，主题/统计/AI 等按钮**从树里消失**（浏览器侧审计里
 * `header-buttons-hidden` 被 `covered` 就是同一机制）。
 * 所以「先展开再点」在关闭过面板之后是**必需**的，否则会报"找不到元素"。
 */
const UIA_EXPAND = byTitle("展开/收起");

export const DRIVE_RECIPES = {
  /** 真实窗口：主界面 + 各面板逐个点开并校验 */
  "desktop-panels": {
    label: "真实窗口 · 面板巡检",
    steps: [
      { name: "00-main" },
      { name: "01-settings", clicks: [UIA_EXPAND, byTitle("设置")], expect: ["外观模式", "恢复默认", "最小化行为"] },
      { name: "02-close-settings", click: UIA_CLOSE, expectGone: ["外观模式", "恢复默认"] },
      { name: "03-stats", clicks: [UIA_EXPAND, byTitle("数据统计")], expect: ["今日番茄", "今日专注（分钟）", "累计专注（分钟）"] },
      { name: "04-close-stats", click: UIA_CLOSE, expectGone: ["今日番茄"] },
      { name: "05-tutorial", clicks: [UIA_EXPAND, byTitle("教程")], expect: ["教程"] },
      { name: "06-close-tutorial", click: UIA_CLOSE, optional: true },
      { name: "07-ai", clicks: [UIA_EXPAND, byTitle("AI规划助手")], expect: ["AI"] },
      { name: "08-close-ai", click: UIA_CLOSE, optional: true },
      { name: "09-charts", clicks: [UIA_EXPAND, byTitle("图表")], expect: ["榜单"] },
      { name: "10-close-charts", click: UIA_CLOSE, optional: true },
      { name: "11-auth", clicks: [UIA_EXPAND, byTitle("云端登录")], expect: ["登录"] },
    ],
  },

  /** 真实窗口：主界面 + 设置面板开合 + 主题切换（最短的有效巡检） */
  "desktop-quick": {
    label: "真实窗口 · 快速巡检",
    steps: [
      { name: "00-main" },
      { name: "01-settings", clicks: [UIA_EXPAND, byTitle("设置")], expect: ["外观模式", "恢复默认"] },
      { name: "02-close", click: UIA_CLOSE, expectGone: ["外观模式", "恢复默认"] },
      {
        name: "03-toggle-theme",
        clicks: [UIA_EXPAND, byTitle("切换深色模式")],
        // 主题切换没有稳定的"新增文案"可断言（深色/浅色标签在设置面板里，此时面板已关）。
        // 证据 = 截图 + 该步 UIA dump 里主题按钮 Name 的翻转（☀️ ↔ 🌙）。
        note: "证据见截图与该步 UIA dump：主题按钮 Name 应在 ☀️ / 🌙 之间翻转",
      },
      { name: "04-settings-in-dark", clicks: [UIA_EXPAND, byTitle("设置")], expect: ["外观模式", "恢复默认"] },
    ],
  },

  /** 真实窗口：只截主界面（不点击，纯取证） */
  "desktop-plain": {
    label: "真实窗口 · 仅截图",
    steps: [{ name: "00-main" }],
  },

  /**
   * 真实窗口：音乐库面板（对照"浏览器截图里看到的半透明"是否为截图假象）
   * 用 className 定位播放列表按钮（它的可访问名是 📋，不够语义化）。
   */
  "desktop-music-panel": {
    label: "真实窗口 · 音乐库面板",
    steps: [
      { name: "00-main" },
      {
        name: "01-music-panel",
        click: { controlType: "Button", classNameContains: "music-playlist-btn" },
        expect: ["音乐库"],
        note: "用真窗口 PrintWindow 截图，与浏览器 CDP 截图对照面板是否真的半透明",
      },
      {
        name: "02-tab-playlist",
        click: { controlType: "Button", classNameContains: "music-playlist__tab" },
      },
    ],
  },
};

export function listDriveRecipes() {
  const describe = (c) => {
    if (!c) return "";
    if (c.helpTextContains) return `title=「${c.helpTextContains}」`;
    if (c.name) return `name=「${c.name}」${c.classNameNotContains ? `（排除 ${c.classNameNotContains}）` : ""}`;
    if (c.nameContains) return `name 含「${c.nameContains}」`;
    return JSON.stringify(c);
  };
  return Object.entries(DRIVE_RECIPES).map(([k, r]) => ({
    name: k,
    label: r.label ?? k,
    steps: (r.steps ?? []).map((s) => {
      const clicks = s.clicks?.length ? s.clicks : (s.click ? [s.click] : []);
      const what = clicks.map(describe).filter(Boolean).join(" → ");
      const assert = s.expect?.length ? `  [期望出现: ${s.expect.join("/")}]`
        : (s.expectGone?.length ? `  [期望消失: ${s.expectGone.join("/")}]` : "");
      return `${s.name}${what ? `  ← ${what}` : ""}${assert}`;
    }),
  }));
}
