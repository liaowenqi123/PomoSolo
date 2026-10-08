# AGENTS.md —— PomoSolo 项目 agent 入口

> **在这个文件夹里启动任何 agent，请先读本文件。**
> 它回答：项目由哪几个端组成、各端代码在哪、怎么改、怎么验证、
> **什么能上 GitHub、什么只能留在本机**。
>
> 人读同样适用。更细的团队规则见 [`TEAM_GUIDE.md`](./TEAM_GUIDE.md)（737 行，权威）。
> 部门：主部门 ｜ 维护：任何结构变化请同步本文件并 commit + push 双仓库。

---

## 0. 30 秒速览

PomoSolo 是一款番茄钟专注应用，**由四个端组成，但只有两个端的代码在这个仓库里**：

| 端 | 代码位置 | 在本仓库？ | 语言/框架 | 状态 |
|----|---------|-----------|----------|------|
| 🖥 **桌面端**（Windows） | `src/` + `src-tauri/` | ✅ 是 | Tauri v2 + Vue 3 + TS + 纯 Rust | 已上线 v4.7.12 |
| 📱 **PWA 端** | `src/pwa/`（复用 `src/`） | ✅ 是 | Vite + Vue 3 + `vite-plugin-pwa` | 建设中，部署 `start.pomogrow.top` |
| ☁️ **服务器端** | **不在仓库**，代码在服务器 `115.159.49.112` | ❌ 否（只有接口文档在 `server-planning/`） | Python(WS) + Nginx + PostgreSQL + Redis | 运行中 |
| 🤖 **安卓端** | **独立仓库** `PomoSolo-Android`，本机在 `C:\Users\admin\AndroidStudioProjects\pomodoro` | ❌ 否 | Kotlin + Jetpack Compose（**原生，不是 WebView 壳**） | v1 开发中 |

**两个 git 远程**（都要推）：

| 远程 | 地址 | 作用 |
|------|------|------|
| `origin` | `https://github.com/liaowenqi123/PomoSolo.git` | GitHub 主仓库，触发 CI/CD 与 Release |
| `self` | `ubuntu@115.159.49.112:/home/ubuntu/PomoSolo.git` | 服务器上的裸仓，**服务器部署的代码来源** |

> 服务器访问 GitHub 慢 → 部署从 `self` 拉。**只推一边会造成线上与仓库不一致。**

---

## 1. ★ 什么能上 GitHub、什么不能

这是本文件最重要的一节。**判断口诀**：*换一台机器就不一样*或*泄漏会造成损失* → 不入库。

### ✅ 可以入库（GitHub 共享）

| 位置 | 内容 |
|------|------|
| `src/` `src-tauri/src/` | 桌面端前后端源码 |
| `src/pwa/` | PWA 专属层（复用 `src/`） |
| `tools/ui/` | UI 取证工具（截图 + 布局审计） |
| `scripts/` | 构建/迁移/P2P 联调脚本 |
| `docs/` | 架构、模块、安全、踩坑记录 |
| `server-planning/` | **服务器接口的权威文档**（REST/WS/P2P/更新源） |
| `music-player/music/` | 3 首内置曲 + `tags.json` |
| `deprecated/` | 冻结的历史存档（含 5 个成品 exe，~157MB，**有意保留**） |
| `.github/workflows/ci.yml` | CI 配置 |
| `.local/README.md` | 本地私密区的**契约说明**（唯一的例外，见下） |

### ❌ 不入库（只在本机）

| 位置 | 内容 | 为什么 |
|------|------|--------|
| **`.local/`**（除 `README.md`） | 本机工具链路径、服务器 SSH 细节、测试账号、**密钥位置引用**、发版踩坑 | 机器/服务器专属，泄漏有风险 |
| `temp-debug/` | 一次性调试脚本、临时产物 | 用完即弃 |
| `temp-debug/ui-shots/` | **UI 截图产物** | 一次性取证，不是交付物 |
| `node_modules/` `dist/` `pwa-dist/` `coverage/` | 依赖与构建输出 | 可重建 |
| `src-tauri/target/` `src-tauri/resources/` | Rust 编译产物 / 构建时复制的资源 | 可重建 |
| `deprecated/**/build/` `deprecated/**/__pycache__/` | PyInstaller 构建中间产物 | 纯噪声（已移出跟踪） |
| `deprecated/old-builds/` | 旧安装包 | 体积大 |

### 🔴 密钥一律留在仓库外

