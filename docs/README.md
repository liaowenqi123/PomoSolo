# `docs/` —— 项目文档索引

> **范围**：本目录只放跨模块的架构、模块、安全、排错与历史文档。
> 各代码目录的细节在各自 README：`../src/README.md`、`../src-tauri/README.md`、
> `../src/pwa/README.md`、`../server-planning/README.md`、`../scripts/README.md`。

## 1. 先看哪篇

| 你想了解 | 文档 |
|---|---|
| 当前整体结构、版本、模块清单 | [`PROJECT_MAP.md`](./PROJECT_MAP.md)（**自动生成，不要手改**） |
| 跨端架构：进程、IPC、数据流 | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| 功能清单 | [`FEATURES.md`](./FEATURES.md) |
| 模块级实现 | [`modules/`](./modules/) |
| 安全、加密、认证 | [`SECURITY.md`](./SECURITY.md) |
| 自习室 / 菜园子数据 | [`STUDY_ROOM_ARCHITECTURE.md`](./STUDY_ROOM_ARCHITECTURE.md)、[`GARDEN_DATA_ARCHITECTURE.md`](./GARDEN_DATA_ARCHITECTURE.md) |
| 自动更新器设计 | [`AUTO_UPDATE_DESIGN.md`](./AUTO_UPDATE_DESIGN.md) |
| 单点登录（历史设计） | [`SINGLE_LOGIN_DESIGN.md`](./SINGLE_LOGIN_DESIGN.md) |
| Tauri 迁移踩坑 | [`TAURI_MIGRATION_PITFALLS.md`](./TAURI_MIGRATION_PITFALLS.md) |
| Bug 修复记录 | [`BUGFIX_RECORDS.md`](./BUGFIX_RECORDS.md) |

## 2. 文档状态

新文档请在标题下写一行状态，三选一：

- `> 状态：当前` —— 描述当前代码；改动代码时同步改它。
- `> 状态：草案` —— 尚未落地；不要当成现状引用。
- `> 状态：历史` —— 冻结的历史资料；只作背景，不要照着改代码。

### 当前文档

`ARCHITECTURE.md`、`FEATURES.md`、`SECURITY.md`、`STUDY_ROOM_ARCHITECTURE.md`、
`GARDEN_DATA_ARCHITECTURE.md`、`AUTO_UPDATE_DESIGN.md`、
`TAURI_MIGRATION_PITFALLS.md`、`modules/`、`study-room-sql/`。

### 历史文档（已加横幅，不要照着改）

| 文档 | 说明 |
|---|---|
| [`DEVELOPER_GUIDE.md`](./DEVELOPER_GUIDE.md) | Electron + Supabase 时代；目录结构/模块/构建均可能不符 |
| [`MODAL_SYSTEM.md`](./MODAL_SYSTEM.md) | 旧 Electron 弹窗系统；当前 Vue 弹窗见 `modules/modal-system.md` |
| [`SUBPROCESS_ORPHAN_ISSUE.md`](./SUBPROCESS_ORPHAN_ISSUE.md) | 旧 Electron + Python 子进程残留；当前纯 Rust，无 Python 子进程 |
| [`MIGRATION.md`](./MIGRATION.md) | Electron → Tauri 迁移对照；只作迁移参考 |
| [`SINGLE_LOGIN_DESIGN.md`](./SINGLE_LOGIN_DESIGN.md) | Electron + Supabase 时代的单点登录设计；已被自建服务器方案取代 |

### 自动生成

| 文件 | 生成方式 |
|---|---|
| [`PROJECT_MAP.md`](./PROJECT_MAP.md) | `npm run docs:map` |
| `PROJECT_MAP.md` 的一致性检查 | `npm run docs:check`（CI 也会跑） |

## 3. 维护规则

- **不要在一个文档里讲“整个项目”**：整体结构由 `PROJECT_MAP.md` 生成；
  跨端关系写 `ARCHITECTURE.md`；单目录细节写该目录 README。
- **不要手写当前版本号、测试数量、模块数量**：这些变化快，统一由
  `npm run docs:map` 输出；根 README / AGENTS 由 `npm run docs:check` 拦截。
- 改接口 → 同步 [`../server-planning/EXTERNAL-INTERFACES.md`](../server-planning/EXTERNAL-INTERFACES.md)
  与 [`../server-planning/API-implementation.md`](../server-planning/API-implementation.md)。
- 修 Bug → 追加 [`BUGFIX_RECORDS.md`](./BUGFIX_RECORDS.md)。
- 文档落后于代码时，不允许发版（见 [`../TEAM_GUIDE.md`](../TEAM_GUIDE.md) §4.2）。
