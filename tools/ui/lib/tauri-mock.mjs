/**
 * Tauri IPC 浏览器 mock（UI 取证工具核心）
 *
 * 为什么需要它：
 *   浏览器里没有 Tauri，`@tauri-apps/api` 的 `invoke` 会抛
 *   "Cannot read properties of undefined (reading 'invoke')"，所有 store 初始化失败，
 *   界面永远卡在"正在启动…"的加载遮罩后面 —— 截图毫无意义。
 *
 * 做法：在**页面脚本执行前**注入 `window.__TAURI_INTERNALS__`（官方 API 只依赖这 4 个成员，
 * 已在 @tauri-apps/api@2.11.1 核对过）：invoke / transformCallback / unregisterCallback / convertFileSrc。
 * 于是 **src/ 下的真实组件与 store 一行不改**就能在浏览器里跑起来 —— 与 PWA 的
 * "alias 换层" 同一思路，但这里是"注入底座"，连 alias 都不需要。
 *
 * 事件：`@tauri-apps/api/event` 的 listen 走 `plugin:event|listen`，回调经 transformCallback。
 *       mock 记录下来后，可用 `__UI_MOCK__.emit(事件名, 载荷)` 主动派发，
 *       因此 music-progress / ws-event / 前台检测告警这类状态都能"摆"出来再截图。
 *
 * 未覆盖的命令：返回 null 并记进 `__UI_MOCK__.unmocked`，
 *           截图后读它就知道还差哪些 fixture（反馈闭环）。
 */

/** 所有命令的默认应答；未列出的命令返回 null 并被记为 unmocked */
export const BASE_FIXTURES = {
  // ── 数据/设置：空对象 = 全新安装态（前端自带默认值合并，见 src/stores/settings.ts DEFAULT_SETTINGS）
  read_data: {},
  read_settings: {},
  write_data: null,
  write_settings: null,

  // ── Tauri 官方插件
  "plugin:app|version": "4.8.0-ui-mock",
  "plugin:dialog|open": null,
  "plugin:dialog|save": null,
  "plugin:dialog|message": null,
  "plugin:dialog|ask": true,
  "plugin:dialog|confirm": true,

  // ── 计时器（src/api/timer.ts）
  get_timer_state: { isRunning: false, mode: "work", remainingMs: 25 * 60 * 1000 },

  // ── 菜园子：宽松 Value，空对象走前端默认
  garden_read: {},

  // ── 本地开关类（返回布尔，避免 null 造成误判）
  autostart_is_enabled: false,
  foreground_is_ready: false,
  update_seed_has_installer: false,

  // ── 音乐：空标签表 + 无播放状态（"未播放"是合法界面状态）
  //
  // ⚠️ 注意这些命令是 **fire-and-forget**：调用它们只是"请求"，真实数据由后端
  //    **事件**返回（见 src/api/music.ts 的注释「结果通过 xxx 事件返回」）。
  //    所以光给 fixture 不够 —— 还要在命令被调用时派发对应事件，
  //    否则界面永远停在"暂无音乐"（这是本 mock 早期的一个真实缺口）。
  //    映射表见下面的 COMMAND_EMITS。
  music_get_custom_tags: {},
  music_get_devices: [],
  music_get_playlist: {
    songs: [],
    current_song: null,
  },
  music_get_status: {
    is_playing: false,
    current_song: null,
    progress: 0,
    duration: 0,
    volume: 80,
    play_mode: "order",
    auto_next: true,
  },
  get_download_status: null,

  // ── 云端账号：本地模式（不触发真实网络请求，保证截图可复现）
  //    注意形状：cloud_test_connection 必须返回 { ok }（src/api/auth.ts ConnectionTestResult），
  //    返回 null 会让 auth store 抛 "Cannot read properties of null (reading 'ok')"
  get_api_mode: "local",
  cloud_get_session: null,
  cloud_test_connection: { ok: true, latency: 12 },
  load_credentials: null,
  get_api_key: null,
  cloud_login: { success: false, error: "ui-mock：未接入真实服务器" },
  cloud_register: { success: false, error: "ui-mock：未接入真实服务器" },
  cloud_logout: null,
  clear_credentials: null,
  save_credentials: null,
  save_api_key: null,
  set_api_mode: null,

  // ── 前台检测（默认关闭，避免出现告警浮层干扰截图）
  foreground_get_config: { blacklist: [], whitelist: [], enabled: false },
  foreground_get_status: { isRunning: false, currentApp: null },

  // ── 榜单/更新/公告/反馈：空值即"无数据"合法态
  charts_fetch: { songs: [] },
  check_update: { hasUpdate: false },
  fetch_notice: null,
  get_user_feedbacks: { feedbacks: [] },

  // ── 自习室
  study_room_get_active: null,
  study_room_get_ranking: [],
  study_room_get_members: [],
};

