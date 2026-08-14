# 🍅 PomoSolo 团队协作指南（TEAM_GUIDE）

> **这份文档是每一位新加入开发者的第一份必读文档。**
> 读完本文档 + 各文档入口，你就可以直接投入工作。
>
> - 最后更新：2026-08-14
> - 当前版本：v4.7.11（Tauri v2 + Vue 3 + Rust）
> - 适用范围：所有在本仓库工作的人，以及通过 SSH 维护服务器的协作者（含 AI 助手）
> - 本文档沉淀自主部门长期实践，包含**项目理念与红线**——这些是踩过坑换来的，请务必遵守。

---

## 目录

1. [这份文档解决什么问题](#1-这份文档解决什么问题)
2. [项目速览](#2-项目速览)
3. [组织架构：三个部门](#3-组织架构三个部门)
4. [项目理念与红线（必读）](#4-项目理念与红线必读)
5. [技术现状：三个关键认知](#5-技术现状三个关键认知)
6. [编码硬约束（Hard Constraints）](#6-编码硬约束hard-constraints)
7. [部门声明规则（必读）](#7-部门声明规则必读)
8. [双仓库工作流](#8-双仓库工作流)
9. [标准工作流程](#9-标准工作流程)
10. [服务器部门的特殊工作流](#10-服务器部门的特殊工作流)
11. [PWA 部门（规划中）](#11-pwa-部门规划中)
12. [文档地图](#12-文档地图)
13. [环境搭建与快速上手](#13-环境搭建与快速上手)
14. [常用命令速查](#14-常用命令速查)
15. [提交规范](#15-提交规范)
16. [发布流程](#16-发布流程)
17. [新人上岗 Checklist](#17-新人上岗-checklist)

---

## 1. 这份文档解决什么问题

项目发展至今，代码与服务器已经形成**多部门协作**的形态。这份文档回答三个问题：

1. **我是谁** —— 项目里有哪些部门，我的部门负责什么，边界在哪里；
2. **我怎么做** —— 从认领任务到交付（commit → 推送双仓库 → 发版）的完整工作流；
3. **我改了什么、怎么让别人知道** —— 每次产出必须声明部门，跨部门改动必须留下文档或提交记录。

> 管理者（或项目负责人）在给新人分配职责时，只需**声明他的部门**（如"你属于服务器部门"），
> 新人读完本文档即可投入工作。**没有特别声明的，默认属于主部门。**

---

## 2. 项目速览

**PomoSolo** 是一款番茄钟专注应用，目前包含三个"端"：

| 端 | 状态 | 说明 |
|----|------|------|
| 🖥 桌面端（Windows） | ✅ 已上线（v4.7.11） | Tauri v2 + Vue 3 + 纯 Rust 后端，安装包约 17MB，自动更新 |
| 🖥 服务器端 | ✅ 运行中 | 自建公网服务器：JWT 认证、REST API、WebSocket（自习室/同步听歌等）、P2P 信令 |
| 📱 PWA 端 | 🚧 规划中 | 兼容手机 + 电脑浏览器的 PWA，代码将放在本仓库 `pwa/` 目录（见第 11 节） |

### 核心功能

- 🍅 计时器（工作/休息/自定义、快捷键）
- 🌱 菜园子游戏（种菜、成就、签到、连击、段位）
- 🔍 专注模式 / AI 前台分心检测（惩罚机制）
- 🎵 内置音乐播放器 + B 站音频下载
- 👥 自习室（实时排名、同步听歌、WebSocket）
- ⚡ P2P 直连（音乐传歌、安装包分享，服务器只做信令）
- 🤖 AI 规划助手（DeepSeek）
- 🔐 云端账号（自建服务器 JWT + refresh token）
- 🔄 自动更新（自实现更新器，GitHub/服务器双源 + 签名校验）

### 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri v2（Rust 后端，替代 Electron） |
| 前端 | Vue 3.5 + TypeScript 5.6 + Pinia 2.2 + Vite 6 |
| 后端语言 | Rust (Edition 2021)，命令层在 `src-tauri/src/commands/` |
| 音频 | rodio + symphonia（纯 Rust 播放与下载） |
| P2P | 浏览器原生 RTCPeerConnection + DataChannel（werift 仅测试用） |
| 加密 | AES-256-GCM + PBKDF2-SHA512、Ed25519（更新签名） |
| 图表 | Chart.js 4.5 |
| 更新 | 自实现更新器（commands/update.rs，签名验证 + 断点续传） |
| 服务器 | 自建（规划见 `server-planning/README.md`），Nginx 反向代理，PostgreSQL + Redis |

> 详细架构请读 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) 与 [README.md](./README.md)。

---

## 3. 组织架构：三个部门

| 部门 | 代号 | 职责 | 代码位置 | 是否默认 |
|------|------|------|---------|---------|
| **主部门** | `主` | **负责所有事情**：桌面端开发、构建、发布、CI/CD、仓库与双仓库维护、通用文档维护 | 本仓库全部代码（`src/`、`src-tauri/`、`scripts/`、`docs/` 等） | ✅ **默认部门** |
| **服务器部门** | `服务器` | 服务器相关问题：认证、REST API、WebSocket、P2P 信令、数据库、部署、Nginx、域名/备案、HTTPS | **运行代码不在本仓库**（维护在服务器上）；接口约定与规划通过本仓库 `server-planning/` 沟通 | ❌ |
| **PWA 部门** | `PWA` | 手机 + 电脑浏览器访问的 PWA 端（即将新建） | 本仓库 `pwa/` 目录（规划中） | ❌ |

### 3.1 主部门（Main）

- 桌面端全部功能：计时器、菜园子、专注检测、音乐、自习室客户端、AI 助手、统计、设置；
- 构建与发布：NSIS 打包、签名、自动更新配置、GitHub Release、服务器更新源同步；
- 仓库维护：双仓库同步、CI 工作流（`.github/workflows/ci.yml`）、分支管理、文档总览维护；
- **默认兜底**：任何没有明确归属的任务，默认由主部门承担。

### 3.2 服务器部门（Server）

- 服务器的**实际运行代码**（认证服务、REST API、WebSocket 服务、P2P 信令、数据库脚本、Nginx 配置）——**不进入本仓库**；
- 通过本仓库 `server-planning/` 目录**沟通接口与规划**：
  - `EXTERNAL-INTERFACES.md` —— 客户端所有对外接口的唯一权威索引（REST / WebSocket / P2P / 更新源）
  - `API-implementation.md` —— 接口详细实现与迭代记录（含留言区）
  - `API-quickref.md` —— REST 速查
  - `README.md` —— 服务端需求规格说明
  - `nginx.conf`、`ws_server.py` —— 参考配置/参考实现
- 服务器代码**任何部门的开发者都可以通过 SSH 修改**（见第 10 节），但修改后必须留痕。

### 3.3 PWA 部门（即将新建）

- 职责：实现 PWA 端（`pwa/` 目录），复用服务器接口与桌面端可共享的前端代码；
- 目标平台：手机浏览器（iOS Safari / Android Chrome）+ 电脑浏览器；
- 详见 [第 11 节](#11-pwa-部门规划中)。

---

## 4. 项目理念与红线（必读）

> 这些不是"建议"，是**踩过坑换来的硬规矩**。违反了轻则返工，重则伤害线上用户。

### 4.1 用户至上：更新链路绝不允许让用户重装

**历史教训（最重的一条红线）**：v4.5.20 的签名验证 bug 导致自 v4.5.15 起的所有客户端自动更新从未验证通过，老用户只能手动卸载重装。用户原话：

> "这种需要删除重装的错误操作，对于用户的打击都是毁灭性的。"

由此确立的强制规则：

1. **任何改动更新链路**（版本解析/比较/下载/验签/P2P 种子）后，发版前必须用**真实发布物**（已发布版本的 exe + latest.json + pubkey）做一次完整端到端验证（模拟 检查 → 下载 → 验签 全链路，verify 必须通过）；
2. **禁止只依赖单测**——单测用生成式密钥，覆盖不到真实 tauri minisign 签名格式与真实公钥；
3. 未来任何"让用户升级失败"的设计都是不可接受的，宁可不发也不能让用户重装。

### 4.2 文档先行（强制）

- 每次完成代码改动或准备打包/发版前，**必须先同步更新相关文档，再 commit + push，然后才允许构建/打 tag**；
- **文档落后于代码时禁止发版**；
- 详见 [第 9 节标准工作流程](#9-标准工作流程) 的文档同步铁律。

### 4.3 别造轮子（用户 2026-08-04 强调）

- 技术选型先问"有没有现成的"：P2P 打洞/建连/传输全用现成方案（浏览器原生 RTCPeerConnection + werift 测试 + 服务器约 40 行信令转发胶水），客户端零新增依赖；
- 唯一手写的是必要的胶水（如 20 行 DataChannel 分片）；
- 发现"没有现成的库"时，先确认是不是自己没找对（历史上"rustp2p-core"其实不存在，真相是 libp2p）。

### 4.4 真实验证优先于伪造数据

- 发版前**红线核验**：用真实发布物验签（`temp-debug/verify_sig.py`），不许用伪造数据替代；
- 每轮改动后列**"待用户验证"清单**，由用户双机实测确认后才算闭环；
- 用户是最终验收者，功能范围由用户拍板（例如菜园子成长时机、音量是否同步等）。

### 4.5 版本策略（语义化，勿错）

- **beta 是预发布**：`v4.6.0-beta.0` **小于** `v4.6.0`，beta 用户应能正常升级到正式版；
- 从 beta 升正式版：先发 `vX.Y.Z-beta.N`，再发 `vX.Y.Z`（正式版）；
- GitHub Release 的 beta 必须勾选 **prerelease** 标记，避免 `releases/latest` 误指 beta；
- 当前正式版为 **v4.7.11**。

### 4.6 反馈闭环

- 每轮发版后必须给出"待用户验证"清单（明确让用户测什么）；
- 用户提出的 bug 要**挖到真根因**再修，禁止治标不治本（历史上多次"现象 A、根因 B"的案例）。

---

## 5. 技术现状：三个关键认知

> 新人最容易踩的坑：**被旧文档误导**。下面三条是必须建立的"正确世界观"。

### 5.1 音乐播放器是纯 Rust —— 没有 Python 子进程

- 播放器在 `src-tauri/src/modules/audio_player.rs`（rodio + cpal + symphonia）；
- **没有** music.py / music.exe、**没有** stdin/stdout 子进程通信、**没有** ffmpeg.exe；
- 事件由 Rust 层 `app.emit("music-xxx")` 直接发出；全局快捷键是 `tauri_plugin_global_shortcut` 媒体键；
- ⚠️ `docs/DEVELOPER_GUIDE.md` 等旧文档残留大量 Electron/Python 时代的描述，**仅作历史参考，以现状为准**。

### 5.2 自建服务器 + P2P 直连

- 云端已从 Supabase 迁移到**自建服务器**（JWT + REST + WebSocket + P2P 信令）；
- 服务器带宽只有约 3Mbps → **P2P 直连**：音乐传歌、安装包分享走浏览器原生 WebRTC 点对点，服务器只做 KB 级信令/目录服务，**媒体数据不经服务器**；
- 服务器打不通时自动降级：P2P → 服务器中转 → （安装包）GitHub 下载。

### 5.3 自实现更新器（不是 tauri-plugin-updater 默认路径）

- `tauri-plugin-updater` 的 endpoints 编译期固定，无法运行时切换源 → 检查/下载/安装**全部自实现**于 `commands/update.rs`；
- 特性：GitHub/服务器**双更新源**（可切换、失败自动回退）、**Ed25519 签名校验**（minisign 格式）、**断点续传 + 暂停/继续**、**本地安装包覆盖安装**、**P2P 种子优先下载**、服务器公告（notice.json）；
- 客户端更新走 `settings.updateSource`（默认 GitHub）+ `allowBetaUpdates` 开关。

---

## 6. 编码硬约束（Hard Constraints）

> 写代码前先过一遍。违反这些会引入诡异 bug 或破坏现有 UI。

### 6.1 UI 与样式

| 约束 | 说明 |
|------|------|
| **圆角统一 20px** | 所有 UI 组件保持一致的圆角，避免双边框透明问题；`.container` 需 `border-radius:20px` + `overflow:hidden` 裁剪内部元素 |
| **z-index 必须用 CSS 变量** | 层级体系定义在 `global.css` 的 `:root`：`--z-base(1)` / `--z-content(2)` / `--z-sidebar-btn(10)` / `--z-mode-slider(50)` / `--z-header-btn(100)` / `--z-overlay-ui(200)` / `--z-popup(1000)` / `--z-modal(3000)` / `--z-modal-upper(3100)` / `--z-modal-top(3200)`。**禁止 magic number** |
| **深色容器内文字用显式亮色** | 固定深色底容器（settings-panel / feedback-modal，`#1a1a1a`）内文字必须用显式亮色，**禁用 `var(--text-color)`**——它跟随主题，亮色主题下会变 `#333` 黑字黑底（用户 2026-08-07 强调，强制） |
| **Modal 风格统一** | `#1a1a1a` 背景 + 白字 + 统一滚动条；遮罩用 `.app-modal-overlay` |
| **不要给 .main-content 加 overflow:hidden / z-index:1** | 会物理裁剪弹窗 / 破坏层叠上下文（历史踩坑） |

### 6.2 Rust ↔ 前端对齐

- **Tauri 命令返回值序列化不做 camelCase 自动转换**（只有参数做）→ Rust 结构体字段名必须与前端 JS 读取名严格对齐；需要输出 camelCase 时显式加 `#[serde(rename_all = "camelCase")]`（历史教训：字段名不匹配导致整个面板渲染崩溃）；
- 类型对齐：Rust 用 `snake_case`、TS 用 `camelCase`，Tauri 自动做参数转换。

### 6.3 工程约定

- **临时调试脚本/HTML/一次性工具**统一放根目录 `temp-debug/`（已 gitignore，含密钥可放心放），不要散落在正式代码目录；Rust example 类调试文件需先拷回 `src-tauri/examples/` 再运行；
- 音乐下载/播放**必须是纯 Rust 实现**，禁止引入 Python（you-get.exe / manual_downloader.exe）或 ffmpeg.exe 依赖；
- Tauri 版本的功能、图标、导航栏、颜色、布局须与旧 Electron 版一致（迁移目标）。

---

## 7. 部门声明规则（必读）

> **规则：每次正式输出都必须报告自己属于哪个部门。没有特别声明的，默认属于主部门。**

"正式输出"包括但不限于：

| 场景 | 声明方式 | 示例 |
|------|---------|------|
| git commit | message 开头加 `[部门]` | `[主部门] feat: 新增自定义音效` |
| 文档/报告 | 标题下方注明部门与作者 | `> 部门：服务器部门 ｜ 维护：xxx` |
| PR / Issue | 标题或描述注明 | `[PWA部门] feat: PWA 安装提示` |
| AI 助手回复 | 每次输出开头声明 | `【部门：主部门】……` |
| 代码文件（大改动） | 文件头注释注明 | `// 部门：服务器部门 —— 2026-08-14 接口变更` |

**为什么要有这条规则：**
- 明确每份产出的责任边界，谁改的、谁负责、出了事找谁；
- 服务器部门的代码不在本仓库，若不声明部门，很容易被误认为主部门产出；
- 跨部门协作时（如接口变更），第一时间知道该通知谁。

---

## 8. 双仓库工作流

### 8.1 两个远程仓库

| 远程名 | 地址 | 用途 |
|--------|------|------|
| `origin` | `https://github.com/liaowenqi123/PomoSolo.git` | GitHub 主仓库：开发主阵地，触发 CI/CD、Release |
| `self` | `ubuntu@115.159.49.112:/home/ubuntu/PomoSolo.git` | 服务器上的镜像/备份仓库（**服务器访问 GitHub 缓慢，因此部署时从 self 拉取**） |

### 8.2 核心原则：双仓库必须保持统一

> **每次完成工作（commit）后，必须同时推送到 `origin` 和 `self` 两个仓库，保证两边一致。**

```bash
# 推送分支（以 main 为例）
git push origin main
git push self main

# 推送 tag
git push origin v4.7.11
git push self v4.7.11
```

**为什么必须推两个：**
- `self` 是服务器部署的代码来源，服务器从 `self` 拉取代码部署（GitHub 在服务器上太慢）；
- 只推 `origin` 会导致服务器部署到旧代码；只推 `self` 会导致 GitHub 上代码落后；
- 两个仓库任何一边落后，都会让"主部门改的代码"和"服务器上跑的代码"不一致。

### 8.3 新人配置双仓库

```bash
# 如果是从 GitHub clone 的
git clone https://github.com/liaowenqi123/PomoSolo.git
cd PomoSolo

# 添加 self 远程
git remote add self ubuntu@115.159.49.112:/home/ubuntu/PomoSolo.git

# 验证
git remote -v
# origin  https://github.com/liaowenqi123/PomoSolo.git
# self    ubuntu@115.159.49.112:/home/ubuntu/PomoSolo.git
```

> 推送到 `self` 走 SSH，需要已配置 SSH 密钥（与服务器部门/管理员确认）。
> 若暂时没有 `self` 访问权限，先推 `origin`，并在 commit 或 PR 里注明"self 待同步"。

### 8.4 ⚠️ 双仓库注意事项（历史踩坑）

- **`self` 裸仓可能被服务器部门直接提交**，导致 `self` 领先于 `origin`；此时**不要 force push main**，正确解法是 `git merge origin/main --no-edit` 产生 merge commit 再 push；
- 推送被网络阻断时（历史发生过），可以先推 `self`，网络恢复后补推 `origin`。

---

## 9. 标准工作流程

适用于**主部门**与 **PWA 部门**（以及任何在仓库内改代码的部门）：

```
认领任务 → 建分支 → 开发 → 本地测试 → 更新相关文档 → commit（带部门声明）→ push origin + self → 合并/PR → 发版（可选）
```

### 9.1 详细步骤

1. **认领任务**：明确任务归属部门；不明确则默认主部门。
2. **建分支**：功能/修复使用独立分支（如 `feature/xxx`、`fix/xxx`），稳定后再合并回 `main`。
3. **开发**：遵循现有代码规范（见 [docs/DEVELOPER_GUIDE.md](./docs/DEVELOPER_GUIDE.md) 与第 6 节硬约束）。
4. **本地测试**：
   ```bash
   npm test          # 前端单测（Vitest）
   cd src-tauri && cargo test   # Rust 测试
   npm run tauri:dev # 手动验证
   ```
5. **更新相关文档（铁律，见 9.2）**。
6. **commit**：message 带部门声明 + 类型前缀（见第 15 节）。
7. **推送双仓库**：
   ```bash
   git push origin <分支>
   git push self <分支>
   ```
8. **合并/发版**：合入 `main` 后再次推送双仓库；发版走第 16 节流程。

### 9.2 文档同步铁律（强制）

> **规则：每次完成代码改动或准备打包/发版前，必须先同步更新相关文档，再 commit + push。文档落后于代码时禁止发版。**

| 改了什么 | 必须同步更新 |
|---------|-------------|
| 接口/协议变化（REST / WebSocket / P2P） | `server-planning/API-implementation.md` + `server-planning/EXTERNAL-INTERFACES.md` |
| 模块架构 / 流程变化 | `docs/` 下对应架构文档（如 `STUDY_ROOM_ARCHITECTURE.md`） |
| 功能行为变化 | `README.md` 功能列表、`docs/FEATURES.md` |
| Bug 修复 | `docs/BUGFIX_RECORDS.md` |
| 安全相关 | `docs/SECURITY.md` |
| 菜园子玩法 | `docs/modules/garden-game-design.md`、`docs/modules/garden.md` |

> 文档地图见[第 12 节](#12-文档地图)。

---

## 10. 服务器部门的特殊工作流

### 10.1 服务器代码在哪儿

- 服务器的**运行代码不放在本仓库**，维护在服务器（`115.159.49.112`）上；
- 本仓库的 `server-planning/` 目录只承载**接口约定、规划、参考配置**（nginx.conf、ws_server.py 等）。

### 10.2 如何修改服务器代码（SSH）

**任何部门的开发者都可以通过 SSH 修改服务器代码**：

```bash
# 方式一：直接 SSH 到服务器操作
ssh ubuntu@115.159.49.112
cd <服务器部署目录>
# ... 修改 / 重启服务 ...

# 方式二：通过 self 仓库（推荐，可留痕）
# 本地 clone self 仓库 → 修改 → push 回 self → 服务器上 pull
git clone ubuntu@115.159.49.112:/home/ubuntu/PomoSolo.git
```

**服务器代码（ws_server.py 等）标准修改流程（强制）：**

```
备份原文件（.bak_<版本>） → 修改 → 语法校验（python3 -B -c "ast.parse(...)"） → sudo docker restart frontend-web → 端到端验证 → 在 server-planning 留言区记录并推送
```

> 数据库操作：`sudo docker exec pg-elephant psql -U postgres -d appdb`（删除类操作先备份）。
> 注意：直接 SSH 修改**不留痕**，强烈建议配合第 10.3 节的留痕义务。

### 10.3 跨部门改动留痕义务（强制）

> **规则：服务器部门（或任何在服务器上工作的人）一旦修改了其他部门（主部门 / PWA 部门）相关的代码、接口或约定，必须"二选一"留下记录：**
>
> 1. **写文档**：在 `server-planning/API-implementation.md` 留言区或对应文档中详细描述改动（接口字段、时序、影响面）；**或**
> 2. **commit + push**：在服务器部署目录（或 self 仓库）做合适的 commit + push，用 commit message 描述自己的工作（同样带部门声明）。

**典型场景：**
- 改了 REST API 的字段/路径 → 客户端（主部门）必须适配 → 必须更新 `EXTERNAL-INTERFACES.md` + 留言；
- 改了 WebSocket 消息格式 → 自习室/同步听歌/P2P 信令受影响 → 同上；
- 改了 `/update/*` 静态资源（latest.json、安装包、notice.json）→ 影响自动更新 → 记录更新说明。

**为什么：** 服务器部门代码不进入本仓库，主部门/PWA 部门**看不到服务器的 git 历史**。
如果不留痕，客户端开发者根本无法知道接口变了，线上就会静默故障。留痕是服务器部门对外沟通的唯一通道。

### 10.4 接口变更的同步义务（简化版）

| 变更类型 | 必须做的事 |
|---------|-----------|
| 新增/修改/删除 REST 端点 | 更新 `EXTERNAL-INTERFACES.md` + `API-implementation.md` |
| WebSocket 消息变化 | 更新 `EXTERNAL-INTERFACES.md` |
| 认证/Token 规则变化 | 更新 `SECURITY.md` + `EXTERNAL-INTERFACES.md` |
| 部署/端口/域名变化 | 更新 `server-planning/README.md` |
| 任何影响客户端的改动 | commit + push（到 self 或本仓库），message 描述清楚 |

### 10.5 服务器协作带话（强制）

写完 `server-planning/API-implementation.md` 留言区后，**必须顺手给用户/相关人一句可直接转发给服务器部门的话**（如"服务器部门，请看一眼 API-implementation.md 留言区的【加急】xx 需求，客户端已实现待你们配合"），督促他们去看留言，不要只写文档不说一声。

---

## 11. PWA 部门（规划中）

> **状态：🚧 部门即将新建，本节为规划草案，正式开工后由 PWA 部门细化。**

### 11.1 目标

- 做一个 PWA（Progressive Web App），**同时兼容手机和电脑浏览器访问**；
- 代码位置：**本仓库 `pwa/` 目录**（与桌面端同一仓库，共享双仓库工作流）；
- 复用现有服务器接口（`server-planning/EXTERNAL-INTERFACES.md`），与桌面端共用账号体系。

### 11.2 建议技术栈（可讨论）

| 项 | 建议 | 理由 |
|----|------|------|
| 框架 | Vite + Vue 3 + TypeScript + Pinia | 与桌面端前端完全同栈，可共享组件与 stores |
| PWA | `vite-plugin-pwa`（Workbox） | manifest + Service Worker + 离线缓存，开箱即用 |
| UI | 移动端优先响应式布局 | 手机 + 桌面浏览器自适应 |
| 部署 | 服务器 Nginx 托管静态文件 | 与 `/update/*` 静态托管同服务器，域名/备案复用 |
| 网络 | HTTPS（必须） | Service Worker 要求 HTTPS，需等备案 + SSL 证书（见 `server-planning/README.md`） |
| 后端 | 复用现有 REST API + WebSocket | 不做新后端，与桌面端一致走 `server-planning/` 接口 |

### 11.3 边界与注意事项

- PWA 与桌面端**共享**：服务器接口文档、账号体系、UI 设计语言；
- PWA 与桌面端**不共享**：桌面端 Rust 能力（前台检测、本地播放、文件系统）——PWA 只能做浏览器内能做到的事；
- 新增 PWA 专属接口时，走标准流程：更新 `server-planning/` 文档 → 服务器部门同步 → commit + push 双仓库；
- 目录规划（待 PWA 部门确认后落实）：
  ```
  pwa/
  ├── index.html          # PWA 入口
  ├── src/                # PWA 前端源码（Vue 组件可复用桌面端 src/）
  ├── public/             # manifest.webmanifest、图标、service-worker 相关
  ├── vite.config.ts      # 含 vite-plugin-pwa 配置
  └── README.md           # PWA 部门自己的开发说明
  ```

---

## 12. 文档地图

### 12.1 必读（新人第一天）

| 文档 | 说明 |
|------|------|
| **本文件 `TEAM_GUIDE.md`** | 部门分工 + 工作流程 + 双仓库规则 + 项目理念与红线 |
| `README.md` | 项目总览、技术栈、快速开始、项目结构（**以它为准**） |
| `docs/ARCHITECTURE.md` | 整体架构详解 |
| `server-planning/EXTERNAL-INTERFACES.md` | 对外接口唯一权威索引（REST / WS / P2P / 更新源） |

### 12.2 开发与维护

| 文档 | 说明 |
|------|------|
| `docs/DEVELOPER_GUIDE.md` | 开发指南。⚠️ **内含旧版 Electron + Supabase 的历史内容，仅作参考**；当前以 README 为准 |
| `docs/SECURITY.md` | 安全设计（加密、认证、Token） |
| `docs/BUGFIX_RECORDS.md` | Bug 修复记录（修 Bug 必须追加） |
| `docs/FEATURES.md` | 功能清单 |
| `docs/TAURI_MIGRATION_PITFALLS.md` | Tauri 迁移踩坑记录 |
| `docs/MIGRATION.md` | 迁移指南 |
| `docs/modules/` | 模块级文档（music-player、garden、garden-game-design 等） |
| `docs/AUTO_UPDATE_DESIGN.md` | 自动更新设计（自实现更新器） |

### 12.3 服务器部门（server-planning/）

| 文档 | 说明 |
|------|------|
| `server-planning/EXTERNAL-INTERFACES.md` | **对外接口唯一权威索引**（REST / WS / P2P / 更新源） |
| `server-planning/API-implementation.md` | 接口详细实现 + 迭代记录（含留言区） |
| `server-planning/API-quickref.md` | REST 速查 |
| `server-planning/README.md` | 服务端需求规格（端口、数据库、Nginx 路由） |
| `server-planning/nginx.conf` / `ws_server.py` | 参考配置 / 参考实现 |

### 12.4 文档维护铁律

- **接口相关改动** → 优先改 `server-planning/` 文档（与其他部门沟通的唯一权威通道）；
- **架构/流程改动** → 改 `docs/` 对应文档；
- **每次 commit 应包含其配套文档改动**（见 9.2），禁止"只改代码不更文档"。

---

## 13. 环境搭建与快速上手

### 13.1 环境要求

| 工具 | 版本 | 用途 |
|------|------|------|
| Node.js | ≥ 20 | 前端构建 |
| Rust | ≥ 1.77 | 后端编译 |
| Tauri CLI | v2 | 随 `package.json` 安装 |

Windows 10/11 自带 WebView2，无需额外运行环境。

### 13.2 三步跑起来

```bash
# 1. 安装依赖
npm install

# 2. 开发模式（自动打开 DevTools）
npm run tauri:dev

# 3. 跑测试
npm test                     # 前端 Vitest
cd src-tauri && cargo test   # Rust 测试
```

### 13.3 构建

```bash
npm run tauri:build          # 完整构建（复制音乐资源 → vue-tsc 类型检查 → vite build → tauri build）
# 产物：src-tauri/target/release/bundle/nsis/*.exe（含签名 .sig）
```

> 完整构建需要本地自建 runner 相关环境（构建细节见 `docs/DEVELOPER_GUIDE.md` 发布流程约定一节，涉及 `D:\pomosolo-cache` 与 `d:\actions-runner`）。
> ⚠️ 本地 cargo test 需在 `src-tauri\target`（工作目录内）跑——`D:\pomosolo-cache\target` 是 CI/构建专用，勿混用。

---

## 14. 常用命令速查

| 命令 | 说明 |
|------|------|
| `npm run tauri:dev` | 开发模式 |
| `npm run tauri:build` | 生产构建（NSIS 安装包） |
| `npm test` / `npm run test:watch` | 前端测试（单次 / 监听） |
| `npm run test:coverage` | 前端测试 + 覆盖率 |
| `cd src-tauri && cargo test` | Rust 测试 |
| `git push origin main && git push self main` | 推送双仓库 |
| `git tag -a v4.x.x -m "..." && git push origin v4.x.x && git push self v4.x.x` | 发版打 tag |
| `fuck-u-code analyze <dir> -f markdown -o <file> -l zh -t 20` | 发版前代码质量核验 |

---

## 15. 提交规范

### 15.1 格式

```
[部门] 类型: 描述
```

- **部门**：`主部门` / `服务器部门` / `PWA部门`（未声明默认主部门，但建议显式写出）；
- **类型前缀**（沿用现有约定）：`feat:` / `fix:` / `docs:` / `refactor:` / `style:` / `chore:` / `perf:`;
- 描述用中文，简洁说明做了什么。

### 15.2 示例

```bash
[主部门] feat: 自习室支持同步听歌
[主部门] fix: 修复计时器暂停后时间重置的问题
[服务器部门] docs: 更新 API-implementation.md 同步听歌接口
[PWA部门] feat: 完成 PWA manifest 与离线缓存配置
```

### 15.3 其他

- 不要把 `src-tauri/target/`、`node_modules/`、`temp-debug/` 加入版本控制（`.gitignore` 已覆盖）；
- 临时调试文件一律放 `temp-debug/`（已 gitignore，含密钥/本地路径可放心放）；
- commit 粒度：一次提交一件事，配套文档随代码一起提交。

---

## 16. 发布流程

> 发版顺序（强制）：**改代码 → 更新文档 → commit（含文档）→ push 双仓库 → 打 tag → push tag → CI 自动构建/发布**

### 16.1 发版前检查清单

1. **fuck-u-code 代码质量核验**（用户 2026-08-02 定，强制）：
   ```bash
   fuck-u-code analyze <dir> -f markdown -o <file> -l zh -t 20
   ```
   修复可低风险重构的冗长代码；核心逻辑高分文件（music.ts / garden.rs / downloader.rs / update.rs）发版前不宜大动；报告放 `.fuckucode-report/` 文件夹，**分析完即删**。
2. **版本号 6 处同步更新**（历史教训：曾漏改 README badge 停在旧版）：
   - `package.json`
   - `package-lock.json`（顶部两处）
   - `src-tauri/Cargo.toml`
   - `src-tauri/Cargo.lock`
   - `src-tauri/tauri.conf.json`
   - `README.md` 顶部 Release badge
3. **红线核验**：任何改动更新链路后，用**真实发布物**（exe + latest.json + pubkey）做端到端验签（`temp-debug/verify_sig.py`，minisign 格式：RWT 行解码 42B = "Ed"+key_id8+公钥32，公钥在 [10..42]；RUT 行解码 74B = "ED"+key_id8+签名64；"ED" 大写 = 预哈希模式 = Ed25519(blake2b-512(文件))）。**禁止只依赖单测**。

### 16.2 标准发版命令

```bash
# 1. 更新版本号（16.1 清单第 2 项，6 处一致）
# 2. 确认文档已同步（见 9.2）
# 3. commit（含文档改动）
git add -A && git commit -m "[主部门] chore: v4.8.0 发布准备"

# 4. 推送双仓库
git push origin main
git push self main

# 5. 打 tag 并推送双仓库（⚠️ 版本号补丁 commit 后若 tag 已存在，需 git tag -f 移动并 force push tag）
git tag -a v4.8.0 -m "release notes"
git push origin v4.8.0
git push self v4.8.0

# 6. CI 自动完成构建 + Release（.github/workflows/ci.yml）
```

### 16.3 CI 与自建 runner 要点（务必知晓）

- `test`（Test & Coverage）与 `release` job 在 GitHub 托管 runner 执行；
- `build`（NSIS 打包）job 由**本地自建 runner** 执行（`d:\actions-runner`，label `self-hosted, windows, x64`）——**使用前必须确保 runner 在运行**（`D:\actions-runner\run.cmd`），否则 build job 排队直至超时；
- `CARGO_TARGET_DIR` 指向 `D:\pomosolo-cache\target`，安装包生成在 `D:\pomosolo-cache\target\release\bundle\nsis\`；
- Release job 的 `latest.json` 必须**按版本号精确匹配**安装包/签名文件，禁止按字典序取第一个（历史教训：残留旧版本会把自动更新指到旧包）；
- CI 构建产物与本地构建 hash 可能不一致（工具链/codegen 差异属正常）；红线核验用**真实签名验证**（私钥仅我们持有，签名 OK 即证明产物合法）。

### 16.4 服务器部署（发版后必须做）

```bash
# 1. 上传安装包 + 服务器版 latest.json（url 指向 http://115.159.49.112/updates/、signature 复用 GitHub 同一签名、UTF-8 无 BOM）
scp PomoSolo_<版本>_x64-setup.exe ubuntu@115.159.49.112:/home/ubuntu/frontend/updates/
# latest.json 用 python json.dumps 生成（UTF-8 无 BOM）

# 2. latest-beta.json 同步（cp latest.json latest-beta.json）

# 3. 若 ws_server.py 有改动：备份 .bak_<版本> → scp 新版 → 语法校验 → sudo docker restart frontend-web
#    （python3 -B -c "ast.parse(...)" 校验，避免 __pycache__ 权限问题）

# 4. 公网验证：latest.json 200 + 版本号正确、exe HEAD 200 + 长度一致、WS /ws 101
```

### 16.5 ⚠️ 本机网络备忘（踩坑记录）

- **DNS 被劫持**：本机 steamcommunity302 加速 GitHub，会把 GitHub 域名写进 hosts → 127.0.0.1，且其 caddy.json **没有 uploads.github.com 规则** → 上传会被静默吞掉（伪造 200）。解法：**不要手动改 hosts 抢管理权**，让 steamcommunity302 重新"启动服务"即可恢复直连；
- 上传 GitHub asset 卡住时：`curl.exe --resolve uploads.github.com:443:<真实IP>` 绕过本地 DNS 劫持（真实 IP 用 `nslookup <域名> 8.8.8.8` 获取）；
- `gh release create` **不能带 assets 参数**（会 EOF），先建 release 再分开上传 asset；
- 下载 GitHub 大文件（exe）卡死时，用 `Invoke-WebRequest`（约 2-3 分钟）替代 curl/gh release download。

> 完整细节见 `docs/DEVELOPER_GUIDE.md`「发布流程约定（强制）」一节。

---

## 17. 新人上岗 Checklist

拿到本项目的第一个小时内，按顺序完成：

- [ ] 读完本文件（TEAM_GUIDE.md），**重点读第 4 节理念与红线、第 5 节技术现状、第 6 节硬约束**
- [ ] 通读 `README.md`，跑起项目（第 13 节三步）
- [ ] 确认自己的**部门归属**（未声明 = 主部门）
- [ ] 确认本地双仓库配置：`git remote -v` 能看到 `origin` + `self`
- [ ] 看一遍 `server-planning/EXTERNAL-INTERFACES.md`，知道客户端与服务器的接口长什么样
- [ ] 浏览 `docs/` 下与手头任务相关的架构文档
- [ ] 认领第一个任务，按第 9 节流程开工

**每天开工前默念三件事：**

1. 我的部门是哪个？（输出必声明，默认主部门）
2. 文档同步了吗？（改代码必更文档）
3. 两个仓库都推了吗？（push 必推 origin + self）

---

*本文档由主部门维护。任何部门分工、流程变化，请同步更新本文档并 commit + push 双仓库。*
