# Tauri 迁移踩坑总录

> 本文档是 PomoSolo v3.x（Electron）→ v4.0（Tauri v2 + Vue 3）迁移过程的**主文档**，作为所有模块文档的入口、全局踩坑记录以及一劳永逸的配置参考。
>
> **适用读者**：后续维护者、新加入的开发者、任何准备在 Tauri v2 上做无系统边框圆角窗口应用的同学。
>
> **核心原则**：未来再做类似改动前，先读完本文档对应章节，避免重复踩坑。

---

## 1. 文档目的

1. **避免未来踩相同的坑**：把迁移过程中"试错 → 否定 → 正确方案"的完整链条记录下来，让后人不必从头试一遍。
2. **作为模块文档导航**：`docs/modules/` 下的各模块文档都从本文档入口进入。
3. **作为新项目的"复制起点"**：第 5 节给出了一组验证过的最终配置组合，新 Tauri 项目可直接套用。
4. **作为新增功能时的 Checklist**：第 6 节列出了每新增一个模块必须逐项核对的事项，避免遗漏 `invoke_handler` 注册、CSP 放行、camelCase 对齐等高频坑点。

> **与其他文档的关系**：
> - 本文档只记录"坑"和"最终方案"，不重复迁移映射表（见 [MIGRATION.md](./MIGRATION.md)）、架构设计（见 [ARCHITECTURE.md](./ARCHITECTURE.md)）。
> - 模块特定的踩坑详见 [docs/modules/](./modules/) 下各模块文档，本文档只汇总跨模块、全局性的踩坑。

---

## 2. 模块文档导航

模块文档统一存放在 [`docs/modules/`](./modules/) 目录下。每个模块文档记录该模块的迁移方案、踩坑历史和最终实现。

| 模块 | 文档 | 状态 | 主要踩坑类别 |
|------|------|------|------------|
| 窗口系统 | [modules/window-system.md](./modules/window-system.md) | ✅ 已完成 | A 类（双层圆角、DWM 边框、层叠上下文） |
| 弹窗系统 | [modules/modal-system.md](./modules/modal-system.md) | ✅ 已完成 | B 类（遮罩扩散、动画、通用模板） |
| 音乐播放器 | [modules/music-player.md](./modules/music-player.md) | ✅ 已完成 | A/B/C 类（子进程通信、UTF-8 编码、布局、事件映射） |
| 菜园子 | [modules/garden.md](./modules/garden.md) | ✅ 已完成 | D 类（键名大小写、数据类型、窗口配置） |
| 侧边栏与模式 | [modules/sidebar-and-modes.md](./modules/sidebar-and-modes.md) | ✅ 已完成 | A/B/E 类（侧边栏、拨杆、迷你模式、动画） |
| 云端认证 + 歌曲热榜 | [modules/cloud-and-charts.md](./modules/cloud-and-charts.md) | ✅ 已完成 | C/D 类（Supabase、CSP、命令注册、DownloadStatus） |
| 前后端通信 | `modules/ipc.md` | 🚧 待编写 | C 类（命令注册、CSP、类型对齐） |
| 数据持久化 | `modules/data.md` | 🚧 待编写 | C/D 类（路径、并发锁） |
| 前台检测 | `modules/foreground.md` | 🚧 待编写 | F 类（windows crate、HWND 桥接） |
| 计时器 | `modules/timer.md` | 🚧 待编写 | 前端 setInterval、时间戳校正 |
| AI 助手 | `modules/ai.md` | 🚧 待编写 | C 类（DeepSeek、CSP） |

> 编写新模块文档时，请在本文档表格中把状态从 🚧 改为 ✅，并补全"主要踩坑类别"列。

---

## 3. 架构总览

### 3.1 迁移前后的整体架构变化

| 维度 | Electron v3.x | Tauri v2 v4.0 |
|------|---------------|----------------|
| 主进程语言 | JavaScript (Node.js) | Rust |
| 渲染层 | Chromium 内嵌（独立进程） | 系统 WebView2（同进程内） |
| 前端框架 | 原生 JS + IIFE 全局变量 | Vue 3 + TypeScript + Pinia |
| 桥接层 | `preload.js` (`contextBridge`) | `src/api/*.ts` (直接 `invoke`) |
| 窗口边框 | `frame: false` + CSS | `decorations:false` + `transparent:true` + `shadow:false` + DWM API + CSS |
| IPC | `ipcMain.handle` / `ipcRenderer.send` | `#[tauri::command]` / `invoke` |
| 加密 | `safeStorage`（DPAPI） | AES-256-GCM（纯 Rust） |
| 前台检测 | Python `foreground_inspection.exe` | Rust + `windows` crate（无子进程） |
| 音乐播放器 | Python `music.exe` | 同（保留 Python，Rust 子进程封装） |
| 子进程孤儿 | Python 主线程阻塞，需手动 kill | `Drop` trait 自动 `start_kill` |
| 配置 | `package.json` + `electron-builder` | `tauri.conf.json` + `Cargo.toml` |

### 3.2 当前目录结构（仅关键部分）

