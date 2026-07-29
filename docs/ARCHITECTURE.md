# PomoSolo 架构设计

> 本文档描述 PomoSolo v4.0（Tauri v2 + Vue 3 重构版）的整体架构、模块划分、数据流和进程模型，并对比旧版 Electron 的架构差异。

---

## 1. 整体架构

PomoSolo 采用 **Tauri v2 双层架构**：Rust 后端负责系统调用、加密、子进程管理、网络请求；Vue 3 前端负责 UI 渲染与状态管理。两层通过 Tauri 的 IPC（`invoke` / `emit`）通信。

```
┌──────────────────────────────────────────────────────────────┐
│                      PomoSolo 应用进程                       │
│                                                              │
│  ┌────────────────────────┐    ┌──────────────────────────┐  │
│  │   Vue 3 前端 (WebView)  │    │     Rust 后端 (Tauri)    │  │
│  │                        │    │                          │  │
│  │  ┌──────────────────┐  │    │  ┌────────────────────┐  │  │
│  │  │   Components     │  │    │  │     Commands       │  │  │
│  │  │  (.vue SFC)      │  │    │  │  (#[command])      │  │  │
│  │  └────────┬─────────┘  │    │  └──────────┬─────────┘  │  │
│  │           │            │    │             │            │  │
│  │  ┌────────▼─────────┐  │    │  ┌──────────▼─────────┐  │  │
│  │  │   Pinia Stores   │  │    │  │     Modules        │  │  │
│  │  │  (业务状态)       │  │    │  │  (业务实现)         │  │  │
│  │  └────────┬─────────┘  │    │  └──────────┬─────────┘  │  │
│  │           │            │    │             │            │  │
│  │  ┌────────▼─────────┐  │    │  ┌──────────▼─────────┐  │  │
│  │  │   API 封装层     │◄─┼────┼─►│   Tauri Runtime    │  │  │
│  │  │  (src/api/*.ts)  │  IPC  │  │  (state / event)   │  │  │
│  │  └──────────────────┘  │    │  └────────────────────┘  │  │
│  └────────────────────────┘    └────────────┬─────────────┘  │
│                                              │                │
└──────────────────────────────────────────────┼────────────────┘
                                               │
                                  ┌────────────┼─────────────┐
                                  │            │             │
                                  ▼            ▼             ▼
                          ┌──────────┐  ┌──────────┐  ┌────────────┐
                          │ 文件系统  │  │  网络    │  │ Python 子进程│
                          │ (JSON)   │  │ (HTTP)   │  │ (music.exe) │
                          └──────────┘  └──────────┘  └────────────┘
```

### 分层职责

| 层 | 路径 | 职责 |
|----|------|------|
| **Components** | `src/components/` | 纯 UI 渲染，不直接调用 Tauri |
| **Stores** | `src/stores/` | 跨组件状态、业务编排、调用 API 层 |
| **API 封装** | `src/api/` | `invoke()` 调用 + TypeScript 类型 |
| **Commands** | `src-tauri/src/commands/` | `#[tauri::command]` 入口、参数校验、调度 |
| **Modules** | `src-tauri/src/modules/` | 业务实现、加密、文件 IO、网络 |
| **State** | `src-tauri/src/state.rs` | 全局共享状态（Mutex 保护） |

---

## 2. Rust 后端架构

### 2.1 入口

```
src-tauri/src/main.rs   →  调用 pomo_solo_lib::run()
src-tauri/src/lib.rs    →  tauri::Builder 配置插件、注册 commands、setup
```

`lib.rs` 中的核心配置：

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .manage(AppState::new())            // 注入全局状态
    .invoke_handler(generate_handler![
        commands::timer::get_timer_state,
        commands::data::{read_data, write_data, ...},
        commands::window::{close_window, minimize_window, ...},
        commands::cloud_auth::{save_credentials, cloud_login, ...},
        commands::garden::{garden_read, garden_plant, ...},
        commands::foreground::{foreground_start, foreground_stop, ...},
    ])
    .setup(|_app| { /* 开发模式打开 DevTools */ Ok(()) })
    .run(tauri::generate_context!())
