# 从 Electron 迁移到 Tauri 指南

> 本文档记录 PomoSolo v3.x（Electron）→ v4.0（Tauri v2 + Vue 3）的迁移映射、已完成清单和待办事项，供后续维护者参考。

---

## 1. 迁移概览

| 维度 | Electron v3.x | Tauri v2 v4.0 |
|------|---------------|----------------|
| 主进程语言 | JavaScript (Node.js) | Rust |
| 渲染层 | Chromium 内嵌 | 系统 WebView2 |
| 前端框架 | 原生 JS + 全局变量 | Vue 3 + TypeScript + Pinia |
| IPC | `ipcMain.handle` / `ipcRenderer.send` | `#[tauri::command]` / `invoke` |
| 桥接层 | `preload.js` (contextBridge) | `src/api/*.ts` (直接 invoke) |
| 加密 | `safeStorage` (DPAPI) | AES-256-GCM（Rust 实现） |
| 前台检测 | Python `foreground_inspection.exe` | Rust + `windows` crate（无子进程） |
| 音乐播放器 | Python `music.exe` | 同（保留 Python，Rust 子进程封装） |
| 配置 | `package.json` + `electron-builder` | `tauri.conf.json` + `Cargo.toml` |

---

## 2. 模块对应关系表

### 2.1 后端模块（Electron `main/` + `src/modules/` → Rust）

| Electron 模块 | Rust 对应 | 迁移状态 |
|---------------|-----------|---------|
| `electron/main.js`（主进程入口、窗口创建） | `src-tauri/src/lib.rs` + `main.rs` + `tauri.conf.json` | ✅ 完成 |
| `electron/main/state.js`（全局状态） | `src-tauri/src/state.rs` | ✅ 完成 |
| `electron/main/ipc-data.js` | `commands/data.rs` + `modules/data_manager.rs` | ✅ 完成 |
| `electron/main/ipc-cloud.js` | `commands/cloud_auth.rs` | ✅ 完成 |
| `electron/main/ipc-garden.js` | `commands/garden.rs` | ✅ 完成 |
| `electron/main/ipc-foreground.js` | `commands/foreground.rs` | ✅ 完成 |
| `electron/main/ipc-window.js` | `commands/window.rs` | ✅ 完成 |
| `electron/main/ipc-music.js` | `modules/music_process.rs`（基础设施） | ⚠️ 部分完成（命令未注册） |
| `electron/main/ipc-ai.js` | （未迁移） | ❌ 待办 |
| `electron/main/ipc-update.js` | （未迁移） | ❌ 待办 |
| `electron/main/achievements.js` | （合入 `commands/garden.rs` 逻辑） | ⚠️ 简化实现 |
| `electron/main/auto-update.js` | （未迁移） | ❌ 待办（评估 `tauri-plugin-updater`） |
| `electron/main/userData-backup.js` | （未迁移） | ❌ 待办 |
| `electron/main/windows.js`（多窗口：主/迷你/菜园子） | `tauri.conf.json` 单窗口 | ⚠️ 仅主窗口 |
| `electron/src/modules/cloudAuth.js` | `modules/cloud_auth.rs` | ✅ 完成 |
| `electron/src/modules/dataManager.js` | `modules/data_manager.rs` | ✅ 完成 |
| `electron/src/modules/foregroundInspection.js` + Python `.exe` | `modules/foreground_inspection.rs`（纯 Rust，无 Python） | ✅ 完成 |
| `electron/src/modules/musicProcess.js` | `modules/music_process.rs` | ⚠️ 基础设施完成，命令未注册 |
| `electron/src/modules/aiAssistant.js` | （未迁移） | ❌ 待办 |
| `electron/src/modules/chartsFetcher.js` | （未迁移） | ❌ 待办 |
| `electron/src/modules/songDownloader.js` | （未迁移，沿用 Python `manual_downloader.exe`） | ❌ 待办 |
| `electron/src/modules/studyRoomSync.js` | （未迁移） | ❌ 待办 |

### 2.2 前端模块（Electron `src/scripts/modules/` → Vue 3）