```
electron_pomodoro/
├── src/                        # Vue 3 前端
│   ├── App.vue                 # 主布局（窗口裁剪、Modal、侧边栏）
│   ├── main.ts                 # createApp + Pinia
│   ├── styles/global.css       # CSS 变量 + .app-modal-overlay 通用类
│   ├── components/             # UI 组件（含 Modal.vue、MiniMode.vue 等）
│   ├── stores/                 # Pinia 状态
│   └── api/                    # invoke 封装（替代 preload.js）
├── src-tauri/
│   ├── tauri.conf.json         # 窗口/CSP/bundle 配置
│   ├── Cargo.toml              # Rust 依赖（windows 0.58）
│   └── src/
│       ├── lib.rs              # Builder + invoke_handler + setup（disable_window_rounding）
│       ├── state.rs            # AppState / MusicState / ChartsState
│       ├── commands/           # #[tauri::command] 入口
│       │   ├── window.rs       # 含 disable_window_rounding + HWND 桥接
│       │   ├── garden.rs       # 含 signIn 键名兼容
│       │   └── charts.rs       # 含 DownloadStatus 字面量
│       └── modules/            # 业务实现
├── docs/                       # 文档（本文档、MIGRATION.md、ARCHITECTURE.md、modules/）
└── electron/                  # 原版 Electron 代码（保留作参考，第 8 节）
```

### 3.3 分层职责

| 层 | 路径 | 职责 |
|----|------|------|
| Components | `src/components/` | 纯 UI 渲染，不直接 `invoke` |
| Stores | `src/stores/` | 跨组件状态、业务编排、调用 API 层 |
| API 封装 | `src/api/` | `invoke()` + TypeScript 类型 |
| Commands | `src-tauri/src/commands/` | `#[tauri::command]` 入口、参数校验 |
| Modules | `src-tauri/src/modules/` | 业务实现、加密、文件 IO、网络 |
| State | `src-tauri/src/state.rs` | 全局共享状态（Mutex 保护） |

---

## 4. 全局踩坑记录（按类别分组）

> 每条记录都包含：**现象** → **原因** → **错误尝试**（如有）→ **正确方案** → **代码位置**。

---

### A. 窗口系统类

#### A1. 双层圆角（系统圆角 + CSS 圆角）

**现象**：在 Windows 11 22000+ 上，窗口四角同时出现"系统圆角"和"CSS 圆角"，圆角处能看到方形不透明痕迹，并伴随系统描边。

**原因**：
- `decorations: false` + `transparent: true` 只移除了标题栏，**不影响** DWM 的窗口圆角偏好。
- Windows 11 22000+ 默认对 Win32 顶层窗口应用约 8px 的系统圆角（`DWMWCP_ROUND`）。
- 前端 CSS 又在 `.window-frame` / `.container` 上画了 `border-radius: 20px`，两层圆角不一致 → 缝隙、描边、方形痕迹。

**正确方案**（三件套，缺一不可）：
1. `tauri.conf.json` 中 `shadow: false`：移除 DWM 系统边框（细线阴影 / 尖角描边）。
2. `lib.rs` 的 `setup` 钩子中调用 `disable_window_rounding(&window)`：通过 `DwmSetWindowAttribute` 把圆角偏好设为 `DWMWCP_DONOTROUND`。
3. 前端 `.window-frame` + `.container` 同时设 `border-radius` + `overflow: hidden`：由 CSS 统一负责圆角和裁剪。

**代码位置**：
- `src-tauri/tauri.conf.json` L13-27（主窗口）、L28-40（garden 窗口）
- `src-tauri/src/lib.rs` L83-95（setup 中对 main / garden 两个窗口都调用）
- `src-tauri/src/commands/window.rs` L82-111（`disable_window_rounding` 实现）
- `src/App.vue` L397-404（`.window-frame`）、L424-436（`.container`）

#### A2. DWM 系统边框（细线 + 尖角）

**现象**：圆角去掉后，窗口周围仍有一圈细线阴影，且四角是尖的，破坏 CSS 圆角效果。

**原因**：Tauri 默认 `shadow: true`，DWM 会绘制系统边框阴影。

**正确方案**：`tauri.conf.json` 中窗口配置 `shadow: false`。

**代码位置**：`src-tauri/tauri.conf.json` L25、L38。

#### A3. 错误尝试：移除 `WS_THICKFRAME` 导致 DWM 回退老式渲染

**错误尝试**：曾经尝试通过 `SetWindowLongPtrW` 直接移除 `WS_THICKFRAME` 等样式位来"去掉边框"。

**后果**：DWM 检测到窗口不再符合现代渲染条件，**回退到老式边框渲染**（粗边框 / 经典样式），比原来更难看。

**正确方案**：**不要在 Rust 端手动修改窗口样式位**。只通过 `shadow: false`（移除系统边框）+ `disable_window_rounding`（关闭系统圆角）+ CSS（统一圆角裁剪）三件套解决。

**代码位置**：`src-tauri/src/lib.rs` L84-86 的注释明确写明"不要在此处修改窗口样式（WS_THICKFRAME 等），否则 DWM 会回退到老式边框渲染"。

#### A4. 正确方案汇总：shadow:false + disable_window_rounding + .container 圆角裁剪

最终生效的配置组合（新项目可直接复制，详见第 5 节）：

```jsonc
// tauri.conf.json
"windows": [{
  "decorations": false,
  "transparent": true,
  "shadow": false
  // ...
}]
```