```

### 2.2 Commands 层（前端入口）

每个 command 是一个 `pub async fn`，标注 `#[tauri::command]`，参数通过 `invoke` 自动序列化。

| 文件 | 主要命令 | 对应前端 API |
|------|---------|-------------|
| `commands/timer.rs` | `get_timer_state` | `api/timer.ts` |
| `commands/data.rs` | `read_data` / `write_data` / `read_settings` / `write_settings` | `api/data.ts` |
| `commands/window.rs` | `close_window` / `minimize_window` / `set_always_on_top` / `bring_to_front` / `cancel_always_on_top` | `api/window.ts` |
| `commands/cloud_auth.rs` | `save_credentials` / `load_credentials` / `clear_credentials` / `cloud_login` / `cloud_register` / `cloud_logout` / `cloud_get_session` / `cloud_test_connection` / `get_api_key` / `save_api_key` / `get_api_mode` / `set_api_mode` | `api/auth.ts` |
| `commands/garden.rs` | `garden_read` / `garden_write` / `garden_plant` / `garden_harvest` / `garden_buy` / `garden_sell` / `garden_unlock` / `garden_signin` | `api/garden.ts` |
| `commands/foreground.rs` | `foreground_start` / `foreground_stop` / `foreground_get_status` / `foreground_set_api_key` / `foreground_is_ready` | `api/foreground.ts` |

**Commands 层只做参数校验和调度**，实际业务逻辑下沉到 `modules/`。

### 2.3 Modules 层（业务实现）

| 文件 | 职责 | 外部依赖 |
|------|------|---------|
| `modules/cloud_auth.rs` | AES-256-GCM 加密、PBKDF2 密码哈希、Supabase REST 调用、凭据文件管理 | `aes-gcm` / `pbkdf2` / `sha2` / `reqwest` / `hostname` / `whoami` / `base64` |
| `modules/data_manager.rs` | `data.json` / `garden_data.json` / `settings.json` 读写，菜园子数据带 Mutex 锁防并发写 | `serde_json` / `std::fs` / `dirs` |
| `modules/foreground_inspection.rs` | Windows 前台窗口标题抓取、DeepSeek API 调用、检测循环（`tokio::spawn`）、事件推送 | `windows` crate / `reqwest` / `tokio` |
| `modules/music_process.rs` | Python 子进程（`music.exe`）启动、stdin/stdout JSON 通信、生命周期管理 | `tokio::process` / `sysinfo` |

### 2.4 全局状态

`state.rs` 中的 `AppState` 通过 `tauri::Builder::manage()` 注入，commands 通过 `State<'_, AppState>` 访问：

```rust
pub struct AppState {
    pub timer_running: Mutex<bool>,
    pub focus_mode_enabled: Mutex<bool>,
    pub foreground_ready: Mutex<bool>,
    pub cloud_session: Mutex<Option<Session>>,
    pub detection_state: Arc<DetectionState>,
}
```

- `Mutex<T>` 用于同步状态（命令同步访问）
- `Arc<DetectionState>` 用于跨 `tokio::spawn` 任务共享（前台检测异步循环）
- `DetectionState` 内部用 `AtomicBool` + `RwLock<Option<String>>` 存 API Key，避免长时间持锁

### 2.5 外部依赖选型

| 用途 | crate | 替代的 Electron 模块 |
|------|-------|---------------------|
| HTTP 客户端 | `reqwest` | `axios` + `@supabase/supabase-js` |
| 异步运行时 | `tokio` (full) | Node.js 事件循环 |
| 序列化 | `serde` / `serde_json` | `JSON.parse` / `JSON.stringify` |
| 加密 | `aes-gcm` / `pbkdf2` / `sha2` / `rand` | `electron.safeStorage` + `crypto.pbkdf2` |
| 机器标识 | `hostname` / `whoami` | `os.hostname()` / `os.platform()` |
| Windows API | `windows` (Win32) | `child_process` 调用 Python `ctypes` |
| 进程管理 | `sysinfo` | `child_process` |
| 数据目录 | `dirs` + Tauri `app_data_dir()` | `electron.app.getPath('userData')` |