| 敏感物 | 位置（**仓库外**） |
|--------|------------------|
| **Tauri 更新签名私钥**（最敏感：可伪造更新包） | `C:\Users\admin\.tauri\pomosolo.key` |
| 服务器 SSH 私钥 | `C:\Users\admin\.ssh\id_rsa`（`ssh ubuntu-tencent`） |
| GitHub SSH 私钥 | `C:\Users\admin\.ssh\id_ed25519` |
| CI Secrets | GitHub 仓库设置（`TAURI_SIGNING_PRIVATE_KEY` / `SERVER_*`） |

> **`.local/SECRETS.md` 只记录「密钥在哪、怎么用」，绝不记录「密钥是什么」。**
> 提交前自查：`git status --short | Select-String '\.local/'` 应只出现 `README.md`。

---

## 2. 先看 UI，再改代码

**这个项目以前改样式只能靠读 CSS 猜** —— 历史上多次 UI bug（面板高度收缩、
按钮被挤成两排、文字被裁、弹窗被祖先裁剪）都是用户实测才发现的。

现在有了取证工具，**改任何 UI 之前先截图看一眼**：

```bash
# 桌面端主窗口（真实尺寸 520×560；自动起 dev server + 注入 Tauri IPC mock）
npm run ui:shot -- --target desktop

# 所有面板各截一张（设置/统计/教程/AI/图表/自习室/登录/深色）
npm run ui:shot -- --recipe desktop-panels

# PWA 断点全覆盖（含断点边界 ±1px）
npm run ui:shot -- --recipe pwa-screens

# 真实 Tauri 窗口（真 WebView2 + 真 Rust 后端；需先 npm run tauri:dev）
npm run ui:desktop

# Android（需模拟器已启动）
npm run ui:android
```

**产物**：`temp-debug/ui-shots/<时间戳>-<标签>/`
→ **先读 `index.md`**（人/agent 读的清单），它包含截图索引 + 页面错误 + 布局审计问题表。

工具会**自动审计**这些（判据对应历史上真出过的 bug）：
`overlay-blocking`（整屏遮罩挡住界面）、`text-clip`（文字被裁）、
`overflow-x/y`（内容溢出未滚动）、`out-of-viewport`（元素越界）、
`covered`（元素被浮层盖住点不到）、`tiny-target`（点击热区过小）、`tiny-font`。

> 完整说明见 **[`tools/ui/README.md`](./tools/ui/README.md)**。
> 零新增依赖：用 Node 自带 `fetch` + 全局 `WebSocket` 直驱 CDP，复用本机 Chrome/Edge。

---

## 3. 四端：怎么改

### 3.1 🖥 桌面端（本仓库）

**改前端**（`src/`）：
```bash
npm run dev          # Vite dev server → http://127.0.0.1:18421
npm run tauri:dev    # 完整 Tauri（含 Rust 后端，会打开真实窗口）
```
`src/` 结构：`api/`（invoke 封装，约 160 个命令）→ `stores/`（Pinia）→ `components/`（Vue SFC）。
样式 token 与 z-index 层级体系在 `src/styles/global.css`。

**改后端**（`src-tauri/src/`）—— 新增一个 Tauri 命令的四步：
1. 在 `commands/<领域>.rs` 加 `#[tauri::command]` 函数；
2. 在 `lib.rs` 的 `generate_handler!` 宏里注册（**漏了这步前端会报命令不存在**）；
3. 在 `src/api/<领域>.ts` 封装 `invoke()` 并写 TS 类型；
4. 在 `stores/` 或 `components/` 消费。

**验证**：
```bash
npm test                          # 前端 Vitest（61 文件 1218 例）
cd src-tauri && cargo test --lib  # Rust（304 例）
npx vue-tsc --noEmit              # 类型检查
npm run ui:selftest               # UI 工具自测
```