```rust
// lib.rs setup
#[cfg(windows)]
{
    if let Some(main_window) = _app.get_webview_window("main") {
        commands::window::disable_window_rounding(&main_window);
    }
    // 多窗口都要调用
    if let Some(garden_window) = _app.get_webview_window("garden") {
        commands::window::disable_window_rounding(&garden_window);
    }
}
```

```css
/* App.vue */
.window-frame { border-radius: 20px; overflow: hidden; }
.container { border-radius: 20px; overflow: hidden; }  /* 内层也要，裁剪 Modal 遮罩 */
```

> **关键细节**：`.container` 必须和 `.window-frame` 用相同的 `border-radius` + `overflow: hidden`。两者填满一致，不会产生双层圆角缝隙；`.container` 的 `overflow: hidden` 负责把 Modal 暗色遮罩裁剪在圆角内（见 B1）。

#### A5. `.main-content` `overflow: hidden` 会裁剪弹框

**现象**：音乐播放器的设备列表弹框、播放列表、音量滑块"被左侧侧边栏遮挡"，实际上是被父容器物理裁剪。

**原因**：如果给 `.main-content` 加 `overflow: hidden`，所有从 MusicPlayer 向上冒出的浮层都会被裁剪。

**正确方案**：**不要给 `.main-content` 设 `overflow: hidden`**。圆角裁剪统一交给 `.container` 的 `overflow: hidden` 负责。`.main-content` 只用 `z-index: 1` 建立层叠上下文（见 A6）。

**代码位置**：`src/App.vue` L699-715 的注释明确说明"不要设置 overflow:hidden"。

#### A6. z-index 层叠上下文（`.main-content` 需要 `z-index: 1`）

**现象**：MusicPlayer 的设备弹框（`z-index: 200`）会"穿透"到外层 Modal（`.app-modal-overlay` `z-index: 3000`）之上，视觉上盖住弹窗。

**原因**：`.main-content` 没有建立独立层叠上下文，内部高 `z-index` 的元素会越过外层 Modal。

**正确方案**：给 `.main-content` 设 `position: relative; z-index: 1;`，将其内部的 `z-index: 200` 元素约束在 main-content 层级内，不会越过外层 `z-index: 3000` 的 Modal 遮罩。

**代码位置**：`src/App.vue` L703-705 的注释 + L713（`z-index: 1`）。

---

### B. 前端布局类

#### B1. Modal 遮罩 `position: fixed` 扩散到圆角外

**现象**：Modal 遮罩层（暗色半透明背景）扩散到窗口圆角之外，圆角处能看到方形暗色痕迹，破坏圆角效果。

**原因**：如果遮罩用 `position: fixed`（相对视口），它会铺满整个窗口的矩形外框，**不被** `.container` 的 `overflow: hidden` 裁剪。

**正确方案**：所有 Modal 遮罩统一用 `position: absolute`（相对最近的定位祖先 `.container`），这样会被 `.container` 的 `overflow: hidden` 裁剪在圆角内。

**代码位置**：`src/styles/global.css` L116-130 的 `.app-modal-overlay` 通用类，注释明确"相对 .container 定位，被 .container 的 overflow:hidden 裁剪在圆角内"。

#### B2. 通用解决方案：`.app-modal-overlay` 通用类

为了避免每个 Modal 组件都手写一遍 `position / inset / z-index / background / flex`，提取了通用类 `.app-modal-overlay`：

```css
/* src/styles/global.css */
.app-modal-overlay {
  position: absolute;   /* 相对 .container，被圆角裁剪 */
  inset: 0;
  z-index: 3000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;
}
```

**使用约定**：
- 所有新 Modal 组件的遮罩层直接 `<div class="app-modal-overlay">`，或使用 `<Modal>` 组件（其根节点已带此类）。
- **禁止**在新 Modal 中手写 `position: fixed` 或 `z-index` 大于 3000。
- `Modal.vue` 内部根节点同时带 `app-modal-overlay` 和 `modal-overlay` 两个 class（前者提供定位，后者预留组件特有样式）。

**代码位置**：`src/styles/global.css` L116-130；`src/components/Modal.vue` L93-97。

#### B3. CSS 变量无 fallback（`var(--accent)` 无 fallback）

**现象**：在变量未定义或拼写错误的场景下，CSS 属性直接失效（背景变透明、边框消失），且难以排查。

**原因**：`var(--accent)` 不带第二个参数时，若变量未定义则该属性计算为无效值。

**正确方案**：
- 所有 `var(--xxx)` 必须带 fallback，例如 `var(--accent, #e94560)`。
- 新增 CSS 变量时，同时在 `:root`（亮色）和 `body.dark-theme`（深色）中定义，避免在某个主题下缺失。
- 全局变量定义集中在 `src/styles/global.css` 顶部，不在组件内重新定义同名变量。

**代码位置**：`src/styles/global.css` L3-52（亮色 / 深色变量完整对齐）。

#### B4. 原生弹窗（`window.confirm` / `prompt`）在 Tauri 下显示系统弹窗

**现象**：在 Electron 中 `window.confirm` 显示的是 Chromium 风格弹窗；在 Tauri 下，WebView2 会调起**操作系统原生弹窗**（Windows 上是系统对话框），样式与应用风格完全不一致，且无法自定义按钮文案、无法被圆角裁剪、会脱离应用窗口。