---

## 3. Vue 前端架构

### 3.1 入口

```
index.html              →  挂载点 <div id="app">
src/main.ts             →  createApp(App).use(createPinia()).mount('#app')
src/App.vue             →  主布局（顶部窗口控制 / 计时区 / 底部导航 / 浮层面板）
```

### 3.2 分层结构

```
App.vue
  ├── components/              UI 组件（纯展示 + 事件触发）
  │     ├── Timer.vue
  │     ├── TimerProgress.vue
  │     ├── ModeSwitch.vue
  │     ├── Presets.vue
  │     ├── WindowControls.vue
  │     ├── SettingsPanel.vue
  │     ├── Statistics.vue
  │     ├── AIHelper.vue
  │     ├── AuthPanel.vue
  │     ├── MusicPlayer.vue
  │     ├── StudyRoom.vue
  │     ├── ForegroundWarning.vue
  │     ├── NoteManager.vue
  │     ├── Charts.vue
  │     ├── Modal.vue
  │     └── garden/            菜园子子组件
  │
  ├── stores/                  Pinia 状态层
  │     ├── timer.ts           计时器（独立运行，不依赖后端）
  │     ├── settings.ts        设置（后端 settings.json + localStorage 备份）
  │     ├── garden.ts          菜园子数据 + 静态配置（作物/成就/土地）
  │     ├── auth.ts            会话状态
  │     ├── music.ts           播放器状态
  │     └── stats.ts           统计数据
  │
  └── api/                     Tauri 命令封装（替代 preload.js）
        ├── index.ts           统一出口，re-export 所有 API
        ├── data.ts            readData / writeData / readSettings / writeSettings
        ├── auth.ts            凭据 / 云端账号 / API Key / API 模式
        ├── garden.ts          菜园子操作
        ├── foreground.ts      前台检测命令 + 事件监听
        ├── music.ts           音乐播放器
        ├── ai.ts              AI 规划
        ├── timer.ts           计时器状态查询
        ├── window.ts          窗口控制
        ├── charts.ts          图表数据
        ├── studyRoom.ts       自习室
        └── events.ts          通用事件封装
```

### 3.3 状态管理约定

- 所有跨组件状态走 Pinia store，不用全局事件总线
- Store 内部调用 `src/api/` 的封装函数，不直接 `invoke`
- Store 暴露三类成员：**State**（`ref`）、**Getters**（`computed`）、**Actions**（`function`）
- 异步 action 失败时填入 `lastError`，UI 层据此显示错误提示

示例（`stores/settings.ts`）：

```ts
export const useSettingsStore = defineStore("settings", () => {
  const settings = ref<AppSettings>({ ...DEFAULT_SETTINGS });
  const isDark = computed(() => settings.value.theme === "dark");
  async function load(): Promise<void> { /* 调用 readSettings() */ }
  return { settings, isDark, load, ... };
});
```

### 3.4 数据流（前端 → 后端）

```
Vue 组件
  │  触发用户操作
  ▼
Pinia action (stores/*.ts)
  │  调用
  ▼
API 封装 (api/*.ts)
  │  invoke("command_name", { args })
  ▼
Tauri IPC 序列化（自动 camelCase → snake_case）
  │
  ▼
Rust #[tauri::command] (commands/*.rs)
  │  参数校验 + 调度
  ▼
业务模块 (modules/*.rs)
  │  实际逻辑
  ├──► 文件系统（data.json / garden_data.json / settings.json / credentials.json）
  ├──► 网络请求（Supabase REST / DeepSeek API）
  └──► Python 子进程（music.exe）
  │
  ▼
返回 Result<T, String>
  │
  ▼
Tauri IPC 反序列化（snake_case → camelCase）
  │
  ▼
API 封装层（带 TS 类型）
  │
  ▼
Pinia action 更新 state
  │
  ▼
Vue 组件响应式重渲染
```

