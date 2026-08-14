# PomoSolo PWA（PWA部门）

> 部门：PWA部门 ｜ 状态：v1 开发中 ｜ 部署：`start.pomogrow.top`（等服务器部门）

桌面优先的 PWA：**核心计时 + 音乐播放/标签/同步听歌 + 设置 + 教程 + 自习室（含 P2P 传歌）+ 侧栏统计计数**。
砍去：菜园子、专注模式/前台检测、统计/图表面板、AI、窗口/迷你模式、B站下载（排队中）。

## 核心原则：真实复用，不 copy

`src/pwa` **不复制**桌面端组件，而是通过 Vite alias 让桌面端 `src/` 源码原样编译进 PWA：

| alias | 指向 | 作用 |
|---|---|---|
| `@` | `../`（即 `src/`） | 组件/store/API 原样复用 |
| `@tauri-apps/api` | `./tauri/` | 浏览器 shim：`invoke`/`listen`/`emit`/`getVersion`/`open` |
| `@tauri-apps/plugin-dialog` | `./tauri/plugin-dialog.ts` | 文件框（PWA 直接返回 null） |

> 重构桌面端 `src/` 下的组件/store 时，PWA 自动同步——这就是"一次性解决"的复用方式。

## 目录结构

```
src/
├── components/  stores/  api/   ← 桌面端源码（PWA 原样编译，勿在 pwa/ 复制）
└── pwa/                        ← PWA 专属层（全部在此）
    ├── index.html               PWA 入口（root = 本目录）
    ├── main.ts                  引导：默认设置 + SW 注册 + mount
    ├── App.vue                  主壳（流式全窗口布局 + 手机抽屉；复用全部组件）
    ├── styles.css               复用组件尺寸/触摸目标覆盖层（改色走 global.css token）
    ├── vite.config.ts           PWA 构建配置（vite-plugin-pwa）
    ├── tsconfig.json            PWA 类型检查配置（含 ../ 桌面端源码）
    ├── eventBus.ts              应用内事件总线（listen/emit 的落点）
    ├── http.ts                  REST 客户端（Bearer + 401 自动刷新重试）
    ├── ws.ts                    WebSocket 客户端（心跳 10s / 自动重连 / 请求-响应 id）
    ├── storage.ts               localStorage 封装（数据/设置/认证/音乐元数据）
    ├── config.ts                常量（API 地址 / 缓存名 / PWA 版本）
    ├── music/                   音乐子系统
    │   ├── engine.ts            HTML5 Audio 引擎（事件与桌面端一致）
    │   ├── manifest.ts          音乐清单加载（3 内置 + 曲库）
    │   ├── sources.ts           歌曲 URL + Cache API 下载/查询
    │   ├── idb.ts               IndexedDB 分片/Blob（P2P 传歌落盘 + 合并）
    │   ├── bytes.ts             读取歌曲原始字节（P2P 发送端）
    │   └── types.ts             ManifestSong 类型
    ├── tauri/                   @tauri-apps/api 浏览器替身
    │   ├── core.ts              invoke() → 命令注册表
    │   ├── event.ts             listen/once/emit/emitTo → eventBus
    │   ├── app.ts               getVersion → PWA_VERSION
    │   ├── plugin-dialog.ts     文件框 → null / message → alert
    │   └── commands/            命令实现
    │       ├── registry.ts      ★ invoke 唯一咽喉：命令名 → 实现
    │       ├── data.ts / auth.ts / sync.ts
    │       ├── studyRoom.ts / music.ts / musicSync.ts
    │       ├── window.ts / system.ts / stubs.ts（砍去功能 → 明确报错）
    ├── public/
    │   ├── manifest.webmanifest  PWA 清单
    │   ├── icons/                128 / 512 图标
    │   ├── tracks/               3 首内置主题曲（离线可播）
    │   └── music-manifest.json   音乐清单（构建时生成，41 首）
    └── scripts/
        └── generate-music-manifest.mjs  读 music-player/music + tags.json → 清单
```

## 命令

```bash
npm run pwa:manifest   # 重新生成音乐清单（改了曲库后跑）
npm run pwa:dev        # 开发服务器 http://127.0.0.1:5199
npm run pwa:build      # 类型检查(src/pwa + 桌面端) + 构建 → pwa-dist/
npm run pwa:preview    # 预览 pwa-dist/
```

## 关键机制