**正确方案**：**全部禁用 `window.confirm` / `window.prompt` / `window.alert`**，改用自定义 Vue 组件（基于 `<Modal>`）。项目中已经为以下场景替换：
- 下载免责声明：`src/components/Charts.vue` 中的自定义免责声明弹窗。
- 下载歌曲名输入：`src/components/DownloadDialog.vue`（替代 `window.prompt`，支持输入框）。
- 各种确认 / 取消场景：统一用 `<Modal>`。

**代码位置**：`src/components/Charts.vue` L34、L36、L112、L282、L314；`src/components/DownloadDialog.vue` L5 的注释"替代原生 window.prompt / window.confirm"。

---

### C. 前后端通信类

#### C1. Rust 命令未在 `invoke_handler` 注册

**现象**：前端 `invoke("xxx")` 调用直接失败，Promise reject，错误信息类似 `command xxx not found`。

**原因**：`#[tauri::command]` 标注的函数**必须**在 `lib.rs` 的 `tauri::generate_handler![...]` 宏中显式注册，否则前端无法调用。这是 Tauri v2 最容易遗漏的坑点。

**正确方案**：
1. 在 `commands/*.rs` 中定义 `#[tauri::command] pub async fn xxx(...) -> Result<T, String>`。
2. 在 `commands/mod.rs` 中 `pub mod xxx;`。
3. 在 `lib.rs` 的 `generate_handler!` 宏中添加 `commands::xxx::xxx,`。
4. 三步缺一不可。

**代码位置**：`src-tauri/src/lib.rs` L15-82（完整注册列表）；`src-tauri/src/commands/mod.rs`（模块声明）。

> **历史教训**：`MIGRATION.md` 第 3.6 节记录了音乐播放器"基础设施完成，命令未注册"的状态——`modules/music_process.rs` 已实现子进程通信，但 `commands/music.rs` 的命令未注册到 `generate_handler!`，导致前端 `api/music.ts` 调用失败。当前 `lib.rs` L62-77 已补全注册。

#### C2. 前后端返回类型不匹配（DownloadStatus `"success"` vs `"downloaded"`）

**现象**：前端按某个字面量判断下载结果，但 Rust 返回的是另一个字面量，导致逻辑分支失效。

**原因**：`charts.rs::execute_download` 在退出码 0 时返回 `status: "downloaded"`（而非直觉上的 `"success"`），退出码 2 返回 `"exists"`，3 返回 `"no_video"`，4 返回 `"no_instrumental"`，其他返回 `"failed"`。前端如果误以为成功时 `status === "success"`，会走错分支。

**正确方案**：前后端字面量必须严格对齐。`src/api/charts.ts` 已通过注释 + `DownloadStatus` 联合类型明确声明：

```ts
// src/api/charts.ts
// 注意：Rust 后端 charts.rs 在退出码 0 时返回 "downloaded"（而非 "success"），
// 退出码 2 返回 "exists"，3 返回 "no_video"，4 返回 "no_instrumental"，其他返回 "failed"。
export type DownloadStatus =
  | "downloaded" | "exists" | "no_video" | "no_instrumental" | "failed";
```

**代码位置**：`src-tauri/src/commands/charts.rs` L496-502；`src/api/charts.ts` L31-33。

> **通用规则**：凡是 Rust 返回的字符串字面量，前端必须用 `export type` 联合类型显式列出，并在 `api/*.ts` 的注释中记录每个字面量的来源（哪个退出码 / 哪个分支）。不要用 `string` 宽类型糊弄过去。

#### C3. 缺少 Rust `invoke handler` 导致前端失败

**现象**：前端调用 `invoke` 后报错，但 Rust 端明明已经写了 `#[tauri::command]` 函数。

**原因**：同 C1，但这里强调的是"调试路径"——遇到 `invoke` 失败时，**第一步**永远是检查 `lib.rs` 的 `generate_handler!` 列表，而不是去查前端 `api/*.ts` 封装。

**调试顺序**：
1. `lib.rs` 的 `generate_handler!` 中是否有该命令名？
2. `commands/mod.rs` 是否 `pub mod xxx;`？
3. Rust 端函数签名是否 `pub async fn`？返回是否 `Result<T, String>`？
4. 前端 `invoke("xxx", { args })` 的命令名是否拼写正确？参数是否 camelCase？
5. 浏览器 DevTools Network / Console 是否有更详细的错误？

#### C4. CSP 配置未允许外部域名

**现象**：前端 / Rust 端的网络请求被 CSP 拦截，报错类似 `Refused to connect to 'https://xxx'`。

**原因**：Tauri v2 的 CSP 比 Electron 严格得多，`connect-src` 默认只允许 `'self'`。任何外部域名（Supabase、DeepSeek、网易云、QQ音乐）都必须显式列入白名单。

**正确方案**：在 `tauri.conf.json` 的 `security.csp` 中，把所有需要访问的外部域名加入 `connect-src`：

```jsonc
// src-tauri/tauri.conf.json L43
"csp": "default-src 'self'; \
  style-src 'self' 'unsafe-inline'; \
  script-src 'self'; \
  img-src 'self' data:; \
  font-src 'self' data:; \
  connect-src 'self' \
    https://sjexeynibnfqxvwehnxk.supabase.co \   // Supabase
    https://api.deepseek.com"                    // DeepSeek
```