/**
 * 「命令 → 事件」映射：某些命令是 fire-and-forget 的**请求**，
 * 真实数据由后端通过**事件**推回（见 src/api/music.ts 的注释）。
 * mock 必须在命令被调用时把这些事件派发出去，否则依赖事件的界面永远是空态。
 */
export const COMMAND_EMITS = {
  music_get_playlist: "music-playlist",
  music_get_status: "music-status",
  music_get_devices: "music-devices",
  music_get_custom_tags: "music-custom-tags",
  check_update: "update-status",
};

/**
 * 场景预设：在基础 fixture 之上覆盖，用来"摆出"特定界面状态再截图。
 * 键名与 BASE_FIXTURES 的命令名一致。
 *
 * ⚠️ 音乐的 fixture 形状必须与**事件载荷**一致（不是命令返回值形状）：
 *    music-playlist 事件 = { songs: [{name, tag, tagColor, path, tags, source}], current_song }
 *    见 src/stores/music.ts 的 handlePlaylist。
 */
export const SCENARIOS = {
  /** 全新安装态（无数据、未登录、未播放） */
  fresh: {},

  /** 桌面端主界面：正在专注 + 有备注 */
  focusing: {
    get_timer_state: { isRunning: true, mode: "work", remainingMs: 13 * 60 * 1000 },
    read_data: {
      notes: "把重构做完",
      todayCompleted: 3,
      totalFocusMinutes: 128,
    },
  },

  /** 菜园子有作物（用于核对成就墙/商店/签到面板高度稳定性） */
  "garden-rich": {
    read_data: {
      garden: {
        coins: 1280,
        plots: [
          { id: 0, crop: "carrot", progress: 30, mature: false, unlocked: true, withered: false },
          { id: 1, crop: "tomato", progress: 120, mature: true, unlocked: true, withered: false },
          { id: 2, crop: "sunflower", progress: 45, mature: false, unlocked: true, withered: true },
          { id: 3, crop: null, progress: 0, mature: false, unlocked: true, withered: false },
        ],
        seeds: { carrot: 5, tomato: 3, sunflower: 1, rose: 0, osmanthus: 0 },
        bag: { carrot: 2, tomato: 8 },
        achievements: { first_harvest: true, plant_10: true },
        signIn: { lastDate: null, streak: 4, total: 11 },
        combo: 3,
        tier: 2,
      },
    },
    garden_read: {
      coins: 1280,
      plots: [
        { id: 0, crop: "carrot", progress: 30, mature: false, unlocked: true, withered: false },
        { id: 1, crop: "tomato", progress: 120, mature: true, unlocked: true, withered: false },
        { id: 2, crop: "sunflower", progress: 45, mature: false, unlocked: true, withered: true },
        { id: 3, crop: null, progress: 0, mature: false, unlocked: true, withered: false },
      ],
      seeds: { carrot: 5, tomato: 3, sunflower: 1, rose: 0, osmanthus: 0 },
      bag: { carrot: 2, tomato: 8 },
      achievements: { first_harvest: true, plant_10: true },
      signIn: { lastDate: null, streak: 4, total: 11 },
      combo: 3,
      tier: 2,
    },
  },

  /** 音乐播放中（用于核对播放器/播放列表面板） */
  "music-playing": {
    music_get_status: {
      is_playing: true,
      current_song: "深度专注 Deep Focus - 番茄钟.mp3",
      progress: 42,
      duration: 213,
      volume: 80,
      play_mode: "order",
      auto_next: true,
    },
    // 形状 = music-playlist **事件载荷**（不是命令返回值）
    music_get_playlist: {
      current_song: "深度专注 Deep Focus - 番茄钟.mp3",
      songs: [
        { name: "深度专注 Deep Focus - 番茄钟.mp3", tag: "学习", tagColor: "#ff9ff3", path: "内置", tags: ["学习", "专注"], source: "builtin" },
        { name: "图书馆时光 Library Hours - 番茄钟.mp3", tag: "学习", tagColor: "#ff9ff3", path: "内置", tags: ["学习", "安静"], source: "builtin" },
        { name: "键盘交响乐 Keyboard Symphony - 番茄钟.mp3", tag: "白噪音", tagColor: "#48dbfb", path: "下载", tags: ["白噪音"], source: "download" },
        { name: "Are you lost", tag: "运动", tagColor: "#ff9664", path: "导入/周杰伦/范特西", tags: ["运动"], source: "" },
        { name: "Closer", tag: "休息", tagColor: "#5AB48C", path: "导入", tags: ["休息"], source: "" },
        { name: "Dance monkey", tag: "运动", tagColor: "#ff9664", path: "", tags: [], source: "" },
        { name: "Faded", tag: "自定义", tagColor: null, path: "下载", tags: [], source: "download" },
        { name: "Flower Dance", tag: "学习", tagColor: "#ff9ff3", path: "喜欢", tags: ["学习"], source: "" },
        { name: "夜空中最亮的星", tag: "自定义", tagColor: null, path: "", tags: [], source: "" },
        { name: "海阔天空", tag: "自定义", tagColor: null, path: "导入/Beyond", tags: [], source: "" },
        { name: "晴天", tag: "自定义", tagColor: null, path: "导入/周杰伦/叶惠美", tags: [], source: "" },
        { name: "稻香", tag: "自定义", tagColor: null, path: "导入/周杰伦/魔杰座", tags: [], source: "" },
      ],
    },
    music_get_custom_tags: { 白噪音: "#48dbfb", 学习: "#ff9ff3", 运动: "#ff9664", 休息: "#5AB48C" },
  },

  /** 曲库很大（用于核对长列表滚动、目录树多级、标签很多时的表现） */
  "music-large-library": {
    music_get_status: {
      is_playing: false, current_song: null, progress: 0, duration: 0,
      volume: 80, play_mode: "order", auto_next: true,
    },
    music_get_playlist: {
      current_song: null,
      songs: Array.from({ length: 60 }, (_, i) => {
        const dirs = ["内置", "下载", "导入/周杰伦/范特西", "导入/周杰伦/叶惠美", "导入/Beyond", "喜欢", ""];
        const tagsPool = [["学习"], ["运动"], ["休息"], ["白噪音"], ["学习", "专注"], []];
        const p = dirs[i % dirs.length];
        return {
          name: `测试曲目 ${String(i + 1).padStart(2, "0")}`,
          tag: "自定义", tagColor: null,
          path: p, tags: tagsPool[i % tagsPool.length], source: p === "内置" ? "builtin" : (p === "下载" ? "download" : ""),
        };
      }),
    },
    music_get_custom_tags: { 白噪音: "#48dbfb", 学习: "#ff9ff3", 运动: "#ff9664", 休息: "#5AB48C", 专注: "#a29bfe" },
  },

  /** 榜单有数据（用于核对工具栏换行/表格） */
  "charts-rich": {
    charts_fetch: {
      songs: [
        { title: "晴天", artist: "周杰伦", duration: 269 },
        { title: "海阔天空", artist: "Beyond", duration: 326 },
        { title: "夜空中最亮的星", artist: "逃跑计划", duration: 252 },
      ],
    },
  },

  /** 有更新（用于核对更新弹窗） */
  "update-available": {
    check_update: { hasUpdate: true, version: "4.9.0", notes: "· 音乐库目录树\n· 移动端适配修复" },
  },

  /** 云模式 + 已登录（用于核对账号面板） */
  "cloud-signed-in": {
    get_api_mode: "cloud",
    cloud_get_session: { username: "demo", token: "mock-token", expiresAt: null },
  },
};