**构建**：`npm run tauri:build` → 产物在 `D:\pomosolo-cache\target\release\bundle\nsis\`（CI 用的共享 target）。

### 3.2 📱 PWA 端（本仓库 `src/pwa/`）

**核心机制：真实复用，不 copy。** 通过 Vite alias 把桌面端 `src/` 原样编译进 PWA：

| alias | 指向 | 作用 |
|-------|------|------|
| `@` | `src/` | 组件/store/API **原样复用** |
| `@tauri-apps/api` | `src/pwa/tauri/` | 浏览器 shim：`invoke` 路由到 localStorage/REST/WS/HTML5 Audio |

→ **重构桌面端 `src/` 时 PWA 自动同步**。所以**不要在 `src/pwa/` 里复制组件**。

```bash
npm run pwa:dev      # http://127.0.0.1:5199
npm run pwa:build    # 类型检查(src/pwa + 桌面端) + 构建 → pwa-dist/
```

**版本号策略**：只在"要发布 PWA"时改 `src/pwa/config.ts` 的 `PWA_VERSION`，
**日常 commit 不要动**（服务器部门约定：看到版本号变化即发布）。

详见 [`src/pwa/README.md`](./src/pwa/README.md) 与 [`server-planning/PWA-requirements.md`](./server-planning/PWA-requirements.md)。

### 3.3 ☁️ 服务器端（**代码不在本仓库**）

**服务器运行代码维护在服务器上，不进仓库。** 本仓库 `server-planning/` 只承载
**接口约定与规划**：

| 文档 | 作用 |
|------|------|
| `server-planning/EXTERNAL-INTERFACES.md` | ★ **对外接口唯一权威索引**（REST / WebSocket / P2P / 更新源） |
| `server-planning/API-implementation.md` | 接口实现记录 + **留言区**（与其他部门沟通的唯一通道） |
| `server-planning/API-quickref.md` | REST 速查 |
| `server-planning/README.md` | 服务端需求规格（端口/数据库/Nginx 路由） |
| `server-planning/PWA-requirements.md` | PWA 部署要求 |
| `server-planning/nginx.conf` / `ws_server.py` | 参考配置 / 参考实现 |

**怎么改服务器代码**：
```bash
ssh ubuntu-tencent            # 别名在 ~/.ssh/config；等价 ubuntu@115.159.49.112
```
标准流程（**强制留痕**）：
```
备份原文件（.bak_<版本>）
  → 修改
  → 语法校验：python3 -B -c "ast.parse(open('x.py').read())"
  → sudo docker restart frontend-web
  → 端到端验证
  → 在 server-planning/API-implementation.md 留言区记录并推送
```

> ⚠️ **直接 SSH 改动不留痕** —— 客户端开发者看不到服务器的 git 历史，
> 接口变了会静默故障。只要改到**其他部门相关**的接口/约定，
> 必须二选一：写文档 或 在 `self` 仓 commit。详见 `TEAM_GUIDE.md` §10.3。
>
> 服务器细节（部署目录、容器名、数据库连法、域名）见 **`.local/SERVER.md`**。

### 3.4 🤖 安卓端（**独立仓库**）

**代码不在本仓库**：`https://github.com/liaowenqi123/PomoSolo-Android`
本机路径：`C:\Users\admin\AndroidStudioProjects\pomodoro`

**它是 Kotlin + Jetpack Compose 原生应用（v1），不是 WebView 壳。**
（本仓库 `README.md` / `TEAM_GUIDE.md` 里"v0 WebView 壳"的说法**已过时** ——
该方案已从安卓仓库移除，只留在它的 git 历史里。以安卓仓库 README 为准。）

```bash
# 构建 + 安装 + 启动（MuMu 竖屏设备）
$AND = 'C:\Users\admin\AndroidStudioProjects\pomodoro'
$ADB = 'C:\Users\admin\AppData\Local\Android\Sdk\platform-tools\adb.exe'
& "$AND\gradlew.bat" -p $AND assembleDebug
& $ADB -s 127.0.0.1:16448 install -r "$AND\app\build\outputs\apk\debug\app-debug.apk"
& $ADB -s 127.0.0.1:16448 shell am start -n com.pomogrow.pomosolo/.MainActivity

# 截图 + UI 层级审计（用本仓库的工具）
npm run ui:android
```

**设备端口规则**：MuMu 从 `16384` 起，每多开一个实例 **+32**。
`16448` = 竖屏手机（长期用它做 UI 验证）；`16480` = 横屏，**需先 `adb connect`**。

**协作边界**：
- **共享**：产品功能定义、服务器接口（REST/WS/P2P）、账号体系 → **接口改动必须同步 `server-planning/`**；
- **参考不复制**：桌面端 Vue/Rust 源码只作界面/交互参考，不 copy；
- 提交也要带部门声明 `[安卓端部门]`。