> **注意**：新增任何外部 API 调用时，必须同步更新 CSP。否则在 release build 下会直接失败。
> 网易云 / QQ音乐的榜单抓取走 Rust `reqwest`，**不经过 WebView**，因此**不需要**加进 CSP——这是 Tauri 的优势之一。

**代码位置**：`src-tauri/tauri.conf.json` L42-45。

---

### D. 数据结构类

#### D1. 键名大小写错误（`signin` vs `signIn`）

**现象**：菜园子签到后，前端读取 `gardenData.signIn` 拿到 `undefined`，签到状态丢失，下次又能再签一次（绕过幂等）。

**原因**：Rust 端 `serde_json` 默认按字段原样输出，前端 TypeScript 习惯用 camelCase。如果 Rust 写 `obj.entry("signin")` 而前端读 `signIn`，就永久对不上。

**正确方案**：
- **结构体字段 / JSON 键名**：在 `data.json` / `garden_data.json` 等**持久化文件**中，**统一使用前端期望的 camelCase**（如 `signIn`、`continuousDays`、`totalDays`、`weekRecords`）。因为前端既会读也会写，Rust 端用 `serde_json::Value` 操作时必须显式用 camelCase 字符串。
- **命令参数**：Tauri v2 自动把前端的 camelCase 转成 Rust 的 snake_case（如前端 `autoLogin` → Rust `auto_login`），这部分不用手动对齐。
- **结构体 Serialize**：如果用 `#[derive(Serialize)]`，字段名默认 snake_case，需要前端配合或加 `#[serde(rename_all = "camelCase")]`。

**代码位置**：`src-tauri/src/commands/garden.rs` L195-209，注释明确"注意：前端使用 camelCase 的 signIn"，并用 `obj.entry("signIn".to_string())` 显式写入 camelCase 键名。

#### D2. 数据类型错误（数组 vs 对象）

**现象**：`garden_data.json` 中 `signIn` 字段有时是数组、有时是对象，前端读取时崩溃（`signIn.continuousDays` 在数组上是 `undefined`）。

**原因**：旧版 Electron 数据格式与新版本不一致；或者某次代码改动改了 `signIn` 的形状但没做数据迁移。

**正确方案**：Rust 端在读取后做**兼容性归一化**——如果 `signIn` 不是对象，强制重置为空对象：

```rust
// src-tauri/src/commands/garden.rs L207-213
let signin = obj
    .entry("signIn".to_string())
    .or_insert(Value::Object(serde_json::Map::new()));
// 兼容旧数据格式：若 signIn 之前是数组则重置为对象
if !signin.is_object() {
    *signin = Value::Object(serde_json::Map::new());
}
```

> **通用规则**：凡是可能被旧版本写入的字段，Rust 端读取时都要做"类型断言 + 兜底重置"。`serde_json::Value` 的 `.as_object_mut() / .as_array_mut() / .as_u64()` 都返回 `Option`，必须处理 `None` 分支。

**代码位置**：`src-tauri/src/commands/garden.rs` L207-217、L256-266（`weekRecords` 兼容数组长度不足 7）。

---

### E. 动画类

#### E1. 侧边栏收起动画用 `translateX` 会留空白（应该用 `width` 动画）

**现象**：侧边栏收起时，内容被 `translateX(-100%)` 移出视窗，但侧边栏**仍占据原宽度**，留下一块透明空白区域；右侧主区域也不会自动填充。

**原因**：`transform` 不影响布局，元素移走后它原本占的位置还在。

**正确方案**：动画 `width`（从 `160px` → `0`），并配合 `padding` 和 `opacity` 一起过渡：

```css
/* src/App.vue L464-477 */
.sidebar {
  width: 160px;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              padding 0.3s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.2s ease;
}
/* 侧边栏收起：宽度变为 0，内容淡出，不产生透明区域 */
.container.sidebar-collapsed .sidebar {
  width: 0;
  padding-left: 0;
  padding-right: 0;
  border-right: none;
  opacity: 0;
}
```

> **关键**：`transition: width` 比 `transition: transform` 性能略差（触发 reflow），但这是布局动画唯一正确的方式。如果性能敏感，可考虑 `grid-template-columns` 动画。

**代码位置**：`src/App.vue` L464-498（侧边栏 + ModeSlider 联动滑出）。

#### E2. 所有 Modal 出现时都要有动画（`opacity` + `scale`）

**现象**：Modal 直接 `v-if` 显示，没有任何过渡，视觉上"啪"地一下弹出，体验生硬。

**正确方案**：用 Vue 的 `<Transition>` 包裹，`enter-from` / `leave-to` 同时做 `opacity: 0` 和 `transform: scale(0.92)`，过渡时间 0.25s，缓动函数用 `cubic-bezier(0.34, 1.56, 0.64, 1)`（带回弹）。

```vue
<!-- src/components/Modal.vue L92-125 -->
<Transition name="modal">
  <div v-if="visible" class="app-modal-overlay modal-overlay" @click="onBackgroundClick">
    <div class="modal-container" ...>...</div>
  </div>
</Transition>

<style>
.modal-enter-active, .modal-leave-active { transition: opacity 0.25s ease; }
.modal-enter-active .modal-container,
.modal-leave-active .modal-container {
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .modal-container,
.modal-leave-to .modal-container { transform: scale(0.92); }
</style>
```