| Electron 渲染模块 | Vue 3 对应 | 迁移状态 |
|-------------------|-----------|---------|
| `renderer.js`（主入口） | `App.vue` + `main.ts` | ✅ 完成 |
| `timer.js` | `stores/timer.ts` + `components/Timer.vue` + `TimerProgress.vue` | ✅ 完成 |
| `settings.js` | `stores/settings.ts` + `components/SettingsPanel.vue` | ✅ 完成 |
| `statistics.js` + `stats.js` + `charts.js` | `stores/stats.ts` + `components/Statistics.vue` + `Charts.vue` | ⚠️ 部分完成 |
| `garden.js` + `garden*.js`（成就/背包/商店/签到/种植轮盘/地块） | `stores/garden.ts` + `components/garden/*.vue` | ✅ 完成 |
| `musicPlayer.js` | `stores/music.ts` + `components/MusicPlayer.vue` + `api/music.ts` | ⚠️ 部分完成 |
| `studyRoom.js` | `components/StudyRoom.vue` + `api/studyRoom.ts` | ⚠️ 框架完成，逻辑待补 |
| `aiHelper.js` + `apiKeyManager.js` | `components/AIHelper.vue` + `api/ai.ts` + `api/auth.ts` | ⚠️ 部分完成 |
| `foregroundDetection.js` | `components/ForegroundWarning.vue` + `api/foreground.ts` | ✅ 完成 |
| `mode.js` | `components/ModeSwitch.vue` | ✅ 完成 |
| `presets.js` | `components/Presets.vue` | ✅ 完成 |
| `noteManager.js` | `components/NoteManager.vue` | ✅ 完成 |
| `theme.js` | 合入 `stores/settings.ts` 的 `theme` 字段 | ✅ 完成 |
| `modal.js` | `components/Modal.vue` | ✅ 完成 |
| `wheelPicker.js` | `components/garden/GardenPlantWheel.vue` | ✅ 完成 |
| `appState.js` | 拆分到各 Pinia store | ✅ 完成 |
| `callbacks.js` | 拆分到各 store 的 action | ✅ 完成 |
| `dataStore.js` | `stores/*.ts` + `api/data.ts` | ✅ 完成 |
| `dom.js` | Vue 模板直接处理 | ✅ 完成 |
| `tutorial.js` | （未迁移） | ❌ 待办 |

### 2.3 桥接层（Electron `preload.js` → Vue `api/`）

`preload.js` 通过 `contextBridge.exposeInMainWorld('electronAPI', {...})` 暴露的每个方法，在 `src/api/` 中都有对应的 TypeScript 函数：

| `window.electronAPI.xxx` | `src/api/*.ts` 函数 |
|--------------------------|--------------------|
| `readData()` | `readData()` |
| `writeData(data)` | `writeData(data)` |
| `readSettings()` / `writeSettings()` | `readSettings()` / `writeSettings()` |
| `closeWindow()` / `minimizeWindow()` | `closeWindow()` / `minimizeWindow()` |
| `gardenRead()` / `gardenPlant()` / ... | `gardenRead()` / `gardenPlant()` / ... |
| `cloudLogin()` / `cloudRegister()` / ... | `cloudLogin()` / `cloudRegister()` / ... |
| `getApiKey()` / `saveApiKey()` | `getApiKey()` / `saveApiKey()` |
| `foregroundStart()` / `foregroundStop()` | `foregroundStart()` / `foregroundStop()` |
| `musicTogglePlay()` / `musicNext()` / ... | `musicTogglePlay()` / `musicNext()` / ... |

---

## 3. IPC 通道映射表

### 3.1 数据持久化

| Electron (`ipcMain.handle`) | Tauri (`#[tauri::command]`) | 前端调用 | 状态 |
|------------------------------|------------------------------|---------|------|
| `read-data` | `read_data` | `readData()` | ✅ |
| `write-data` | `write_data` | `writeData(data)` | ✅ |
| `read-settings` | `read_settings` | `readSettings()` | ✅ |
| `write-settings` | `write_settings` | `writeSettings(settings)` | ✅ |

### 3.2 窗口控制

| Electron (`ipcMain.on` / `handle`) | Tauri command | 前端调用 | 状态 |
|-------------------------------------|----------------|---------|------|
| `close-window` | `close_window` | `closeWindow()` | ✅ |
| `minimize-window` | `minimize_window` | `minimizeWindow()` | ✅ |
| `set-always-on-top` | `set_always_on_top(on_top)` | `setAlwaysOnTop(onTop)` | ✅ |
| `bring-to-front` | `bring_to_front` | `bringToFront()` | ✅ |
| `cancel-always-on-top` | `cancel_always_on_top` | `cancelAlwaysOnTop()` | ✅ |