/* ─────────────────────────────────────────────────────────────── */

/**
 * 生成注入脚本（在页面脚本前执行）。
 * @param {{ scenario?: keyof typeof SCENARIOS, overrides?: Record<string, unknown>, quiet?: boolean }} [opts]
 */
export function buildMockInitScript(opts = {}) {
  const scenarioName = opts.scenario ?? "fresh";
  const scenario = SCENARIOS[scenarioName];
  if (!scenario) {
    throw new Error(`未知场景 "${scenarioName}"。可用：${Object.keys(SCENARIOS).join(", ")}`);
  }
  const fixtures = { ...BASE_FIXTURES, ...scenario, ...(opts.overrides ?? {}) };
  const quiet = opts.quiet === true;

  return `(() => {
  const FIXTURES = ${JSON.stringify(fixtures)};
  const SCENARIO = ${JSON.stringify(scenarioName)};
  const QUIET = ${quiet ? "true" : "false"};
  const COMMAND_EMITS = ${JSON.stringify(COMMAND_EMITS)};

${installMock.toString()}

  installMock(FIXTURES, { scenario: SCENARIO, quiet: QUIET, emits: COMMAND_EMITS });
})();`;
}

/**
 * ⚠️ 这个函数会被 toString() 序列化后注入页面 ——
 *    **不能引用外部作用域的任何变量**，所有依赖必须由参数传入。
 */