> **约定**：所有新 Modal 都通过 `<Modal>` 组件实现，自带动画。不要手写 `v-if` + 无过渡的弹窗。

**代码位置**：`src/components/Modal.vue` L92-125、L209-228。

---

### F. 平台特定类

#### F1. Windows 11 DWM 圆角偏好

**背景**：Windows 11 22000+ 引入了 `DWM_WINDOW_CORNER_PREFERENCE`，可选值：
- `DWMWCP_DEFAULT`（系统决定，通常为圆角）
- `DWMWCP_DONOTROUND`（不圆角）
- `DWMWCP_ROUND`（圆角）
- `DWMWCP_ROUNDSMALL`（小圆角）

**坑**：Tauri 默认不修改这个偏好，Windows 11 会自动给 `decorations:false + transparent:true` 的窗口加圆角，与 CSS 圆角冲突（见 A1）。

**正确方案**：调用 `DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, &DWMWCP_DONOTROUND, ...)` 关闭系统圆角。

**代码位置**：`src-tauri/src/commands/window.rs` L82-111。

#### F2. Tauri 拖动：`data-tauri-drag-region`

**背景**：`decorations: false` 后窗口没有标题栏，无法拖动。Tauri v2 提供了一个 HTML 属性 `data-tauri-drag-region`，标注在任意元素上即可让该区域成为拖动手柄。

**正确方案**：在顶部留一条透明拖动条，标注 `data-tauri-drag-region`：

```vue
<!-- src/App.vue L245 -->
<div class="draggable"></div>
```

```css
/* src/App.vue L453-461 */
.draggable {
  -webkit-app-region: drag;   /* 兼容 Electron 旧代码（无副作用） */
  position: absolute;
  top: 0; left: 0;
  width: 100%;
  height: 35px;
  z-index: 1;
}
```

> 注意：当前 `.draggable` 没有显式写 `data-tauri-drag-region` 属性（Tauri 可能通过 `-webkit-app-region: drag` 也生效，但不保证）。新项目建议**两个都加**，保证跨版本兼容。MiniMode 组件已显式使用：

```vue
<!-- src/components/MiniMode.vue L31 -->
<div class="mini-draggable" data-tauri-drag-region></div>
```

**坑**：
- 拖动区域内的按钮（关闭 / 最小化）会失效，需要给按钮单独加 `data-tauri-drag-region="false"` 或把按钮放在拖动区域之外。
- 不要让整个窗口都成为拖动区，否则文本框、滑块都无法点击。

**代码位置**：`src/App.vue` L245、L453-461；`src/components/MiniMode.vue` L31；`src/components/garden/GardenMain.vue`。

#### F3. `windows` crate 版本桥接（Tauri 2.11 用 0.61，项目用 0.58）

**现象**：直接把 Tauri 的 `HWND` 传给 `windows` crate 的 API 时，类型不匹配，编译报错。

**原因**：Tauri 2.11 内部依赖 `windows 0.61`，而本项目 `Cargo.toml` 直接依赖 `windows 0.58`。两个版本的 `HWND` 是**不同的类型**，不能直接互换。

**正确方案**：通过 `.hwnd().0` 取出原始的 `*mut c_void` 指针，再用本 crate 的 `HWND` 重新构造：

```rust
// src-tauri/src/commands/window.rs L94-100
use windows::Win32::Foundation::HWND;
// ...
if let Ok(hwnd) = window.hwnd() {
    // hwnd.0 是 *mut c_void，跨版本稳定
    let hwnd = HWND(hwnd.0 as *mut std::ffi::c_void);
    // 后续用本 crate 的 HWND 调用 DWM API
    let preference = DWMWCP_DONOTROUND;
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &preference as *const _ as *const std::ffi::c_void,
            std::mem::size_of_val(&preference) as u32,
        );
    }
}
```

> **通用规则**：凡是 Tauri 内部依赖的 crate 与项目直接依赖的 crate 版本不一致时，**通过原始指针 / 基础类型桥接**，不要尝试强制转换类型本身。升级 `windows` crate 到 0.61 也可以，但要测试 Tauri 的其他 API 是否受影响。

**代码位置**：`src-tauri/src/commands/window.rs` L89-100（注释详细说明）；`src-tauri/Cargo.toml` L40-46（`windows = "0.58"`）。

---

## 5. 一劳永逸配置清单（新项目可直接复制）

以下配置组合已经在本项目验证通过，新 Tauri v2 + Vue 3 项目可直接复制后微调。

### 5.1 `tauri.conf.json`（窗口部分）

```jsonc
{
  "$schema": "https://schema.tauri.app/config/2",
  "app": {
    "windows": [
      {
        "title": "MyApp",
        "width": 520,
        "height": 560,
        "resizable": false,
        "center": true,
        "minimizable": true,
        "maximizable": false,
        "fullscreen": false,
        "decorations": false,      // 移除标题栏
        "transparent": true,       // 允许 CSS 透明背景
        "shadow": false,           // 移除 DWM 系统边框
        "alwaysOnTop": false
      }
    ],
    "security": {
      // CSP 必须显式列出所有外部域名
      "csp": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://your-api.example.com"
    }
  }
}
```