> **在安卓仓库内**自己维护：`README.md`（现状）、`docs/CHANGELOG.md`（逐轮改版记录）、
> `docs/TEST-ENV.local.md`（已 gitignore，设备与测试账号）。
> 即 `C:\Users\admin\AndroidStudioProjects\pomodoro\docs\` 下，**不在本仓库**。
> 本机视角的完整备忘见 **`.local/ANDROID.md`**。

---

## 4. 本机 / 服务器专属信息在 `.local/`

**本文件（AGENTS.md）是真相层，`.local/` 是加速层** ——
缺了 `.local/` 项目照样能跑通、能发版，只是要重新查一遍环境。

| 文件 | 内容 |
|------|------|
| `.local/README.md` | ★ 契约（唯一入库文件）：放什么、不放什么、怎么用 |
| `.local/MACHINE.md` | 本机工具链路径、可用浏览器、adb、CI runner、缓存目录、网络坑 |
| `.local/SERVER.md` | 服务器 SSH / 部署目录 / 容器 / 数据库 / 域名 |
| `.local/SECRETS.md` | 敏感物清单 + **位置**（不写值） |
| `.local/ACCOUNTS.md` | 测试账号与联调前置 |
| `.local/ANDROID.md` | 安卓仓库路径、构建/安装/截图命令、设备表 |
| `.local/RELEASE.md` | 发版前置条件、版本号 6 处同步、红线核验、本机网络坑 |

---

## 5. 硬约束（改代码前必读）

来自 `TEAM_GUIDE.md` §6，违反会引入诡异 bug：

### UI 与样式
- **圆角统一 20px**；`.container` 需 `border-radius:20px` + `overflow:hidden` 裁剪内部元素；
- **z-index 必须用 `global.css` 的 CSS 变量**（`--z-base` / `--z-modal` / …），**禁止 magic number**；
- **深色容器内文字用显式亮色**，**禁用 `var(--text-color)`**（它跟随主题，亮色主题下会变黑字黑底）；
- **Modal 风格统一**：`#1a1a1a` 背景 + 白字 + `.app-modal-overlay` 遮罩；
- **不要给 `.main-content` 加 `overflow:hidden` / `z-index:1`** —— 会物理裁剪弹窗、破坏层叠上下文。

### Rust ↔ 前端对齐
- **Tauri 命令返回值序列化不做 camelCase 自动转换**（只有参数做）→
  Rust 结构体字段名必须与前端 JS 读取名**严格对齐**；需要 camelCase 时显式加
  `#[serde(rename_all = "camelCase")]`（历史教训：字段名不匹配导致整个面板渲染崩溃）。

### 工程约定
- 音乐下载/播放**必须是纯 Rust**，禁止引入 Python（you-get.exe / manual_downloader.exe）或 ffmpeg.exe；
- 临时文件放 `temp-debug/`；本机长期配置放 `.local/`；**不要散落在正式代码目录**；
- 不要为了"统一"去改 `deprecated/` 下的代码 —— 它是冻结的历史参考。

---

## 6. 工作流（改完怎么交付）

```
认领任务 → 建分支 → 开发 → 本地测试 → 截图核对 UI → 更新文档 → commit（带部门声明）
  → push origin + self → 合并/PR → 发版（可选）
```

### 部门声明（强制）
每次正式输出都要声明部门，格式 `[部门] 类型: 描述`：

| 部门 | 代号 | 默认？ |
|------|------|--------|
| 主部门 | `主部门` | ✅ 默认（未声明即主部门） |
| 服务器部门 | `服务器部门` | |
| PWA 部门 | `PWA部门` | |
| 安卓端部门 | `安卓端部门` | |

类型前缀：`feat:` / `fix:` / `docs:` / `refactor:` / `style:` / `chore:` / `perf:`；描述用中文。

```bash
git commit -m "[主部门] fix: 修复计时器暂停后时间重置的问题"
```

### 双仓库推送（强制，每次工作完立即推）
```bash
git push origin main && git push self main
```
> 不要攒多个 commit 一起推，更不要"只 commit 不 push"过夜 ——
> 服务器部署依赖 `self`，GitHub CI/Release 依赖 `origin`。
> ⚠️ `self` 裸仓可能被服务器部门直接提交而领先于 `origin` →
> **严禁 force push main**，正确解法：`git merge origin/main --no-edit` 产生 merge commit 再 push。

### 文档同步（铁律）
**改代码必须同步改文档**，文档落后于代码时**禁止发版**：

| 改了什么 | 必须同步更新 |
|---------|-------------|
| 接口/协议（REST/WS/P2P） | `server-planning/API-implementation.md` + `EXTERNAL-INTERFACES.md` |
| 模块架构/流程 | `docs/` 下对应架构文档 |
| 功能行为 | `README.md` 功能列表 + `docs/FEATURES.md` |
| Bug 修复 | `docs/BUGFIX_RECORDS.md` |
| 安全相关 | `docs/SECURITY.md` |
| **仓库结构 / 协作边界** | **本文件 `AGENTS.md`** |