### 3.5 数据流（后端 → 前端，事件推送）

某些后端持续产生的状态（如前台检测结果、音乐播放进度）通过 Tauri 事件推送：

```
Rust 后端
  │  app.emit("foreground-detection", DetectionResult { ... })
  ▼
Tauri 事件总线
  │
  ▼
Vue 前端
  │  listen("foreground-detection", (event) => { ... })
  │  （封装在 api/foreground.ts 的 onForegroundEntertainmentDetected）
  ▼
Pinia action 更新 state
  │
  ▼
Vue 组件响应式重渲染
```

当前已注册的事件：

| 事件名 | 触发源 | 前端监听 |
|--------|--------|---------|
| `foreground-detection` | `modules/foreground_inspection.rs` 检测到娱乐应用 | `api/foreground.ts` |

> 音乐播放器（`music-ready` / `music-status` / `music-progress` 等）和前台检测的细粒度事件已在 `api/music.ts` / `api/foreground.ts` 中预留接口，待后端补全。

---

## 4. 安全架构

> 详细安全设计见 [SECURITY.md](./SECURITY.md)，此处仅列要点。

### 4.1 加密体系

```
用户密码 ──注册/登录──► PBKDF2-SHA512(100000 iter, 16B salt) ──► 64B hash hex
                                                                        │
                                                                        ▼
                                                              存入 Supabase users 表

本地凭据 ──保存──► AES-256-GCM 加密
                     │
                     │  密钥派生：
                     │  PBKDF2-SHA512(
                     │    password = "PomoSolo-machine-key",
                     │    salt = hostname + username + "PomoSolo-v4-credential-key",
                     │    iter = 100000,
                     │    len = 32B
                     │  )
                     ▼
                  credentials.json (base64(nonce || ciphertext))
```

### 4.2 API Key 隔离

- API Key（DeepSeek）保存在 `data.json` 的 `apiKey` 字段
- 前端通过 `get_api_key` 命令读取，但实际使用时由 Rust 后端直接调用 DeepSeek API
- 前端只用于"显示已配置"指示，不参与网络请求

### 4.3 CSP 内容安全策略

`tauri.conf.json` 中配置严格 CSP：

```
default-src 'self';
style-src 'self' 'unsafe-inline';
script-src 'self';
img-src 'self' data:;
font-src 'self' data:;
```

- 不允许 `unsafe-eval`、不允许内联脚本
- 不允许任意外部域名（与 Electron 版默认宽松形成对比）

### 4.4 权限模型

Tauri v2 的 capabilities 机制（`src-tauri/capabilities/default.json`）按窗口粒度授权：

```json
{
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:allow-open",
    "core:window:allow-close",
    "core:window:allow-minimize",
    "core:window:allow-set-always-on-top",
    "core:window:allow-set-focus"
  ]
}
```

只有显式列出的权限才被授予，避免 Electron 的"全有或全无"问题。

---

## 5. 进程模型

### 5.1 主进程

Tauri 启动后，Rust 主进程负责：

- 管理 WebView2 窗口
- 处理所有 `#[tauri::command]` 调用
- 维护 `AppState`
- 异步任务（`tokio::spawn`）：前台检测循环、子进程 stdout 读取

### 5.2 Python 子进程（音乐播放器）

```
Tauri 主进程
  │
  │  MusicProcess::spawn("music.exe")
  ▼
┌─────────────────────────┐
│  music.exe (Python)     │
│                         │
│  stdin  ◄── JSON 命令   │  ←─ Tauri 写入
│  stdout ──► JSON 事件   │  ─► Tauri 读取并转发到 WebView
│  stderr ──► 日志        │
│                         │
│  内部：播放列表、音频输出 │
└─────────────────────────┘
```

- 通信协议：每行一个 JSON 对象，以 `\n` 分隔
- 生命周期：`MusicProcess` 实现 `Drop`，主进程退出时自动 `start_kill()`
- 见 `modules/music_process.rs`

### 5.3 已淘汰的 Python 子进程（前台检测）

