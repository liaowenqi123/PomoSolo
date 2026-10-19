# AGENTS.md —— PomoSolo agent 入口

> **范围**：本仓库（桌面端 + PWA + 服务器接口文档）。
> 服务器**运行代码**、安卓端代码都**不在**本仓库。
>
> 本文件只做**导航 + 仓库级约束**。某个目录怎么改，读该目录的 README；
> 整体结构、版本号、模块数量由 `npm run docs:map` 生成到
> [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md)，**不要在这里手写**。

---

## 0. 30 秒速览

| 端 | 代码位置 | 在本仓库？ | 技术形态 |
|---|---|---|---|
| 🖥 **桌面端**（Windows） | `src/` + `src-tauri/` | ✅ | Tauri v2 + Vue 3 + 纯 Rust |
| 📱 **PWA 端** | `src/pwa/`（复用 `src/`） | ✅ | Vite + Vue 3 + `vite-plugin-pwa` |
| ☁️ **服务器端** | 服务器上维护；本仓库只有 `server-planning/` 文档 | ❌ | Python 标准库 + PostgreSQL（详见 `server-planning/README.md`） |
| 🤖 **安卓端** | 独立仓库 [PomoSolo-Android](https://github.com/liaowenqi123/PomoSolo-Android) | ❌ | Kotlin + Jetpack Compose 原生 |
| 💬 **Agent 留言板** | <https://board.pomogrow.top>；CLI 在 `scripts/board/` | CLI ✅ / 服务端 ❌ | Python + PostgreSQL |

**第一次进来按这个顺序读**：

1. 本文件（边界 + 工作流）；
2. 你将要改的目录的 README（见 §2）；
3. [`docs/README.md`](docs/README.md)（文档状态：当前 / 草案 / 历史）；
4. 需要整体视图时看 [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md)（自动生成）。

---

## 1. ★ 什么能上 GitHub、什么不能

**判断口诀**：*换一台机器就不一样*或*泄漏会造成损失* → 不入库。

### ✅ 可以入库

| 位置 | 内容 |
|---|---|
| `src/` `src-tauri/src/` | 桌面端前后端源码 |
| `src/pwa/` | PWA 专属层（复用 `src/`） |
| `tools/ui/` | UI 取证工具（截图 + 布局审计） |
| `scripts/` | 构建、迁移、P2P 联调、留言板、文档检查、服务器证书脚本 |
| `docs/` | 架构、模块、安全、排错与历史文档 |
| `server-planning/` | **服务器接口的权威文档**（REST/WS/P2P/更新源） |
| `music-player/music/` | 仓库跟踪的内置曲 + `tags.json`（白名单见 `.gitignore`） |
| `deprecated/` | 冻结的历史存档（含成品 exe，有意保留） |
| `.github/workflows/ci.yml` | CI 配置 |
| `.local/README.md` | 本地私密区契约（唯一入库的 `.local` 文件） |

### ❌ 不入库

| 位置 | 内容 | 为什么 |
|---|---|---|
| **`.local/`**（除 `README.md`） | 本机工具链路径、SSH 细节、测试账号、密钥**位置引用**、发版踩坑 | 机器/服务器专属，泄漏有风险 |
| `temp-debug/` | 一次性调试脚本、临时产物、`ui-shots/` | 用完即弃 |
| `node_modules/` `dist/` `pwa-dist/` `coverage/` | 依赖与构建输出 | 可重建 |
| `src-tauri/target/` `src-tauri/resources/` | Rust 编译产物 / 构建时复制的资源 | 可重建 |
| `deprecated/**/build/` `deprecated/**/__pycache__/` | PyInstaller 构建中间产物 | 纯噪声 |
| `deprecated/old-builds/` | 旧安装包 | 体积大 |

### 🔴 密钥一律留在仓库外

| 敏感物 | 位置（**仓库外**） |
|---|---|
| Tauri 更新签名私钥（最敏感：可伪造更新包） | `C:\Users\admin\.tauri\pomosolo.key` |
| 服务器 SSH 私钥 | `C:\Users\admin\.ssh\id_rsa`（`ssh ubuntu-tencent`） |
| GitHub SSH 私钥 | `C:\Users\admin\.ssh\id_ed25519` |
| CI Secrets | GitHub 仓库设置（`TAURI_SIGNING_PRIVATE_KEY` / `SERVER_*`） |

> `.local/SECRETS.md` 只记录「密钥在哪、怎么用」，**绝不记录「密钥是什么」**。
> 提交前自查：`git status --short | Select-String '\.local/'` 应只出现 `README.md`。

---

## 2. 目录与入口（按范围拆开）

| 目录 | 范围 | 先读 |
|---|---|---|
| `src/` | 桌面端前端：组件、store、Tauri invoke 封装、UI 约束 | [`src/README.md`](src/README.md) |
| `src-tauri/` | 桌面端后端：commands、Rust modules、构建产物 | [`src-tauri/README.md`](src-tauri/README.md) |
| `src/pwa/` | PWA 专属层：alias 复用、浏览器 shim、已知限制 | [`src/pwa/README.md`](src/pwa/README.md) |
| `server-planning/` | 服务器接口文档（代码不在本仓库） | [`server-planning/README.md`](server-planning/README.md) |
| `tools/ui/` | UI 截图、布局审计、真实窗口驱动 | [`tools/ui/README.md`](tools/ui/README.md) |
| `scripts/` | 构建 / P2P 联调 / 留言板 / docs / release / 服务器证书脚本 | [`scripts/README.md`](scripts/README.md) |
| `docs/` | 跨模块架构、模块文档、安全、历史 | [`docs/README.md`](docs/README.md) |
| `music-player/` | 内置音乐资源与 `tags.json` 迁移坑 | [`music-player/README.md`](music-player/README.md) |
| `.local/` | 本机/服务器私密区（加速层，不是真相层） | [`.local/README.md`](.local/README.md) |
| `deprecated/` | 冻结历史，不改不删 | [`deprecated/README.md`](deprecated/README.md) |

> **根 README 只做入口**。不要把子目录的结构、版本、测试数、模块清单加回根 README；
> 这些内容会随迭代过期，统一由 `npm run docs:map` 生成。

---

## 3. 仓库级硬规则

### 双仓库推送（强制）

| 远程 | 地址 | 作用 |
|---|---|---|
| `origin` | `https://github.com/liaowenqi123/PomoSolo.git` | GitHub 主仓库，触发 CI/CD 与 Release |
| `self` | `ubuntu@115.159.49.112:/home/ubuntu/PomoSolo.git` | 服务器裸仓，部署代码来源 |

```bash
git push origin main && git push self main
```

- 服务器访问 GitHub 慢，部署从 `self` 拉；**只推一边会造成线上与仓库不一致**。
- `self` 可能被服务器部门直接提交而领先 → **严禁 force push main**；
  正确做法：`git merge origin/main --no-edit` 产生 merge commit 再 push。
- 不要攒多个 commit 一起推，更不要只 commit 不 push 过夜。

### 部门声明（强制）

格式 `[部门] 类型: 描述`：

| 部门 | 代号 | 默认？ |
|---|---|---|
| 主部门 | `主部门` | ✅ 默认（未声明即主部门） |
| 服务器部门 | `服务器部门` | |
| PWA 部门 | `PWA部门` | |
| 安卓端部门 | `安卓端部门` | |

类型前缀：`feat:` / `fix:` / `docs:` / `refactor:` / `style:` / `chore:` / `perf:`；描述用中文。

### 文档与版本（防漂移）

- **改代码必须同步改文档**；文档落后于代码时禁止发版。
- **手写文档不写当前版本号、测试数量、目录树、模块清单**：
  - 整体结构/版本：`npm run docs:map` → [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md)；
  - 一致性检查：`npm run docs:check`；
  - 版本号六处一致：`npm run versions:check`。
- 根 README / 本文件由 `docs:check` 拦截“手写版本/数量”。
- 历史文档必须有 `> 状态：历史` 横幅；状态表见 [`docs/README.md`](docs/README.md)。

### 目录与临时文件

- 临时文件放 `temp-debug/`；本机长期配置放 `.local/`；不要散落在正式代码目录。
- `.local/` 是**加速层**：缺了它项目照样能跑，只是要重新查环境；
  真相永远在入库文件里。
- 不要为了“统一”去改 `deprecated/` 下的代码。

### 跨部门接口

- 接口/协议（REST/WS/P2P/更新源）的唯一权威索引是
  [`server-planning/EXTERNAL-INTERFACES.md`](server-planning/EXTERNAL-INTERFACES.md)；
- 改接口 → 同步 `EXTERNAL-INTERFACES.md` + `API-implementation.md`，
  并在留言板留痕；
- 服务器代码改动必须留痕（文档或 `self` 仓 commit），否则客户端看不到变更。

### 各目录的红线（动手前读对应 README）

- **UI**：圆角、z-index 变量、深色容器亮色文字、Modal 风格、
  `pointerdown` 关闭语义、`.main-content` 裁剪坑 → [`src/README.md`](src/README.md)；
- **Rust**：纯 Rust 音频/下载/前台检测，禁止 Python/ffmpeg；
  返回值 serde 字段严格对齐 → [`src-tauri/README.md`](src-tauri/README.md)；
- **PWA**：真实复用、不 copy；浏览器 shim 是唯一传输层替换点 →
  [`src/pwa/README.md`](src/pwa/README.md)；
- **服务器接口**：线上实现与历史草案的边界 →
  [`server-planning/README.md`](server-planning/README.md)。

---

## 4. 工作流

```
看板/留言板 → 读对应目录 README → 建分支 → 开发
  → 本地测试 → UI 截图核对 → 更新文档 → docs:check
  → commit（带部门声明）→ push origin + self → 留言板留结论
```

1. **开工前**：`npm run board:digest`，看有没有人已经答了 / 有没有坑；
2. **改 UI 前**：先 `npm run ui:shot -- --target desktop`（或对应配方），
   问题会直接打在终端；用法见 [`tools/ui/README.md`](tools/ui/README.md)；
3. **改代码后**：跑对应测试（前端 `npm test`，后端 `cd src-tauri && cargo test --lib`）；
4. **提交前**：`npm run docs:check`；改了结构/版本先 `npm run docs:map`；
5. **提交**：`[主部门] fix: ...`，配套文档同 commit；
6. **推送**：`git push origin main && git push self main`；
7. **收工**：把新结论/新坑/待办写回留言板（`npm run board -- post/comment/status`）。

> 克隆后先装钩子（`tags.json` 防误提交 + 留言板提示）：
> `git config core.hooksPath scripts/git-hooks`。
> 钩子永不阻断 git；临时关闭用 `BOARD_HOOKS=0`。

---

## 5. 常用命令（只列根级）

```bash
npm install
npm run tauri:dev                  # 桌面端开发（含 Rust）
npm run dev                        # 仅前端 Vite
npm test                           # 前端 Vitest
npm run tauri:build                # 构建安装包
npm run docs:map                   # 生成整体结构总览
npm run docs:check                 # 文档/版本/README 一致性
npm run versions:check             # 六个版本值一致性
npm run board:digest               # 留言板待办速览
npm run ui:shot -- --target desktop
```

前端/后端/PWA/UI 的完整命令见各自 README；不要在本文件复制。

---

## 6. 版本与“整体内容”的单一来源

| 内容 | 唯一来源 |
|---|---|
| 桌面端版本 | `package.json` + `src-tauri/Cargo.toml` + `src-tauri/tauri.conf.json` + 两个 lock；`npm run versions:check` |
| PWA 版本 | `src/pwa/config.ts` 的 `PWA_VERSION`（独立，只在发布 PWA 时改） |
| 目录结构 / 模块清单 / 代码规模 | `npm run docs:map` → [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md) |
| 对外接口 | [`server-planning/EXTERNAL-INTERFACES.md`](server-planning/EXTERNAL-INTERFACES.md) |
| 当前任务 / 跨 Agent 讨论 | <https://board.pomogrow.top> |

> 发布 badge 用 GitHub 动态版本，不再在 README 写死版本号。

---

## 7. 历史文档

[`docs/README.md`](docs/README.md) 有完整的“当前 / 草案 / 历史”状态表。
典型历史文档：`DEVELOPER_GUIDE.md`（Electron + Supabase）、`MODAL_SYSTEM.md`
（旧 Electron 弹窗）、`SUBPROCESS_ORPHAN_ISSUE.md`（旧 Python 子进程）。
它们只作背景，**不要照着改代码**。

---

*本文件由主部门维护。仓库结构、协作边界、入库规则变化时，请同步更新并 commit + push 双仓库。*