### 5.2 `Cargo.toml`（Windows 依赖）

```toml
[target.'cfg(windows)'.dependencies]
windows = { version = "0.58", features = [
    "Win32_Foundation",
    "Win32_UI_WindowsAndMessaging",
    "Win32_System_Threading",
    "Win32_Graphics_Dwm",   # DwmSetWindowAttribute
] }
```

### 5.3 `lib.rs`（setup 钩子）

```rust
.setup(|_app| {
    #[cfg(windows)]
    {
        // 所有窗口都要调用，包括 secondary windows
        if let Some(main_window) = _app.get_webview_window("main") {
            disable_window_rounding(&main_window);
        }
    }
    #[cfg(debug_assertions)]
    {
        let main_window = _app.get_webview_window("main").unwrap();
        main_window.open_devtools();
    }
    Ok(())
})
```

### 5.4 `disable_window_rounding` 函数

完整代码见 `src-tauri/src/commands/window.rs` L82-111（含 `#[cfg(not(windows))]` 的空实现，保证跨平台编译）。

### 5.5 前端 CSS 模板

```css
/* global.css */
html, body, #app {
  width: 100%; height: 100%;
  overflow: hidden;
  background: transparent;   /* 让 transparent:true 生效 */
}

/* 通用 Modal 遮罩 */
.app-modal-overlay {
  position: absolute;       /* 相对 .container，被圆角裁剪 */
  inset: 0;
  z-index: 3000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}
```

```css
/* App.vue */
.window-frame {
  width: 520px; height: 560px;
  border-radius: 20px;
  overflow: hidden;
}
.container {
  width: 100%; height: 100%;
  border-radius: 20px;       /* 与 .window-frame 一致 */
  overflow: hidden;          /* 裁剪 Modal 遮罩 */
}
.main-content {
  position: relative;
  z-index: 1;                /* 建立层叠上下文，约束内部高 z-index */
  /* 不要 overflow: hidden */
}
```

### 5.6 命令注册三步走

1. `commands/xxx.rs` 定义 `#[tauri::command] pub async fn xxx(...) -> Result<T, String>`。
2. `commands/mod.rs` 添加 `pub mod xxx;`。
3. `lib.rs` 的 `generate_handler!` 添加 `commands::xxx::xxx,`。

---

## 6. 新增功能 Checklist

新增任何模块 / 命令 / 弹窗时，**逐项核对**以下事项：

### 6.1 Rust 后端

- [ ] 命令函数标注 `#[tauri::command]`，返回 `Result<T, String>`，错误信息中文友好。
- [ ] 在 `commands/mod.rs` 中 `pub mod xxx;`。
- [ ] 在 `lib.rs` 的 `generate_handler!` 宏中**显式注册**命令名（最高频遗漏点，见 C1）。
- [ ] 业务逻辑下沉到 `modules/*.rs`，commands 只做参数校验和调度。
- [ ] 全局状态走 `State<'_, AppState>`，避免全局变量。
- [ ] 异步操作不持 `std::sync::Mutex` 跨 `.await`（用 `tokio::sync::Mutex` 或缩短持锁时间）。
- [ ] 读取旧数据时做类型断言 + 兜底（见 D2），`serde_json::Value` 的 `.as_xxx()` 都要处理 `None`。
- [ ] 持久化 JSON 键名使用 **camelCase**（与前端一致，见 D1）。
- [ ] 字符串字面量返回值在前端 `api/*.ts` 用联合类型声明（见 C2）。
- [ ] 新增外部 API 调用时，同步更新 `tauri.conf.json` 的 `connect-src`（见 C4）。
- [ ] Windows API 调用通过 `windows` crate 0.58，与 Tauri 内部 0.61 通过原始指针桥接（见 F3）。

### 6.2 前端

- [ ] `src/api/*.ts` 封装 `invoke` 调用，附 TypeScript 类型，类型与 Rust 结构体字段对齐。
- [ ] Pinia store 调用 API 层，不直接 `invoke`。
- [ ] 错误处理填入 `lastError`，UI 显示提示。
- [ ] 事件监听用 `api/*.ts` 的 `onXxx` 封装，返回 `UnlistenFn`，组件 `onUnmounted` 时调用。
- [ ] 新 Modal 用 `<Modal>` 组件，**不要**用 `window.confirm` / `prompt` / `alert`（见 B4）。
- [ ] 遮罩层用 `.app-modal-overlay` 通用类，**不要** `position: fixed`（见 B1）。
- [ ] CSS 变量带 fallback（见 B3）。
- [ ] 拖动区域标注 `data-tauri-drag-region`，按钮区域标注 `data-tauri-drag-region="false"`（见 F2）。
- [ ] 侧边栏 / 可折叠区域动画用 `width` 而非 `transform`（见 E1）。

### 6.3 数据

- [ ] 持久化文件路径走 `app.path().app_data_dir()`。
- [ ] 并发写场景用 `static XXX_LOCK: Mutex<()>` 或 `tokio::sync::Mutex`。
- [ ] 新增字段时考虑旧数据兼容（缺失字段给默认值，类型不符则重置）。
- [ ] 数据目录文档同步更新（`docs/ARCHITECTURE.md` 第 6 节）。

### 6.4 测试

