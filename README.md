# 🍅 PomoSolo

**一款功能丰富的番茄钟专注应用 —— 用 Tauri v2 + Vue 3 重新构建。**

[![Release](https://img.shields.io/badge/Release-v4.0.0-ff6b6b)](https://github.com/liaowenqi123/electron_pomodoro/releases)
[![Tauri](https://img.shields.io/badge/Tauri-v2-blue)](https://tauri.app)
[![Vue](https://img.shields.io/badge/Vue-3.5-42b883)](https://vuejs.org)

---

## 这是什么？

PomoSolo 是一款 Windows 桌面番茄钟应用，从原 Electron 版本（v3.x）重构为 Tauri v2 + Vue 3 架构（v4.0）。它不止是倒计时工具，还整合了**专注激励游戏、AI 分心检测、内置音乐播放器、自习室、AI 任务规划**等功能，让专注不再枯燥。

---

## 为什么选择 PomoSolo？

| 对比 | 普通番茄钟 | PomoSolo |
|------|-----------|---------|
| 专注激励 | 只有倒计时 | 🌱 种菜园子，专注时长可收获作物 |
| 分心防护 | 靠自己克制 | 🔍 AI 检测娱乐应用，违规自动惩罚 |
| 音乐陪伴 | 需要另开播放器 | 🎵 内置音乐播放器，支持榜单下载 |
| 社交学习 | 孤独学习 | 👥 自习室，实时排名 |
| 任务规划 | 手动排期 | 🤖 AI 一句话生成任务计划 |
| 安装体积 | Electron 动辄 100MB+ | 💾 Tauri 安装包 ~10MB |

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 桌面框架 | **Tauri v2** | 用 Rust 调用系统 WebView，替代 Electron |
| 前端框架 | **Vue 3.5** + Composition API | 单文件组件 + `<script setup>` |
| 类型系统 | **TypeScript 5.6** | 前端全量 TS，与 Rust 端结构体一一对应 |
| 状态管理 | **Pinia 2.2** | 替代 Vuex / 全局事件总线 |
| 构建工具 | **Vite 6** | 替代 Webpack，HMR 极速 |
| 后端语言 | **Rust (Edition 2021)** | 内存安全，零成本抽象 |
| 加密 | **aes-gcm + pbkdf2 + sha2** | AES-256-GCM + PBKDF2-SHA512 |
| 图表 | **Chart.js 4.5** | 统计可视化 |
| 进程通信 | Tauri IPC + 事件 | `invoke` 调用命令、`listen` 监听事件 |

---

## 功能列表

| 模块 | 说明 |
|------|------|
| 🍅 **计时器** | 三种模式（工作/休息/自定义）、时间戳计时、键盘快捷键 |
| 🌱 **菜园子游戏** | 5 种作物（胡萝卜/番茄/向日葵/玫瑰/金桂树）、12 块土地、成就系统、每日签到 |
| 🔍 **专注模式 / 前台检测** | AI 判断前台窗口是否为娱乐应用，黑白名单 + 历史记录多源判定，违规触发作物枯萎惩罚 |
| 🎵 **音乐播放器** | Python 子进程驱动、播放列表、标签管理、输出设备切换、播放模式 |
| 👥 **自习室** | 公开/私密房间、实时排名、专注时长同步 |
| 📊 **统计** | 日/周/月专注时长图表、热力图、趋势分析 |
| 🤖 **AI 规划助手** | 一句话生成番茄钟计划，调用 DeepSeek（云端 / 本地双模式） |
| 🔐 **云端账号** | Supabase 后端、本地凭据 AES-256-GCM 加密、单点登录心跳 |

---

## 快速开始

### 1. 环境要求

| 工具 | 版本 | 用途 |
|------|------|------|
| Node.js | ≥ 18 | 前端构建 |
| Rust | ≥ 1.77 | 后端编译 |
| Tauri CLI | v2 | 已随 `package.json` 安装 |

Windows 10 / 11 自带 WebView2，无需额外运行环境。

### 2. 安装依赖

```bash
# 前端依赖
npm install

# Rust 依赖（首次会自动拉取）
cd src-tauri
cargo fetch
cd ..
```

### 3. 开发模式

```bash
# 同时启动 Vite 开发服务器 + Tauri 后端（带 DevTools）
npm run tauri:dev
```

开发模式下，Tauri 主窗口会自动打开 DevTools（见 `src-tauri/src/lib.rs` 中 `#[cfg(debug_assertions)]` 分支）。

### 4. 构建生产包

```bash
# 类型检查 + Vite 构建 + Rust release 编译 + 打包
npm run tauri:build
```

产物位于 `src-tauri/target/release/bundle/` 下，包含 NSIS（`.exe`）和 MSI 两种安装包格式（见 `tauri.conf.json` 中 `bundle.targets`）。

`Cargo.toml` 中的 release profile 已做体积优化：

```toml
[profile.release]
panic = "abort"
codegen-units = 1
lto = true
opt-level = "s"
strip = true
```

### 5. 仅前端开发（不启动 Rust）

```bash
npm run dev      # 仅 Vite
npm run build    # 仅类型检查 + 前端构建
```

> 注意：仅前端模式下，所有 `invoke()` 调用会失败，部分 store 会回退到 localStorage（见 `src/stores/settings.ts` 的容错逻辑）。

---

## 项目结构

```
electron_pomodoro/
├── src-tauri/                    # Rust 后端（Tauri v2）
│   ├── src/
│   │   ├── lib.rs                # 应用入口，注册所有 commands
│   │   ├── main.rs               # Windows 入口（防止控制台窗口）
│   │   ├── state.rs              # 全局 AppState（替代 electron/main/state.js）
│   │   ├── commands/             # Tauri 命令层（前端可调用）
│   │   │   ├── timer.rs          # 计时器状态
│   │   │   ├── data.rs           # 数据/设置读写
│   │   │   ├── window.rs         # 窗口控制
│   │   │   ├── cloud_auth.rs     # 云端认证 + API Key 管理
│   │   │   ├── garden.rs         # 菜园子操作
│   │   │   └── foreground.rs     # 前台检测控制
│   │   └── modules/              # 业务模块（不直接暴露给前端）
│   │       ├── cloud_auth.rs     # AES-GCM 加密 + PBKDF2 + Supabase
│   │       ├── data_manager.rs   # JSON 文件持久化（带锁）
│   │       ├── foreground_inspection.rs  # windows crate 前台检测
│   │       └── music_process.rs  # Python 子进程通信
│   ├── capabilities/default.json # Tauri 权限配置
│   ├── Cargo.toml                # Rust 依赖
│   └── tauri.conf.json           # Tauri 应用配置（窗口/CSP/打包）
│
├── src/                          # Vue 3 前端
│   ├── main.ts                   # 入口，挂载 Pinia
│   ├── App.vue                   # 主布局
│   ├── api/                      # Tauri 命令封装（替代 preload.js）
│   │   ├── index.ts              # 统一出口
│   │   ├── data.ts               # read_data / write_data
│   │   ├── auth.ts               # 云端认证 + API Key
│   │   ├── garden.ts             # 菜园子操作
│   │   ├── foreground.ts         # 前台检测 + 事件监听
│   │   ├── music.ts              # 音乐播放器
│   │   ├── ai.ts                 # AI 规划
│   │   ├── timer.ts / window.ts  # 计时器/窗口
│   │   ├── charts.ts / studyRoom.ts
│   │   └── events.ts             # 通用事件封装
│   ├── stores/                   # Pinia stores
│   │   ├── timer.ts              # 计时器逻辑
│   │   ├── settings.ts           # 应用设置
│   │   ├── garden.ts             # 菜园子状态 + 静态配置
│   │   ├── auth.ts / music.ts / stats.ts
│   ├── components/               # Vue 单文件组件
│   │   ├── Timer.vue / TimerProgress.vue
│   │   ├── ModeSwitch.vue / Presets.vue
│   │   ├── WindowControls.vue
│   │   ├── SettingsPanel.vue / Statistics.vue
│   │   ├── AIHelper.vue / AuthPanel.vue
│   │   ├── MusicPlayer.vue / StudyRoom.vue
│   │   ├── ForegroundWarning.vue
│   │   ├── NoteManager.vue / Modal.vue
│   │   ├── Charts.vue
│   │   └── garden/               # 菜园子子组件
│   └── styles/global.css
│
├── electron/                     # 旧 Electron 代码（保留参考，不再维护）
│   ├── main.js                   # Electron 主进程
│   ├── preload.js                # contextBridge 桥接
│   ├── main/                     # IPC 处理器（按领域拆分）
│   └── src/                      # 渲染层（旧版纯 JS）
│
├── foreground_inspection/        # Python 前台检测（已用 Rust 替代，保留源码）
│   ├── foreground_inspection.py
│   └── foreground_inspection.exe
│
├── music-player/                 # Python 音乐播放器（保留，Rust 子进程调用）
│   ├── music.py / music.exe
│   ├── manual_downloader.py      # 歌曲下载工具
│   ├── you-get.exe / ffmpeg.exe
│   └── README.md
│
├── docs/                         # 项目文档
│   ├── ARCHITECTURE.md           # 架构设计
│   ├── MIGRATION.md              # 迁移指南
│   ├── SECURITY.md               # 安全设计
│   └── ...                       # 其他历史文档
│
├── index.html                    # Vite 入口 HTML
├── package.json                  # 前端依赖与脚本
├── vite.config.ts                # Vite 配置（隐式）
└── tsconfig.json                 # TypeScript 配置
```

---

## 与旧版 Electron 的对比

| 维度 | Electron v3.x | Tauri v2 (v4.0) |
|------|---------------|------------------|
| **安装包体积** | ~120MB（含 Chromium + Node） | ~10MB（复用系统 WebView2） |
| **内存占用** | 200-400MB | 80-150MB |
| **后端语言** | JavaScript (Node.js) | Rust（内存安全、无 GC 暂停） |
| **渲染层** | Chromium 内嵌 | 系统 WebView2（Edge 内核） |
| **IPC 模型** | `ipcMain.handle` + `contextBridge` | `#[tauri::command]` + `invoke` |
| **加密** | `safeStorage`（依赖 OS DPAPI） | AES-256-GCM（跨平台、密钥由机器特征派生） |
| **CSP** | 默认宽松 | 严格白名单（见 `tauri.conf.json`） |
| **权限模型** | 全有或全无 | Tauri capabilities（按窗口/按权限粒度） |
| **前端框架** | 原生 JS + 全局变量 | Vue 3 + TypeScript + Pinia |
| **构建工具** | electron-builder | Tauri CLI + Vite |
| **跨平台** | Windows/Mac/Linux | Windows/Mac/Linux/iOS/Android |

> 旧 Electron 代码完整保留在 `electron/` 目录，便于参考对照，但不再维护新功能。

---

## 开发指南

### 新增一个 Tauri 命令

1. 在 `src-tauri/src/commands/<领域>.rs` 中添加 `#[tauri::command]` 函数
2. 在 `src-tauri/src/lib.rs` 的 `generate_handler!` 宏中注册
3. 在 `src/api/<领域>.ts` 中封装 `invoke()` 调用，附带 TypeScript 类型
4. 在 `src/stores/` 或 `src/components/` 中消费

### 新增一个 Vue 组件

- 使用 `<script setup lang="ts">` 语法
- 状态跨组件共享走 Pinia store，不要直接全局事件总线
- 调用后端走 `src/api/`，不要在组件里直接 `invoke`

### 类型对齐

Rust 端的结构体（如 `Session`、`TimerState`、`DetectionResult`）和 TypeScript 接口必须保持字段一致：

- Rust 用 `snake_case`
- TypeScript 用 `camelCase`
- Tauri 自动做命名转换，前端 `invoke` 时传 `camelCase` 参数即可

### 调试技巧

- Rust 日志：用 `eprintln!`，输出到 `tauri dev` 终端
- 前端日志：DevTools Console
- IPC 调用：DevTools Network → Tauri 面板
- 事件流：在 `src/api/events.ts` 中加日志监听所有事件

### 提交规范

- 一次提交只做一件事
- commit message 用中文，前缀：`feat:` / `fix:` / `docs:` / `refactor:`
- 不要把 `src-tauri/target/` 加入版本控制

---

## 测试

### 概览

| 维度 | 数量 | 说明 |
|------|------|------|
| 前端测试文件 | 41 | `src/**/__tests__/*.test.ts` |
| 前端测试用例 | 794 | 全部通过 |
| Rust 测试用例 | 26 | `cargo test` 全部通过 |
| 语句覆盖率 | 94.5% | v8 provider |
| 分支覆盖率 | 88.57% | |
| 函数覆盖率 | 92.6% | |
| TypeScript 类型检查 | 通过 | `vue-tsc --noEmit` |

### 测试分层

```
src/
├── api/__tests__/           # API 层：验证每个 invoke 命令名 + 参数 + 错误传播
│   ├── data.test.ts         # readData/writeData/readSettings/writeSettings
│   ├── auth.test.ts         # cloudLogin/Register/Logout/Session + 凭据 + ApiKey
│   ├── garden.test.ts       # gardenRead/Plant/Harvest/BuySeed/SellCrop/...
│   ├── foreground.test.ts   # foregroundStart/Stop + 事件监听
│   ├── music.test.ts        # musicTogglePlay/Next/Prev/Seek/...
│   ├── ai.test.ts           # aiGeneratePlan
│   ├── charts.test.ts       # chartsFetch/downloadSong
│   ├── studyRoom.test.ts    # studyRoomCreate/Join/Leave/...
│   ├── timer.test.ts        # getTimerState
│   ├── window.test.ts       # minimizeWindow/closeWindow/...
│   ├── events.test.ts       # listen/emit/emitTo + useTauriEvent/useTauriEventOnce
│   └── index.test.ts        # 统一出口 re-export 完整性验证
│
├── stores/__tests__/        # Store 层：验证 state/getter/action + 副作用
│   ├── timer.test.ts        # 三阶段状态机 + tick + complete + 自动切换 work/break
│   ├── settings.test.ts     # load/save/update/reset/toggleTheme + localStorage 回退
│   ├── garden.test.ts       # load/plant/harvest/buySeed/sellCrop/signIn/... + 静态配置
│   ├── auth.test.ts         # init/switchMode/login/register/logout/saveLocalApiKey
│   ├── music.test.ts        # togglePlay/next/prev/seek/setVolume/cyclePlayMode + 事件 handler
│   └── stats.test.ts        # load/recordSession/resetToday + 跨天重置 + last7Days
│
└── components/__tests__/    # 组件层：验证渲染 + 交互 + 事件 + 条件分支
    ├── App.test.ts          # 主应用壳：布局 + 主题 class + 键盘快捷键 + 完成联动 + 卸载清理
    ├── Timer.test.ts        # 时间显示 + 三态状态文本（ready/running/finished 全分支）
    ├── ModeSwitch.test.ts   # 专注/休息按钮 + active 类 + 运行中忽略
    ├── TimerProgress.test.ts # SVG 圆环 + dashOffset 响应性（已修复 bug）
    ├── Modal.test.ts        # v-if + 背景点击 + ESC + body overflow + width
    ├── WindowControls.test.ts # 最小化/关闭按钮 + 错误捕获
    ├── NoteManager.test.ts  # 输入 + 清除 + disabled + modelValue 同步
    ├── Presets.test.ts      # 选中/添加/删除 + 持久化 + localStorage 回退（已修复 bug）
    ├── SettingsPanel.test.ts # 主题/选择器/开关 + reset + 持久化
    ├── Statistics.test.ts   # 三卡片 + Chart 实例生命周期 + updateChart + 卸载销毁
    ├── StudyRoom.test.ts    # 四视图切换 + 创建/加入/离开 + 30s 刷新
    ├── AuthPanel.test.ts    # 模式切换 + 登录/注册 + 确认弹窗 + Admin 徽章
    ├── AIHelper.test.ts     # 输入校验 + 生成 + 加载态 + 结果渲染 + Apply
    ├── ForegroundWarning.test.ts # 警告计数 + 惩罚触发 + API Key 弹窗
    ├── MusicPlayer.test.ts  # 收起/展开 + 控制按钮 + 进度条 + 设备/播放列表
    ├── Charts.test.ts       # 源切换 + 下载模式 + 表格 + toast
    ├── GardenMain.test.ts   # 金币 + 导航按钮 + 弹窗切换 + 种植/收获分发
    ├── GardenPlot.test.ts   # 三态格子 + 解锁 + 成熟判定 + stopPropagation
    ├── GardenBag.test.ts    # 种子/作物列表 + 选中态 + 空状态
    ├── GardenShop.test.ts   # 购买/出售 tab + 金币不足禁用 + 空状态
    ├── GardenSignin.test.ts # 连续/总天数 + 周点 + 奖励列表 + 签到按钮
    ├── GardenAchievement.test.ts # 分类筛选 + 进度条 + 已解锁徽章
    └── GardenPlantWheel.test.ts  # Canvas 扇区命中 + 中心 -1 + 关闭
```

### 运行测试

```bash
# 前端测试（watch 模式）
npm test

# 前端测试（单次运行 + 覆盖率）
npm run test:coverage

# Rust 测试
cd src-tauri
cargo test
```

### 测试发现并修复的 Bug

UI 测试在重构过程中发现了 2 个真实 bug，均已修复：

1. **TimerProgress.vue 响应性 bug**：`dashOffset` 以普通常量计算（`const dashOffset = circumference * (1 - timer.progress)`），未使用 `computed()`，导致进度圆环不随计时推进而动画。修复为 `computed(() => circumference * (1 - timer.progress))`。

2. **Presets.vue localStorage 格式不一致**：`persist()` 写入 localStorage 的格式为 `{ presets: { work, break } }`，但 `load()` 的 catch 分支直接将 `JSON.parse(saved)` 传给 `normalizePresets()`（期望 `{ work, break }` 而非 `{ presets: {...} }`），导致后端不可用时无法读回 localStorage 中的预设。修复为先解包 `.presets` 字段。

### 与旧版 Electron 的 UI 行为对照

测试用例基于对旧 Electron 版本 30 个渲染模块的完整行为清单编写，覆盖：

- 三阶段计时器状态机（READY/RUNNING/FINISHED）
- 工作/休息模式切换 + 配色
- 预设管理（选中/添加/删除/持久化）
- 菜园子全流程（种植/收获/解锁/商店/签到/成就墙/轮盘）
- 认证双模式（云端登录/注册 + 本地 API Key）
- AI 规划助手（输入/生成/应用）
- 前台检测警告（计数/惩罚/API Key 错误）
- 音乐播放器（播放控制/进度/音量/设备/播放列表）
- 设置面板（主题/选择器/开关/恢复默认）
- 统计/自习室/音乐榜单

---

## 许可证

MIT License