### 3.3 云端认证

| Electron channel | Tauri command | 状态 |
|------------------|----------------|------|
| `save-credentials` | `save_credentials(username, password, auto_login)` | ✅ |
| `load-credentials` | `load_credentials()` | ✅ |
| `clear-credentials` | `clear_credentials()` | ✅ |
| `cloud-login` | `cloud_login(username, password)` | ✅ |
| `cloud-register` | `cloud_register(username, password)` | ✅ |
| `cloud-logout` | `cloud_logout()` | ✅ |
| `cloud-get-session` | `cloud_get_session()` | ✅ |
| `cloud-test-connection` | `cloud_test_connection()` | ✅ |
| `get-api-key` | `get_api_key()` | ✅ |
| `save-api-key` | `save_api_key(key)` | ✅ |
| `get-api-mode` | `get_api_mode()` | ✅ |
| `set-api-mode` | `set_api_mode(mode)` | ✅ |

### 3.4 菜园子

| Electron channel | Tauri command | 状态 | 备注 |
|------------------|----------------|------|------|
| `garden-read` | `garden_read` | ✅ | |
| `garden-write` | `garden_write(data)` | ✅ | |
| `garden-plant` | `garden_plant(plot_id, crop)` | ✅ | 参数命名从 `plotIndex/cropKey` 改为 `plot_id/crop` |
| `garden-harvest` | `garden_harvest(plot_id)` | ✅ | |
| `garden-buy-seed` | `garden_buy(item, price)` | ⚠️ | 参数不一致：旧版 `(cropKey)`，新版 `(item, price)`，需对齐 |
| `garden-sell-crop` | `garden_sell(item, price)` | ⚠️ | 同上 |
| `garden-sell-all` | （未实现） | ❌ | |
| `garden-unlock-plot` | `garden_unlock(plot_id)` | ✅ | |
| `garden-signin` | `garden_signin(date)` | ✅ | 新版需传 date 参数 |
| `garden-update-focus` | （未实现，前端走 `gardenUpdateFocus`） | ❌ | API 已封装，命令未注册 |
| `garden-grow` (`ipcRenderer.send`) | （未实现） | ❌ | |
| `garden-punishment` | （未实现，前端走 `gardenPunishment`） | ❌ | API 已封装，命令未注册 |

### 3.5 前台检测

| Electron channel | Tauri command | 状态 |
|------------------|----------------|------|
| `foreground-start` | `foreground_start` | ✅ |
| `foreground-stop` | `foreground_stop` | ✅ |
| `foreground-get-status` | `foreground_get_status` | ✅ |
| `foreground-set-api-key` | `foreground_set_api_key(key)` | ✅ |
| `foreground-is-ready` | `foreground_is_ready` | ✅ |
| `foreground-add-whitelist` | （未实现） | ❌ |
| `foreground-add-blacklist` | （未实现） | ❌ |
| `foreground-get-config` | （未实现） | ❌ |

事件映射（Electron `webContents.send` → Tauri `app.emit`）：

| Electron 事件 | Tauri 事件 | 状态 |
|---------------|-----------|------|
| `foreground-ready` | （未实现） | ❌ |
| `foreground-entertainment-detected` | `foreground-detection` | ⚠️ 命名不一致 |
| `foreground-status` | （未实现） | ❌ |
| `foreground-error` | （未实现） | ❌ |
| `foreground-api-key-invalid` | （未实现） | ❌ |

### 3.6 音乐播放器

| Electron channel | Tauri command | 状态 |
|------------------|----------------|------|
| `music-toggle-play` | （未注册） | ❌ |
| `music-next` / `music-prev` | （未注册） | ❌ |
| `music-seek` | （未注册） | ❌ |
| `music-set-volume` | （未注册） | ❌ |
| `music-get-status` | （未注册） | ❌ |
| `music-set-play-mode` | （未注册） | ❌ |
| `music-get-playlist` | （未注册） | ❌ |
| `music-get-devices` / `music-set-device` | （未注册） | ❌ |
| `music-play-song` / `music-delete-song` | （未注册） | ❌ |
| `music-get-custom-tags` / `music-add-custom-tag` / ... | （未注册） | ❌ |

