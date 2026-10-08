# 🍅 PomoSolo

**一款功能丰富的番茄钟专注应用 —— Tauri v2 + Vue 3 + 纯 Rust 后端。**

[![Release](https://img.shields.io/badge/Release-v4.7.12-ff6b6b)](https://github.com/liaowenqi123/PomoSolo/releases)
[![Tauri](https://img.shields.io/badge/Tauri-v2-blue)](https://tauri.app)
[![Vue](https://img.shields.io/badge/Vue-3.5-42b883)](https://vuejs.org)
[![Rust](https://img.shields.io/badge/Rust-2021-orange)](https://www.rust-lang.org)

> ### 🧭 新来的开发者，请先读 [**TEAM_GUIDE.md**](./TEAM_GUIDE.md)
> 部门分工（主部门 / 服务器部门 / PWA 部门 / 安卓端部门）、部门声明规则、双仓库推送流程、工作流与文档地图都在里面。读完即可投入工作。

---

## 这是什么？

PomoSolo 是一款 Windows 桌面番茄钟应用，从原 Electron + Python 版本（v3.x）重构为 Tauri v2 + Vue 3 + 纯 Rust 架构（v4.1+）。它不止是倒计时工具，还整合了**专注激励游戏、AI 分心检测、内置音乐播放器、自习室、AI 任务规划、自动更新**等功能，让专注不再枯燥。

---

## 为什么选择 PomoSolo？

| 对比 | 普通番茄钟 | PomoSolo |
|------|-----------|---------|
| 专注激励 | 只有倒计时 | 🌱 种菜园子，专注时长可收获作物 |
| 分心防护 | 靠自己克制 | 🔍 AI 检测娱乐应用，违规自动惩罚 |
| 音乐陪伴 | 需要另开播放器 | 🎵 内置音乐播放器，支持榜单下载 |
| 社交学习 | 孤独学习 | 👥 自习室，实时排名 |
| 任务规划 | 手动排期 | 🤖 AI 一句话生成任务计划 |
| 自动更新 | 手动下载 | 🔄 内置更新检查，一键升级 |
| 安装体积 | Electron 动辄 100MB+ | 💾 Tauri 安装包 ~17MB（无 Python 依赖） |

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 桌面框架 | **Tauri v2** | 用 Rust 调用系统 WebView，替代 Electron |
| 前端框架 | **Vue 3.5** + Composition API | 单文件组件 + `<script setup>` |
| 类型系统 | **TypeScript 5.6** | 前端全量 TS，与 Rust 端结构体一一对应 |
| 状态管理 | **Pinia 2.2** | 替代 Vuex / 全局事件总线 |
| 构建工具 | **Vite 6** | 替代 Webpack，HMR 极速 |
| 后端语言 | **Rust (Edition 2021)** | 内存安全，零成本抽象，无 GC 暂停 |
| 音频播放 | **rodio + symphonia** | 纯 Rust 音频播放 + 多格式解码 + 原生 seek |
| 加密 | **aes-gcm + pbkdf2 + sha2** | AES-256-GCM + PBKDF2-SHA512 |
| 图表 | **Chart.js 4.5** | 统计可视化 |
| 自动更新 | **tauri-plugin-updater** | 签名验证 + 增量更新 |
| 进程通信 | Tauri IPC + 事件 | `invoke` 调用命令、`listen` 监听事件 |

---

## 功能列表

| 模块 | 说明 |
|------|------|
| 🍅 **计时器** | 三种模式（工作/休息/自定义）、时间戳计时、键盘快捷键 |
| 🌱 **菜园子游戏** | 5 种作物（胡萝卜/番茄/向日葵/玫瑰/金桂树）、12 块土地、成就系统、每日签到 |
| 🔍 **专注模式 / 前台检测** | AI 判断前台窗口是否为娱乐应用，黑白名单 + 历史记录多源判定，违规触发作物枯萎惩罚 |
| 🎵 **音乐播放器** | 纯 Rust 音频播放（rodio）、播放列表、标签管理、**音乐库目录树 + 标签筛选 + 播放集合（列表循环/随机）**、输出设备切换、播放模式、进度拖拽 |
| 📥 **音乐下载** | 纯 Rust B 站音频下载（reqwest + symphonia DASH 解析），DeepSeek AI 选曲 |
| 👥 **自习室** | 公开/私密房间、实时排名、专注时长同步 |
| 📊 **统计** | 日/周/月专注时长图表、热力图、趋势分析 |
| 🤖 **AI 规划助手** | 一句话生成番茄钟计划，调用 DeepSeek（云端 / 本地双模式） |
| 🔐 **云端账号** | 自建服务器后端（JWT 认证 + refresh token 自动续期）、本地凭据 AES-256-GCM 加密、自动登录 |
| 🔄 **自动更新** | 内置更新检查、签名验证、一键升级、用户数据备份 |

---

## 快速开始

### 1. 环境要求

| 工具 | 版本 | 用途 |
|------|------|------|
| Node.js | ≥ 20 | 前端构建 |
| Rust | ≥ 1.77 | 后端编译 |
| Tauri CLI | v2 | 已随 `package.json` 安装 |

Windows 10 / 11 自带 WebView2，无需额外运行环境。

### 2. 安装依赖

```bash
npm install
```

### 3. 开发模式

```bash
npm run tauri:dev
```

开发模式下，Tauri 主窗口会自动打开 DevTools。

### 4. 构建生产包

```bash
npm run tauri:build
```

产物位于 `src-tauri/target/release/bundle/nsis/` 下，包含 NSIS 安装包（`.exe`）和签名文件（`.sig`）。

### 5. 直接运行 release exe（免安装）

```powershell
# 复制音乐资源到 exe 同级目录（一次性操作）
Copy-Item -Recurse -Force music-player\music src-tauri\target\release\resources

# 运行
.\src-tauri\target\release\pomo-solo.exe
```

---

## 项目结构

> 本仓库同时承载**桌面端**与 **PWA 端**；**服务器端代码不在本仓库**（只有接口文档）；
> **安卓端在独立仓库**。四端关系见 [TEAM_GUIDE.md](./TEAM_GUIDE.md) §3。

```
electron_pomodoro/
│
├── src-tauri/                    # 【桌面端·后端】Rust（Tauri v2）
│   ├── src/
│   │   ├── lib.rs                # 应用入口，注册所有 commands
│   │   ├── main.rs               # Windows 入口（防止控制台窗口）
│   │   ├── state.rs              # 全局 MusicState
│   │   ├── commands/             # Tauri 命令层（前端可调用）
│   │   │   ├── timer.rs data.rs window.rs cloud_auth.rs garden.rs
│   │   │   ├── foreground.rs music.rs charts.rs ai.rs study_room.rs
│   │   │   ├── music_sync.rs p2p.rs sync.rs system.rs update.rs
│   │   ├── modules/              # 业务模块（不直接暴露给前端）
│   │   │   ├── audio_player.rs   # 音频播放（rodio + cpal + symphonia，纯 Rust）
│   │   │   ├── downloader.rs     # B 站音频下载（纯 Rust，DASH 解析）
│   │   │   ├── cloud_auth.rs     # AES-256-GCM + PBKDF2-SHA512 + 自建服务器认证
│   │   │   ├── data_manager.rs   # JSON 文件持久化（带锁）
│   │   │   ├── foreground_inspection.rs  # windows crate 前台检测
│   │   │   ├── server_api.rs ws.rs       # REST / WebSocket 客户端
│   │   ├── resources/music/      # 内置歌曲（构建时由 copy-resources.mjs 复制）
│   │   ├── capabilities/default.json     # Tauri 权限配置
│   │   ├── Cargo.toml / tauri.conf.json  # 依赖 / 应用配置（窗口·CSP·打包·updater）
│   │   └── target/               # [不入库] Rust 编译产物
│
├── src/                          # 【桌面端·前端】Vue 3 + TS + Pinia
│   ├── main.ts                   # 入口，挂载 Pinia
│   ├── App.vue                   # 主布局（含加载遮罩逻辑）
│   ├── api/                      # Tauri 命令封装（约 160 个 invoke）
│   ├── stores/                   # Pinia stores
│   ├── components/               # Vue 单文件组件（含 garden/ 子目录）
│   ├── utils/                    # 纯函数工具（musicLibrary 等）
│   ├── styles/global.css         # 全局样式（含 z-index 层级体系与颜色 token）
│   └── pwa/                      # 【PWA 端】alias 换层复用本目录，见 src/pwa/README.md
│
├── tools/ui/                     # 【工具】UI 取证工具（截图 + 布局审计）
│   ├── README.md                 # ★ 用法总览
│   ├── shot.mjs                  # Web/PWA 截图（CDP + Tauri IPC mock + 配方）
│   ├── desktop-shot.mjs          # Tauri 真窗口截图（Win32 PrintWindow）
│   ├── android-shot.mjs          # Android 截图 + UI 层级审计（adb）
│   └── lib/                      # CDP 客户端 / mock / 审计 / 配方
│
├── scripts/
│   ├── copy-resources.mjs        # 构建前复制音乐资源到 src-tauri/resources/
│   ├── generate-music.mjs        # 生成内置曲目
│   ├── migrate-supabase.mjs      # 旧 Supabase 迁移脚本
│   └── p2p-test/                 # P2P 联调工具（含独立 package.json）
│
├── server-planning/              # 【服务器端】接口权威文档（代码不在本仓库）
│   ├── EXTERNAL-INTERFACES.md    # ★ 对外接口唯一权威索引（REST/WS/P2P/更新源）
│   ├── API-implementation.md     # 接口实现记录 + 留言区
│   ├── API-quickref.md           # REST 速查
│   ├── README.md                 # 服务端需求规格
│   ├── PWA-requirements.md       # PWA 部署要求
│   ├── MESSAGE-BOARD-ARCHIVE.md  # 留言区归档
│   └── nginx.conf / ws_server.py / notice.json   # 参考配置与实现
│
├── music-player/                 # 音乐资源（构建时复制进应用）
│   ├── music/                    # 3 首内置曲 + tags.json
│   └── generated-music/          # 生成曲库
│
├── build/installer.nsh           # NSIS 安装器自定义配置
├── .github/workflows/ci.yml      # CI：测试 + 构建 + 双推 + 自动发布 Release
├── docs/                         # 项目文档（架构/模块/安全/踩坑记录）
│
├── .local/                       # 【本地私密区】不入库，仅 README 入库
│   └── README.md                 # ★ 契约：这里放什么、不放什么
├── temp-debug/                   # 【一次性调试产物】不入库
│
├── deprecated/                   # 【归档】旧实现，冻结不改（见 deprecated/README.md）
│   ├── electron/                 # 旧 Electron 完整源码（151 文件）
│   ├── music-player/             # 旧 Python 音乐模块 + 成品 exe
│   ├── foreground_inspection/    # 旧 Python 前台检测
│   ├── supabase-test/            # 旧 Supabase 测试应用
│   ├── legacy-scripts/           # 旧调试脚本
│   └── old-builds/               # 旧安装包（不入库）
│
├── index.html / garden.html      # Vite 双入口（主窗口 / 菜园子窗口）
├── package.json                  # 前端依赖与脚本
├── vite.config.ts                # Vite 配置（桌面端）
├── vitest.config.ts              # 测试配置（排除 deprecated/electron）
└── tsconfig.json / tsconfig.node.json
```

### 入库 / 不入库 一览

| 位置 | 入库 | 说明 |
|------|------|------|
| `src/` `src-tauri/src/` `tools/` `scripts/` `docs/` `server-planning/` | ✅ | 正式代码与文档 |
| `music-player/music/`（3 首内置曲 + tags.json） | ✅ | 应用内置资源 |
| `deprecated/**`（源码 + 成品 exe） | ✅ | 冻结的历史存档，见 `deprecated/README.md` |
| `.local/*`（**仅** `README.md` 入库） | ⚠️ 部分 | 本机/服务器专属事实、密钥**位置引用**、测试账号 |
| `temp-debug/` `coverage/` `dist/` `pwa-dist/` | ❌ | 一次性产物 / 构建输出 |
| `src-tauri/target/` `src-tauri/resources/` `node_modules/` | ❌ | 编译与安装产物 |
| `temp-debug/ui-shots/` | ❌ | UI 截图产物（见 `tools/ui/README.md`） |

---

## 临时调试文件规范

**两类东西分开放，不要混：**

| 目录 | 语义 | 生命周期 | 入库 |
|------|------|---------|------|
| **`temp-debug/`** | 一次性调试脚本、临时产物 | 用完即弃 | ❌ |
| **`.local/`** | 本机/服务器专属事实与密钥引用（长期有效） | 跟着这台机器走 | ❌（仅 README） |

- 两者都已 gitignore，**含密钥或本地路径的内容可以放心放**；
- 不要把临时文件散落在根目录、`src/`、`src-tauri/` 等正式代码目录；
- **判断口诀**：这条信息*换一台机器就不一样*或*泄漏会造成损失* → `.local/`；*只是这次排查用* → `temp-debug/`；
- 契约详见 [`.local/README.md`](./.local/README.md)；
- 临时文件如需调用 Rust example（`cargo run --example xxx`），需先拷回 `src-tauri/examples/` 再运行，用完移回 `temp-debug/`；
- 不再需要的临时文件应及时删除，避免堆积。


---

## 与旧版 Electron + Python 的对比

| 维度 | Electron v3.x | Tauri v2 v4.1+ |
|------|---------------|------------------|
| **安装包体积** | ~120MB（含 Chromium + Node + Python + ffmpeg） | ~17MB（复用系统 WebView2，纯 Rust） |
| **内存占用** | 200-400MB | 80-150MB |
| **后端语言** | JavaScript (Node.js) + Python 子进程 | 纯 Rust（内存安全、无 GC 暂停） |
| **音频播放** | Python sounddevice + soundfile（子进程 IPC） | rodio + symphonia（原生 Rust） |
| **音乐下载** | you-get.exe + ffmpeg.exe + Python | 纯 Rust（reqwest + DASH 解析） |
| **前台检测** | Python win32gui（子进程 IPC） | windows crate（原生 Rust） |
| **渲染层** | Chromium 内嵌 | 系统 WebView2（Edge 内核） |
| **IPC 模型** | `ipcMain.handle` + `contextBridge` | `#[tauri::command]` + `invoke` |
| **加密** | `safeStorage`（依赖 OS DPAPI） | AES-256-GCM（跨平台、密钥由机器特征派生） |
| **自动更新** | electron-updater | tauri-plugin-updater（签名验证） |
| **权限模型** | 全有或全无 | Tauri capabilities（按窗口/按权限粒度） |
| **前端框架** | 原生 JS + 全局变量 | Vue 3 + TypeScript + Pinia |
| **构建工具** | electron-builder + PyInstaller | Tauri CLI + Vite |

> 旧代码完整保留在 `deprecated/electron/` 和 `deprecated/` 目录，详见 `deprecated/README.md`。

---

## CI/CD

项目使用 GitHub Actions（`.github/workflows/ci.yml`）实现全自动化：

1. **Test & Coverage** — 运行 Vitest 测试 + 覆盖率
2. **Build (Windows)** — release 模式编译 + NSIS 打包 + 签名
3. **Release**（仅 tag 触发）— 自动创建 GitHub Release，上传安装包 + `latest.json`（供自动更新使用）

### 发布新版本

```bash
# 1. 更新版本号（package.json、Cargo.toml、tauri.conf.json）
# 2. 提交并打 tag
git tag -a v4.1.x -m "release notes"
git push origin v4.1.x
# 3. CI 自动完成构建和发布
```

---

## 开发指南

### 新增一个 Tauri 命令

1. 在 `src-tauri/src/commands/<领域>.rs` 中添加 `#[tauri::command]` 函数
2. 在 `src-tauri/src/lib.rs` 的 `generate_handler!` 宏中注册
3. 在 `src/api/<领域>.ts` 中封装 `invoke()` 调用，附带 TypeScript 类型
4. 在 `src/stores/` 或 `src/components/` 中消费

### 类型对齐

Rust 端的结构体和 TypeScript 接口必须保持字段一致：
- Rust 用 `snake_case`
- TypeScript 用 `camelCase`
- Tauri 自动做命名转换

### 提交规范

- commit message 用中文，前缀：`feat:` / `fix:` / `docs:` / `refactor:`
- 不要把 `src-tauri/target/` 加入版本控制

---

## PWA 端（PWA部门）

桌面优先的 PWA（部署于 `start.pomogrow.top`），**真实复用**桌面端 `src/` 组件/store/API（alias 换层，不 copy）。
开发说明见 [`src/pwa/README.md`](src/pwa/README.md)，服务器部署要求见 [`server-planning/PWA-requirements.md`](server-planning/PWA-requirements.md)。

```bash
# 开发（http://127.0.0.1:5199）
npm run pwa:dev

# 类型检查 + 构建 → pwa-dist/
npm run pwa:build
```

## 安卓端（安卓端部门）

> 部门：安卓端部门 ｜ 状态：🚧 筹备中（2026-09-10 成立，v0 开发中） ｜ 仓库：[PomoSolo-Android](https://github.com/liaowenqi123/PomoSolo-Android)

手机端移植（Android）。**目标是把 PomoSolo 变成真正的原生 Android 应用**，代码由安卓端部门自研
（可参考 PWA 部门的"真实复用"思路，但不 copy 其代码）。

路线分两步：

1. **v0（当前）**：以 WebView 壳复用 PWA 构建产物（`pwa-dist/`）快速跑通 —— 验证计时、音乐、登录、
   自习室等在手机上的可行性；
2. **v1+**：逐步用原生组件/服务替换 WebView 层（系统通知、后台播放、锁屏媒体控制、前台检测等），
   沉淀安卓端自己的代码与架构。

约束与协作：

- 跨端接口一律以 `server-planning/` 文档为准；跨部门改动需在相关文档留痕并同步（见 TEAM_GUIDE §3.4/§9）；
- 提交规范、部门声明规则与主仓库一致（见 TEAM_GUIDE §7/§15）；
- 详细规划见安卓端仓库 README。

---

## 测试

```bash
# 前端测试（watch 模式）
npm test

# 前端测试（单次运行 + 覆盖率）
npm run test:coverage

# PWA 类型检查（含桌面端复用源码）
npx vue-tsc --noEmit -p src/pwa/tsconfig.json

# Rust 测试
cd src-tauri && cargo test
```

---

## 许可证

MIT License