### 命令路由（invoke 唯一咽喉）
桌面端 `src/api/*.ts` 都调 `invoke("cmd", args)` → 经 alias 落到 `tauri/core.ts` →
`tauri/commands/registry.ts` 路由到：localStorage（数据/设置/标签）、REST（认证/云同步/自习室 REST）、
WebSocket（自习室/同步听歌/P2P 信令）、HTML5 Audio（播放）、IndexedDB（P2P 分片）。
未实现命令抛 `PWA 端暂不支持`，复用组件 `.catch()` 兜底。

### 事件流（复用组件零改动消费）
桌面端事件 `music-ready/progress/track-change/play-state/...`、`ws-event`、`ws-disconnected` 由
PWA 自己的引擎/WS 客户端经 `eventBus.ts` 喂给 `listen()`，MusicPlayer.vue / StudyRoom.vue 的事件处理
与桌面端完全一致。

### 音乐（浏览器缓存策略）
- 3 首主题曲内置（`/tracks/`），**离线可播**；
- 其余曲目走服务器曲库 `/music/`，播放即进 Cache Storage（`pomo-pwa-music-v1`），缓存后离线可听；
- SW 只预缓存外壳（排除 mp3），避免首屏 14.5MB 拖慢；
- 标签改动存 localStorage，与桌面端互不影响。

### 同步听歌 / P2P
- 复用 StudyRoom.vue：WS 事件 + 心跳 + 自动重连；
- P2P 分片：收到分片存 IndexedDB，合并成 Blob → object URL 播放；发送端从缓存/IDB/远程读字节。

## 响应式适配（复用 ≠ UI 完全一致）

PWA 外壳是**流式全窗口布局**（不做整壳缩放），按断点分级适配：

- **桌面（≥560px）**：侧边栏**贴最左**；计时器/播放器在**主区域（右侧）内居中、同一竖轴**——
  不做屏幕中心补偿（正方形/瘦窗口下屏幕补偿反而把内容推左、右侧露空档）；
  - **≥1200px**：尺寸上档（圆环 300~420px、按钮 56px）；
  - **≥1920px 宽且 ≥1200px 高（4K/高分屏）**：再上档（圆环 ≤460px、主按钮 64px、
    顶栏按钮 46px、播放器 ≤620px），大屏不再显得按钮小气；
- **手机（<560px）**：侧边栏变为**抽屉**（☰ 打开 + 遮罩关闭），顶栏只放 ☰ + 模式拨杆，
  功能按钮列在主区域右上、**避开顶栏黑色蒙版**；主按钮 52px（≥44px 触摸目标）、
  播放器贴底适配安全区（`env(safe-area-inset-bottom)`）；
- 复用组件不逐一生效改动：尺寸/间距/触摸目标由 `src/pwa/styles.css` 覆盖层统一调整
  （`!important` 压过 scoped 样式，只调尺寸不动行为）；
- **改色只改一处**：PWA 外壳与覆盖层的颜色/圆角/触摸尺寸全部引用 `src/styles/global.css`
  的共享 token（`--shell-*`，桌面端既有变量不变），改色只动 global.css，两端生效。

> 布局验证：开发时可用无头浏览器 + CDP 探针读取各元素 `getBoundingClientRect`
> （见 `layout_probe` 思路），量化核对对齐与居中，避免凭感觉改错地方。

## 版本号策略（发布触发）

- **版本号只在"要发布"时改**（`src/pwa/config.ts` 的 `PWA_VERSION`），日常 commit **不要**动它；
- 服务器部门约定：**看到版本号变化即发布**。改完版本号跑 `npm run pwa:build` 并推送即可。

## 与桌面端的差异 / 已知限制

- 无 Rust 能力：无本地文件系统/前台检测/系统通知（`window.showNotification` 用浏览器 Notification）；
- 认证：**不保存明文密码**，靠 refresh token（30 天滚动）自动登录；
- 服务器曲库未托管前，library 歌曲播放失败（内置 3 首不受影响）；
- 登录态变化时 WS 自动用新 token 重连；登出调用 `ws.disconnect()`；
- **WS 自动 wss**（v0.1.1）：HTTPS 页面或后端为 https 时自动 `wss://`（与主部门 v4.7.12 修 Rust 侧 TLS 为同源问题）；
- 开发默认指向 `https://api.pomogrow.top`（后端权威域名），联调需服务器 CORS（见 PWA-requirements P2）。

## 测试

- PWA 复用层的逻辑由桌面端 vitest 套件覆盖（`npm test`，1180 用例全绿）；
- PWA 专属薄层（ws/http/engine）依赖浏览器 API，暂未纳入 vitest（浏览器冒烟待部署后人工验证）。

## 对接文档

- 服务器部门部署要求：`server-planning/PWA-requirements.md`（域名/HTTPS/静态托管/曲库/CORS/将来 B站下载代理）。