- [ ] 前端：`src/**/__tests__/*.test.ts`，`npm test` 通过。
- [ ] Rust：`cargo test` 通过。
- [ ] 手动验证 happy path 与错误路径（见第 7 节）。

---

## 7. 测试策略

### 7.1 前端单测：Vitest

- **配置**：`vitest.config.ts`，环境 `jsdom`，仅包含 `src/**/*.{test,spec}.ts`，排除 `electron/`、`dist/`、`node_modules/`。
- **运行**：`npm test`（单次）/ `npm run test:watch`（监听）/ `npm run test:coverage`（覆盖率，provider=v8）。
- **组件测试**：`@vue/test-utils` + `jsdom`，例如 `src/components/__tests__/Charts.test.ts` 已验证"下载模式切换显示自定义免责声明弹窗（不使用 `window.confirm`）"。
- **覆盖范围**：`src/**/*.{ts,vue}`。

> 注意：Tauri 的 `invoke` 在 jsdom 环境下不存在，测试时需要 mock `@tauri-apps/api/core` 的 `invoke`。

### 7.2 Rust 单测：Cargo Test

- **运行**：`cd src-tauri && cargo test`。
- **dev-dependencies**：`tempfile = "3"`（用于临时文件测试）。
- **测试范围**：`commands/*.rs` 和 `modules/*.rs` 中的 `#[cfg(test)] mod tests { ... }`。
- **重点**：数据读写的兼容性（D2 场景）、加密解密往返、菜园子原子操作的幂等性。

### 7.3 手动验证 Checklist

每次发版前，按以下场景手动走一遍：

| 场景 | 验证点 | 关联踩坑 |
|------|--------|---------|
| 启动应用 | 窗口圆角无双层、无系统边框 | A1/A2 |
| 拖动标题栏 | 窗口可拖动，按钮可点击 | F2 |
| 最小化 / 关闭 | 计时器运行时进入迷你模式 | — |
| 打开任意 Modal | 遮罩被圆角裁剪，无方形暗色痕迹 | B1 |
| Modal 出现 / 关闭 | 有 opacity+scale 动画 | E2 |
| 收起侧边栏 | 右侧主区域自动填充，无透明空白 | E1 |
| 音乐播放器设备弹框 | 不被裁剪，不穿透 Modal | A5/A6 |
| 菜园子签到 | 连续签到天数累加，重复签到幂等 | D1 |
| 下载歌曲 | 成功 / 已存在 / 无视频分支正确 | C2 |
| 云端登录 | Supabase 请求不被 CSP 拦截 | C4 |
| 切换深色模式 | 所有变量正确切换，无缺失 | B3 |

---

## 8. 原版参考

`electron/` 目录保留了完整的原版 Electron 代码，作为迁移参考，**不再修改**：

```
electron/
├── main.js                    # Electron 主进程入口
├── preload.js                 # IPC 桥接（contextBridge）
├── package.json               # 原版依赖
└── src/
    ├── index.html             # 主页面
    ├── garden.html            # 菜园子独立窗口
    ├── styles/                # 原 CSS（按功能拆分）
    ├── scripts/
    │   ├── renderer.js        # 主入口
    │   └── modules/           # 原渲染模块（IIFE 封装）
    └── modules/               # 原主进程模块（Node.js）
```

### 8.1 参考场景

- **迁移新模块时**：先读 `electron/src/scripts/modules/xxx.js` 理解原版行为，再读 `electron/src/modules/xxx.js` 理解原主进程逻辑，最后参照本项目的 `commands/` + `modules/` 实现。
- **调试样式问题时**：原版 CSS 在 `electron/src/styles/*.css`，可作为"在 Chromium 下原本长什么样"的基准。
- **理解 IPC 通道**：原版 `preload.js` 列出了所有 `electronAPI.*` 方法，与本项目 `src/api/*.ts` 一一对应（详见 `MIGRATION.md` 第 2.3 节）。

### 8.2 注意事项

- `electron/` 目录**不参与构建**，`vitest.config.ts` 已显式 `exclude: ['electron/**']`。
- 不要为了"统一"去修改 `electron/` 中的代码——它是冻结的历史参考。
- 原版的某些行为（如 `window.confirm` 弹窗）是 Electron 时代的遗留，迁移时必须替换（见 B4），不要照抄。

---

## 相关文档

- [MIGRATION.md](./MIGRATION.md) — 完整迁移映射表、已完成清单、待办事项
- [ARCHITECTURE.md](./ARCHITECTURE.md) — 架构设计、分层职责、进程模型
- [SECURITY.md](./SECURITY.md) — 加密体系、CSP、权限模型
- [MODAL_SYSTEM.md](./MODAL_SYSTEM.md) — 原版 Electron 弹窗系统（BaseModal / AnimatedModal），迁移参考
- [BUGFIX_RECORDS.md](./BUGFIX_RECORDS.md) — 历史 Bug 修复记录
- [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md) — 原版 Electron 开发者指南
- [modules/music-player.md](./modules/music-player.md) — 音乐播放器模块文档（已完成）

---

**文档版本**：v1.0（2026-07-29）
**维护者**：技术文档工程师
**反馈渠道**：发现新的踩坑，请补充到第 4 节对应类别，并在第 6 节 Checklist 中加入预防项。
