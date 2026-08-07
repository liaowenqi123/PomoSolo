# 🍅 PomoSolo

**一款功能丰富的番茄钟专注应用 —— Tauri v2 + Vue 3 + 纯 Rust 后端。**

[![Release](https://img.shields.io/badge/Release-v4.7.0-ff6b6b)](https://github.com/liaowenqi123/PomoSolo/releases)
[![Tauri](https://img.shields.io/badge/Tauri-v2-blue)](https://tauri.app)
[![Vue](https://img.shields.io/badge/Vue-3.5-42b883)](https://vuejs.org)
[![Rust](https://img.shields.io/badge/Rust-2021-orange)](https://www.rust-lang.org)

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
| 🎵 **音乐播放器** | 纯 Rust 音频播放（rodio）、播放列表、标签管理、输出设备切换、播放模式、进度拖拽 |
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

```
electron_pomodoro/
├── src-tauri/                    # Rust 后端（Tauri v2）
│   ├── src/
│   │   ├── lib.rs                # 应用入口，注册所有 commands
│   │   ├── main.rs               # Windows 入口（防止控制台窗口）
│   │   ├── state.rs              # 全局 MusicState
│   │   ├── commands/             # Tauri 命令层（前端可调用）
│   │   │   ├── timer.rs          # 计时器状态
│   │   │   ├── data.rs           # 数据/设置读写
│   │   │   ├── window.rs         # 窗口控制
│   │   │   ├── cloud_auth.rs     # 云端认证 + API Key 管理
│   │   │   ├── garden.rs         # 菜园子操作
│   │   │   ├── foreground.rs     # 前台检测控制
│   │   │   ├── music.rs          # 音乐播放控制 + 进度上报
│   │   │   ├── charts.rs         # 榜单数据 + 歌曲下载
│   │   │   ├── ai.rs             # AI 规划助手
│   │   │   ├── study_room.rs     # 自习室
│   │   │   └── update.rs         # 自动更新
│   │   └── modules/              # 业务模块（不直接暴露给前端）
│   │       ├── audio_player.rs   # 音频播放器（rodio + Sink::try_seek）
│   │       ├── downloader.rs     # B 站音频下载（纯 Rust，DASH 解析）
│   │       ├── cloud_auth.rs     # AES-GCM 加密 + PBKDF2 + 自建服务器认证
│   │       ├── data_manager.rs   # JSON 文件持久化（带锁）
│   │       └── foreground_inspection.rs  # windows crate 前台检测
│   ├── resources/music/          # 内置歌曲（构建时由 copy-resources.mjs 复制）
│   ├── capabilities/default.json # Tauri 权限配置
│   ├── Cargo.toml                # Rust 依赖
│   └── tauri.conf.json           # Tauri 应用配置（窗口/CSP/打包/updater）
│
├── src/                          # Vue 3 前端
│   ├── main.ts                   # 入口，挂载 Pinia
│   ├── App.vue                   # 主布局
│   ├── api/                      # Tauri 命令封装
│   ├── stores/                   # Pinia stores
│   ├── components/               # Vue 单文件组件
│   └── styles/global.css         # 全局样式（含 z-index 层级体系）
│
├── music-player/                 # 音乐资源目录（仅保留 music/ 子目录）
│   └── music/                    # 内置歌曲 + tags.json
│
├── scripts/
│   └── copy-resources.mjs        # 构建前复制音乐资源到 src-tauri/resources/
│
├── build/
│   └── installer.nsh             # NSIS 安装器自定义配置
│
├── docs/                         # 项目文档
│
├── temp-debug/                   # 临时调试脚本/工具（不纳入版本控制，见下方说明）
│   ├── feedback.mjs              # 反馈管理 CLI
│   ├── test_download.rs          # B站下载流程测试（需拷回 src-tauri/examples/ 运行）
│   ├── analyze-coverage*.cjs     # 覆盖率分析脚本（旧 Electron 代码用）
│   └── run-vitest*.cjs           # vitest 运行包装脚本
│
├── .github/workflows/ci.yml      # CI：测试 + 构建 + 自动发布 Release
│
├── electron/                     # [废弃] 旧 Electron 源码（保留参考）
├── deprecated/                   # [废弃] 旧 Python 模块、脚本、安装包
│
├── index.html                    # Vite 入口 HTML
├── package.json                  # 前端依赖与脚本
├── vite.config.ts                # Vite 配置
└── tsconfig.json                 # TypeScript 配置
```

---

## 临时调试文件规范

**所有用于 debug / 临时测试的脚本、HTML 页面、一次性工具，统一放到项目根目录的 `temp-debug/` 文件夹下。**

- `temp-debug/` 已在 `.gitignore` 中忽略，**不会纳入版本控制**，可放心放入含密钥或本地路径的调试脚本。
- 不要把临时调试文件散落在项目根目录、`src/`、`src-tauri/` 等正式代码目录中。
- 临时文件如需调用 Rust example（`cargo run --example xxx`），需先拷贝回 `src-tauri/examples/` 再运行，用完移回 `temp-debug/`。
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

> 旧代码完整保留在 `electron/` 和 `deprecated/` 目录，详见 `deprecated/README.md`。

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

## 测试

```bash
# 前端测试（watch 模式）
npm test

# 前端测试（单次运行 + 覆盖率）
npm run test:coverage

# Rust 测试
cd src-tauri && cargo test
```

---

## 许可证

MIT License