### 发版
发版流程与红线见 `TEAM_GUIDE.md` §16 与 **`.local/RELEASE.md`**。
**最重的一条红线**：改动过更新链路（版本解析/下载/验签）后，
必须用**真实发布物**做端到端验签，**禁止只依赖单测**
（历史教训：签名验证 bug 导致老用户只能手动卸载重装）。

---

## 7. 文档地图

### 必读
| 文档 | 说明 |
|------|------|
| **本文件 `AGENTS.md`** | ★ agent/新人入口：四端导航 + 入库边界 + 硬约束 |
| `TEAM_GUIDE.md` | 团队协作权威：部门分工、工作流、双仓库、红线（737 行） |
| `README.md` | 项目总览、技术栈、快速开始、项目结构 |
| `tools/ui/README.md` | UI 取证工具用法 |
| `.local/README.md` | 本地私密区契约 |

### 架构与模块
| 文档 | 说明 |
|------|------|
| `docs/ARCHITECTURE.md` | 整体架构详解 |
| `docs/FEATURES.md` | 功能清单 |
| `docs/modules/` | 模块级文档（music-player、garden、sidebar-and-modes、cloud-and-charts、window-system、modal-system） |
| `docs/SECURITY.md` | 安全设计（加密、认证、Token） |
| `docs/STUDY_ROOM_ARCHITECTURE.md` | 自习室架构 |
| `docs/GARDEN_DATA_ARCHITECTURE.md` | 菜园子数据架构 |
| `docs/AUTO_UPDATE_DESIGN.md` | 自实现更新器设计 |

### 排错与历史
| 文档 | 说明 |
|------|------|
| `docs/BUGFIX_RECORDS.md` | Bug 修复记录（修 Bug 必须追加） |
| `docs/TAURI_MIGRATION_PITFALLS.md` | Tauri 迁移踩坑总录 |
| `docs/SUBPROCESS_ORPHAN_ISSUE.md` | 子进程孤儿问题 |
| `docs/MIGRATION.md` | Electron → Tauri 迁移对照表 |
| `deprecated/README.md` | 归档说明与体积记录 |

### ⚠️ 历史文档（已加横幅标注，不要照着改代码）
| 文档 | 问题 |
|------|------|
| `docs/DEVELOPER_GUIDE.md` | **大部分是 Electron + Supabase 时代内容**，目录结构/模块/进程通信/构建打包均与实际不符。唯一仍有价值的是本地 runner 与缓存目录那段 |
| `docs/MODAL_SYSTEM.md` | 描述**旧 Electron 弹窗系统**（`modal.js` / `AnimatedModal` / `window.modalManager`）。当前 Vue 弹窗见 `docs/modules/modal-system.md` |
| `docs/SUBPROCESS_ORPHAN_ISSUE.md` | 分析**旧 Electron + Python 子进程残留**。当前是纯 Rust、无 Python 子进程，**该问题不可能发生** |
| `README.md` / `TEAM_GUIDE.md` 里的安卓端描述 | 曾经说"v0 WebView 壳"，**实际已是原生 v1**（已于 2026-09 修正，若再见到旧表述属遗漏） |

### 服务器
`server-planning/` 全部 9 个文件，入口是 `EXTERNAL-INTERFACES.md`。

---

## 8. 常见任务速查

| 我想… | 怎么做 |
|-------|--------|
| 看 UI 现在长什么样 | `npm run ui:shot -- --target desktop`，读产物的 `index.md` |
| 看某个面板 | `npm run ui:shot -- --recipe desktop-panels` |
| 核对真机效果 | `npm run tauri:dev` 另开终端 → `npm run ui:desktop` |
| 查手机端 | `npm run ui:android`（先开模拟器） |
| 改样式 | 改 `src/styles/global.css` token 或组件 scoped 样式 → 截图核对 |
| 加一个 Tauri 命令 | 见 §3.1 四步（**别忘了 `lib.rs` 注册**） |
| 改服务器接口 | 改 `server-planning/EXTERNAL-INTERFACES.md` + 留言区，然后通知服务器部门 |
| 改安卓端 | 切到 `C:\Users\admin\AndroidStudioProjects\pomodoro`，见 §3.4 |
| 跑测试 | `npm test` + `cd src-tauri && cargo test --lib` |
| 发版 | `TEAM_GUIDE.md` §16 + `.local/RELEASE.md` |
| 找密钥 | `.local/SECRETS.md`（只有位置，没有值） |
| 找本机路径 | `.local/MACHINE.md` |

---

*本文件由主部门维护。仓库结构、协作边界、入库规则变化时，请同步更新本文件并 commit + push 双仓库。*