> `modules/music_process.rs` 已实现子进程启动和 stdin/stdout 通信基础设施，但 commands 层尚未编写，前端 `api/music.ts` 已封装好接口等待对接。

### 3.7 AI 助手

| Electron channel | Tauri command | 状态 |
|------------------|----------------|------|
| `ai-generate-plan` | （未注册） | ❌ |
| `ai-chat` | （未注册） | ❌ |

> 前端 `api/ai.ts` 已封装 `aiGeneratePlan(input)` 接口，待 Rust 端实现 DeepSeek 调用。

### 3.8 自习室 / 图表

| Electron channel | Tauri command | 状态 |
|------------------|----------------|------|
| `study-room-*` 系列 | （未注册） | ❌ |
| `charts-fetch-*` | （未注册） | ❌ |

### 3.9 自动更新

| Electron channel | Tauri command | 状态 |
|------------------|----------------|------|
| `check-for-updates` | （未实现） | ❌ 评估 `tauri-plugin-updater` |
| `download-update` | （未实现） | ❌ |
| `install-update` | （未实现） | ❌ |
| `update-available` 事件 | （未实现） | ❌ |
| `update-downloaded` 事件 | （未实现） | ❌ |

---

## 4. 安全改进对比

| 维度 | Electron v3.x | Tauri v2 v4.0 | 改进点 |
|------|---------------|----------------|--------|
| 凭据加密 | `safeStorage.encryptString`（依赖 Windows DPAPI） | AES-256-GCM（纯 Rust，密钥由机器特征派生） | 跨平台一致、可调试 |
| 密码哈希 | `crypto.pbkdf2(password, salt, 100000, 64, 'sha512')` | `pbkdf2_hmac::<Sha512>(password, salt, 100000, 64)` | 算法完全兼容，结果可互通 |
| API Key 存储 | `data.json` 明文 | 同（明文） | ⚠️ 待改进：可考虑加密 |
| API Key 暴露 | 渲染进程可直接读取使用 | 渲染进程只能读取"是否存在"，实际调用在 Rust 端 | ✅ 隔离改进 |
| CSP | BrowserWindow 默认宽松 | `tauri.conf.json` 严格白名单 | ✅ |
| 权限粒度 | 渲染进程要么有 Node 全权限要么无 | Tauri capabilities 按窗口/按权限授权 | ✅ |
| DevTools | 生产模式手动禁用 | 通过 `#[cfg(debug_assertions)]` 编译时控制 | ✅ 更难绕过 |
| `nodeIntegration` | 必须设为 `false` | Tauri 默认无 Node | ✅ 架构层面消除 |
| `contextIsolation` | 必须设为 `true` | Tauri 默认隔离 | ✅ |
| 外部链接打开 | `shell.openExternal` | `tauri-plugin-shell` + capabilities 授权 | ✅ 显式授权 |
| Supabase SDK | `@supabase/supabase-js`（引入大依赖） | 直接 reqwest 调 REST API | ✅ 体积更小 |

---

## 5. 已完成迁移的模块清单

✅ 表示前端 API + Rust 命令 + 业务逻辑全部就绪。

| 模块 | 前端 API | Rust 命令 | 业务逻辑 | 状态 |
|------|---------|----------|---------|------|
| 计时器状态查询 | `api/timer.ts` | `commands/timer.rs::get_timer_state` | 简化实现 | ✅ |
| 数据读写 | `api/data.ts` | `commands/data.rs` | `modules/data_manager.rs` | ✅ |
| 设置读写 | `api/data.ts` | `commands/data.rs` | 同上 | ✅ |
| 窗口控制 | `api/window.ts` | `commands/window.rs` | Tauri API | ✅ |
| 云端认证（本地凭据） | `api/auth.ts` | `commands/cloud_auth.rs` | `modules/cloud_auth.rs` | ✅ |
| 云端账号（登录/注册/退出/会话） | `api/auth.ts` | `commands/cloud_auth.rs` | Supabase REST | ✅ |
| API Key / API 模式 | `api/auth.ts` | `commands/cloud_auth.rs` | `modules/data_manager.rs` | ✅ |
| 菜园子读写 | `api/garden.ts` | `commands/garden.rs` | `modules/data_manager.rs` | ✅ |
| 菜园子种植 / 收获 / 解锁 / 签到 | `api/garden.ts` | `commands/garden.rs` | 同上 | ✅ |
| 前台检测（启停 / 状态 / API Key） | `api/foreground.ts` | `commands/foreground.rs` | `modules/foreground_inspection.rs` | ✅ |