旧版 Electron 通过 `foreground_inspection.exe`（Python `ctypes` 调用 Win32 API）抓取前台窗口。

v4.0 改用 `windows` crate 直接在 Rust 中调用 `GetForegroundWindow` + `GetWindowTextW`，省去一个子进程（见 `modules/foreground_inspection.rs`）。

`foreground_inspection/` 目录保留源码作为参考，不再运行。

### 5.4 进程关系图

```
PomoSolo.exe (Tauri 主进程)
  │
  ├── WebView2 (渲染 Vue 前端)
  │
  ├── [可选] music.exe (Python 子进程)
  │     └── 通过 stdin/stdout 通信
  │
  └── [已移除] foreground_inspection.exe
        └── 改用 Rust 直接调用 Win32 API
```

---

## 6. 数据持久化

| 文件 | 路径 | 内容 | 写入方 |
|------|------|------|--------|
| `data.json` | `<app_data>/PomoSolo/data/data.json` | 主数据（统计、API Key、API 模式） | `commands/data.rs` + `modules/data_manager.rs` |
| `settings.json` | `<app_data>/PomoSolo/data/settings.json` | 用户设置 | 同上 |
| `garden_data.json` | `<app_data>/PomoSolo/data/garden_data.json` | 菜园子数据（带 Mutex 锁） | `commands/garden.rs` + `modules/data_manager.rs` |
| `credentials.json` | `<app_data>/PomoSolo/credentials.json` | 加密的用户凭据 | `modules/cloud_auth.rs` |

`<app_data>` 在 Windows 上通常为 `C:\Users\<用户>\AppData\Roaming`。

---

## 7. 与 Electron 版本的架构差异

### 7.1 进程模型对比

| 维度 | Electron v3.x | Tauri v2 v4.0 |
|------|---------------|----------------|
| 主进程 | Node.js（V8） | Rust |
| 渲染进程 | Chromium 子进程（独立进程） | WebView2（同进程内） |
| 子进程 | `child_process.spawn` 起 Python | `tokio::process::Command` 起 Python |
| 前台检测 | 独立 Python `.exe` | Rust 直接调 Win32 API（无子进程） |

### 7.2 IPC 模型对比

| 维度 | Electron | Tauri |
|------|----------|-------|
| 桥接方式 | `contextBridge.exposeInMainWorld` | `invoke()` + `#[command]` |
| 类型安全 | 无（JS） | 双端 struct / interface 对齐 |
| 事件系统 | `ipcRenderer.on` / `webContents.send` | `listen()` / `emit()` |
| 序列化 | JSON | JSON（自动 snake_case ↔ camelCase） |
| 权限 | 全有或全无 | capabilities 按权限粒度 |

### 7.3 模块映射

| Electron 模块 | Tauri 对应 |
|---------------|-----------|
| `electron/main/state.js` | `src-tauri/src/state.rs` |
| `electron/main/ipc-data.js` | `commands/data.rs` + `modules/data_manager.rs` |
| `electron/main/ipc-cloud.js` | `commands/cloud_auth.rs` + `modules/cloud_auth.rs` |
| `electron/main/ipc-garden.js` | `commands/garden.rs` |
| `electron/main/ipc-foreground.js` | `commands/foreground.rs` + `modules/foreground_inspection.rs` |
| `electron/main/ipc-music.js` | `modules/music_process.rs`（命令待补全） |
| `electron/main/ipc-window.js` | `commands/window.rs` |
| `electron/main/ipc-ai.js` | 待迁移 |
| `electron/preload.js` | `src/api/index.ts` + 子模块 |
| `electron/src/scripts/modules/*.js` | `src/stores/*.ts` + `src/components/*.vue` |
| `electron/src/modules/cloudAuth.js` | `modules/cloud_auth.rs` |
| `electron/src/modules/dataManager.js` | `modules/data_manager.rs` |
| `electron/src/modules/foregroundInspection.js` + Python | `modules/foreground_inspection.rs`（无 Python） |
| `electron/src/modules/musicProcess.js` | `modules/music_process.rs` |