function installMock(fixtures, opts) {
  const cbRegistry = new Map();     // id -> { fn, once }
  const listeners = new Map();      // event -> Map(eventId -> handlerId)
  const calls = [];
  const unmocked = new Set();
  const overrides = new Map();
  let nextCbId = 1;
  let nextEventId = 1;

  const resolve = (cmd) => {
    if (overrides.has(cmd)) return overrides.get(cmd);
    if (Object.prototype.hasOwnProperty.call(fixtures, cmd)) return fixtures[cmd];
    return undefined;
  };

  const clone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

  /** 把事件派发给所有登记的回调 */
  const emit = (event, payload) => {
    const set = listeners.get(event);
    if (!set || !set.size) return 0;
    let n = 0;
    for (const [, handlerId] of Array.from(set)) {
      const rec = cbRegistry.get(handlerId);
      if (!rec) continue;
      try { rec.fn({ event, id: nextEventId++, payload }); n++; }
      catch (e) { console.error('[ui-mock] 事件回调抛错', event, e); }
    }
    return n;
  };

  // @tauri-apps/api/event 的 _unlisten 会调它
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(event, eventId) { listeners.get(event)?.delete(eventId); },
  };

  window.__TAURI_INTERNALS__ = {
    transformCallback(cb, once) {
      const id = nextCbId++;
      cbRegistry.set(id, { fn: cb, once: !!once });
      return id;
    },
    unregisterCallback(id) { cbRegistry.delete(id); },
    convertFileSrc(p) { return String(p); },

    async invoke(cmd, args) {
      calls.push({ cmd, args, t: Date.now() });

      // ── 事件插件
      if (cmd === 'plugin:event|listen') {
        const event = args?.event;
        const eventId = nextEventId++;
        if (!listeners.has(event)) listeners.set(event, new Map());
        listeners.get(event).set(eventId, args?.handler);
        return eventId;
      }
      if (cmd === 'plugin:event|unlisten') {
        listeners.get(args?.event)?.delete(args?.eventId);
        return null;
      }
      if (cmd === 'plugin:event|emit' || cmd === 'plugin:event|emit_to') {
        emit(args?.event, args?.payload);
        return null;
      }

      // ── fixture
      const hit = resolve(cmd);
      if (hit === undefined) {
        unmocked.add(cmd);
        if (!opts.quiet) console.warn('[ui-mock] 未覆盖命令（返回 null）:', cmd, args);
        return null;
      }
      const value = typeof hit === 'function' ? hit(args) : clone(hit);

      // ── 命令 → 事件：有些命令只是"请求"，真实数据由后端**事件**推回
      //    （如 music_get_playlist → music-playlist 事件）。不派发的话，
      //    依赖事件的界面永远停在空态 —— 这是本 mock 早期的一个真实缺口。
      const evt = opts.emits && opts.emits[cmd];
      if (evt) {
        const payload = clone(value);
        // 异步派发，模拟真实后端"先返回、后推事件"的时序
        setTimeout(() => { try { emit(evt, payload); } catch (e) { console.error('[ui-mock] 派发事件失败', evt, e); } }, 0);
      }

      return value;
    },
  };

  // 给"用 getCurrentWebview/getCurrentWindow"的代码兜底（本项目目前没用到，但防止未来报错）
  window.__TAURI_INTERNALS__.metadata = { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } };

  window.__UI_MOCK__ = {
    scenario: opts.scenario,
    ready: true,
    calls,
    get unmocked() { return Array.from(unmocked).sort(); },
    emit,
    /** 运行中改 fixture（可在 --eval 里用） */
    set(cmd, value) { overrides.set(cmd, value); },
    clearOverride(cmd) { overrides.delete(cmd); },
    /** 已登记的事件监听（排查"事件没接到"） */
    get listenedEvents() { return Array.from(listeners.keys()).sort(); },
    /** 发给测试辅助：统计某命令被调了几次 */
    countOf(cmd) { return calls.filter((c) => c.cmd === cmd).length; },
  };

  if (!opts.quiet) {
    console.log('[ui-mock] 已注入 Tauri IPC mock，场景 =', opts.scenario,
      '｜ fixture 数 =', Object.keys(fixtures).length);
  }
}