---

## 6. 待完成的迁移项

按优先级排列。

### 6.1 高优先级（影响核心功能）

| 待办 | 涉及文件 | 说明 |
|------|---------|------|
| **菜园子高级操作** | `commands/garden.rs` | 补全 `garden_update_focus` / `garden_punishment` / `garden_sell_all` 命令注册；前端 `api/garden.ts` 已封装 |
| **菜园子参数对齐** | `commands/garden.rs` ↔ `api/garden.ts` | `garden_buy` / `garden_sell` 的参数命名需统一（当前后端 `(item, price)`，前端期望 `(seedId, quantity)`） |
| **音乐播放器 commands** | `commands/music.rs`（新建） | 基于 `modules/music_process.rs` 实现 `music_toggle_play` / `music_next` / `music_get_status` 等命令；前端 `api/music.ts` 已就绪 |
| **AI 规划助手** | `commands/ai.rs`（新建） + `modules/ai_assistant.rs` | 实现 `ai_generate_plan`，调用 DeepSeek API；前端 `api/ai.ts` 已封装 |
| **前台检测事件补全** | `commands/foreground.rs` + `modules/foreground_inspection.rs` | 补全 `foreground-ready` / `foreground-status` / `foreground-error` / `foreground-api-key-invalid` 事件 |
| **前台检测黑白名单** | `modules/foreground_inspection.rs` | 补全 `add_whitelist` / `add_blacklist` / `get_config` 命令，匹配 Python 版本能力 |

### 6.2 中优先级（功能完整性）

| 待办 | 涉及文件 | 说明 |
|------|---------|------|
| **自习室** | `commands/study_room.rs`（新建） | 迁移 `electron/src/modules/studyRoomSync.js`，前端 `api/studyRoom.ts` 已就绪 |
| **图表数据** | `commands/charts.rs`（新建） | 迁移 `electron/src/modules/chartsFetcher.js`，前端 `api/charts.ts` 已就绪 |
| **多窗口（迷你模式 / 菜园子窗口）** | `tauri.conf.json` + `commands/window.rs` | Electron 有主窗口 / 迷你窗口 / 菜园子独立窗口，Tauri 当前只有主窗口 |
| **歌曲下载** | `commands/music.rs` | 通过 Rust 调用 `manual_downloader.exe`，封装为命令 |
| **成就系统完整化** | `commands/garden.rs` | 当前 `commands/garden.rs` 只做了基本的 plant/harvest/buy/sell/unlock/signin，成就解锁逻辑未迁移 |

### 6.3 低优先级（增强体验）

| 待办 | 涉及文件 | 说明 |
|------|---------|------|
| **自动更新** | `tauri-plugin-updater` | Electron 用 `electron-updater`，Tauri 需用官方 plugin |
| **用户数据备份** | `commands/backup.rs`（新建） | 迁移 `electron/main/userData-backup.js` |
| **教程系统** | `components/Tutorial.vue` | 迁移 `electron/src/scripts/modules/tutorial.js` |
| **单点登录心跳** | `modules/cloud_auth.rs` | Electron 版有 60s 心跳 + 2min 超时检查，Tauri 版当前未实现 |
| **托盘图标** | `tauri.conf.json` (tray-icon feature 已开启) | Electron 版有托盘菜单，Tauri 需补全 |
| **全局快捷键** | `tauri-plugin-global-shortcut` | Electron 版音乐播放器有全局快捷键 |
| **F12 / 右键菜单禁用** | `lib.rs` setup | Electron 在生产模式禁用 F12 和右键菜单，Tauri 当前通过 `#[cfg(debug_assertions)]` 控制 DevTools，右键菜单未处理 |

---

## 7. 迁移过程中的常见问题

### 7.1 参数命名转换

Tauri v2 自动把前端的 `camelCase` 转成 Rust 的 `snake_case`，但**字段名**（结构体成员）需要手动保持一致：

```ts
// 前端
invoke("save_credentials", { username, password, autoLogin });
```