> 完整迁移对照表见 [MIGRATION.md](./MIGRATION.md)。

### 7.4 安全架构差异

| 维度 | Electron | Tauri v2 |
|------|----------|----------|
| 加密 | `safeStorage`（依赖 OS DPAPI，跨平台行为不一致） | AES-256-GCM（纯 Rust 实现，密钥由机器特征派生） |
| 密码哈希 | `crypto.pbkdf2`（与 Rust 端兼容） | `pbkdf2` crate（迭代数 100000，SHA-512） |
| CSP | 需手动配置 | `tauri.conf.json` 强制配置 |
| 权限 | 全有或全无 | capabilities 白名单 |
| DevTools | 生产可禁用（手动） | 通过 `#[cfg(debug_assertions)]` 编译时控制 |

---

## 8. 设计权衡

### 8.1 为什么前台检测从 Python 迁回 Rust？

- **减少一个子进程**：少一份内存开销、少一份进程间通信复杂度
- **`windows` crate 已足够**：`GetForegroundWindow` + `GetWindowTextW` 在 Rust 中调用简单
- **AI 判断走 HTTP**：DeepSeek API 通过 `reqwest` 调用，与语言无关
- **生命周期更可控**：Rust 异步任务随主进程退出自动结束，Python 子进程需要 `Drop` 显式 kill

### 8.2 为什么音乐播放器保留 Python？

- **音频库成熟度**：Python 的 `pygame.mixer` / `pydub` 等已稳定，Rust 的 `rodio` / `cpal` 在 Windows 输出设备切换、播放列表管理等高级功能上仍有缺口
- **迁移成本**：第一阶段保留 Python 子进程，通过 stdin/stdout JSON 通信，前端 API 完全无感
- **未来路径**：`modules/music_process.rs` 已在注释中规划"第二阶段评估 rodio/cpal 替代"

### 8.3 为什么计时器在前端运行？

`stores/timer.ts` 用 `setInterval` 在前端跑计时，而非后端 Rust。

- **避免 IPC 抖动**：每 200ms 一次 tick，前端直接更新 UI 更流畅
- **时间戳校正**：用 `Date.now()` 差值计算 elapsed，避免 setInterval 不准
- **持久化由后端负责**：完成时通过 `stats.recordSession()` 写入后端 `data.json`
- **未来可扩展**：若需要后台计时（窗口最小化后仍精确），可改为后端 `tokio::time::interval` + 事件推送

### 8.4 为什么数据文件用 JSON 而非 SQLite？

- **数据规模小**：单用户专注记录、菜园子状态，JSON 足够
- **可读性**：用户可直接打开查看，便于调试
- **无额外依赖**：`serde_json` 已在依赖树中，SQLite 需引入 `rusqlite` + 编译 C 库
- **菜园子并发保护**：`data_manager.rs` 中用 `static GARDEN_LOCK: Mutex<()>` 防并发写

> 自习室多人数据走 Supabase 云端，不依赖本地 JSON。

---

## 9. 后续演进方向

| 方向 | 当前状态 | 演进路径 |
|------|---------|---------|
| 音乐播放器 Rust 化 | 保留 Python 子进程 | 评估 `rodio` / `cpal` 替代 |
| 计时器后端化 | 前端 `setInterval` | 后端 `tokio::time` + 事件推送（支持后台精确计时） |
| 数据层 SQLite 化 | JSON 文件 | `rusqlite` + 迁移脚本（当数据量增长时） |
| 跨平台扩展 | 主要支持 Windows | 抽象 `windows` crate 调用，补 macOS / Linux 前台检测 |
| 移动端 | Tauri v2 已支持 iOS/Android | 评估菜园子 / 计时器在移动端的适配 |
| 自动更新 | Electron 内置 `autoUpdater` | 评估 `tauri-plugin-updater` |

---

## 相关文档

- [README.md](../README.md) - 项目总览
- [MIGRATION.md](./MIGRATION.md) - 从 Electron 迁移指南
- [SECURITY.md](./SECURITY.md) - 安全设计详解