```rust
// Rust
#[tauri::command]
pub async fn save_credentials(
    app: AppHandle,
    username: String,
    password: String,
    auto_login: bool,  // ← autoLogin 自动映射
) -> Result<(), String>
```

但**结构体字段**在序列化时默认是 snake_case，前端 interface 需要用 camelCase：

```rust
#[derive(Serialize)]
pub struct Session {
    pub id: i64,
    pub username: String,
    pub admin: bool,
}
```

```ts
// Tauri 会自动转成 camelCase（实际上这几个字段本身没区别）
export interface Session {
  id: number;
  username: string;
  admin: boolean;
}
```

### 7.2 异步命令

Tauri 命令默认是 `async fn`，即使是同步操作也要包装成 async。调用 `std::sync::Mutex` 时要注意不要跨 `.await` 持锁，否则可能死锁。`AppState` 用 `std::sync::Mutex` 而非 `tokio::sync::Mutex`，因为持锁时间极短。

### 7.3 错误处理

Tauri 命令返回 `Result<T, String>`，前端 `invoke` 失败时会 reject Promise。Rust 端用 `.map_err(|e| e.to_string())?` 简化错误转换。

```rust
#[tauri::command]
pub async fn read_data(app: AppHandle) -> Result<Value, String> {
    let path = get_data_dir(&app).join("data.json");
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}
```

### 7.4 事件命名

旧 Electron 用 kebab-case（`foreground-entertainment-detected`），Tauri 事件名建议保持一致以减少前端改动，但当前 Rust 端发的是 `foreground-detection`。**建议统一为旧版命名**，避免前端多处改动。

### 7.5 文件路径

| Electron | Tauri |
|----------|-------|
| `app.getPath('userData')` | `app.path().app_data_dir()` |
| `path.join(a, b)` | `PathBuf::from(a).join(b)` |
| `fs.readFileSync` | `fs::read_to_string` |
| `fs.writeFileSync` | `fs::write` |

Tauri 中数据目录通常在 `<app_data>/PomoSolo/data/`（见 `modules/data_manager.rs::get_data_dir`）。

### 7.6 子进程通信

Electron 的 `child_process.spawn` 与 Rust 的 `tokio::process::Command` 对比：

```js
// Electron
const child = spawn('music.exe', [], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.write(JSON.stringify(cmd) + '\n');
child.stdout.on('data', (data) => { /* parse JSON line */ });
```

```rust
// Rust
let mut child = Command::new(exe_path)
    .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped())
    .spawn()?;
let stdin = child.stdin.take().unwrap();
let stdout = child.stdout.take().unwrap();
// tokio::io::AsyncBufReadExt 逐行读取
```

协议不变（每行一个 JSON），Rust 端用 `tokio::io::BufReader::read_line` 解析。

---

## 8. 迁移自检清单

完成新模块迁移时，逐项检查：

- [ ] Rust 端：`#[tauri::command]` 函数已添加到 `commands/*.rs`
- [ ] Rust 端：在 `lib.rs` 的 `generate_handler!` 宏中注册命令
- [ ] Rust 端：业务逻辑下沉到 `modules/*.rs`，commands 只做参数校验和调度
- [ ] Rust 端：返回 `Result<T, String>`，错误信息中文友好
- [ ] Rust 端：全局状态走 `State<'_, AppState>`，避免全局变量
- [ ] Rust 端：异步操作不持 `std::sync::Mutex` 跨 `.await`
- [ ] 前端：`src/api/*.ts` 已封装 `invoke` 调用，附 TypeScript 类型
- [ ] 前端：类型与 Rust 结构体字段对齐（snake_case ↔ camelCase）
- [ ] 前端：Pinia store 调用 API 层，不直接 `invoke`
- [ ] 前端：错误处理填入 `lastError`，UI 显示提示
- [ ] 前端：事件监听用 `api/*.ts` 的 `onXxx` 封装，返回 `UnlistenFn`
- [ ] 文档：本文档的"已完成清单"已勾选
- [ ] 测试：手动验证 happy path 与错误路径

---

## 相关文档

- [ARCHITECTURE.md](./ARCHITECTURE.md) - 架构设计
- [SECURITY.md](./SECURITY.md) - 安全设计
- [README.md](../README.md) - 项目总览
