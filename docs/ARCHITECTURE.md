# PomoSolo 架构（当前）

> **状态：当前**
> **范围**：跨端架构——进程形态、前后端分层、IPC、数据流、PWA 复用、服务器集成。
> 单目录细节见 [`../src/README.md`](../src/README.md)、[`../src-tauri/README.md`](../src-tauri/README.md)、
> [`../src/pwa/README.md`](../src/pwa/README.md)。
> 版本号、目录树、模块数量不在这里手写，见自动生成的
> [`PROJECT_MAP.md`](./PROJECT_MAP.md)。

---

## 1. 运行时形态

```
PomoSolo.exe（Tauri 主进程）
  ├─ Rust 后端（commands / modules）
  └─ WebView2（Vue 3 前端）
```

- **单应用进程 + 系统 WebView2**，没有 Electron 的 Chromium/Node 子进程。
- **没有 Python 子进程**：音乐播放、下载、前台检测都在 Rust 内完成。
  历史文档里的 `music.exe` / `music_process.rs` / stdin/stdout JSON 属于 Electron 时代，
  已不存在。
- 自动更新安装器由 Rust 在需要时启动系统安装程序；它不是常驻子进程，
  也不参与应用运行时的 IPC。

## 2. 前端（`src/`）

| 层 | 职责 |
|---|---|
| `components/` | Vue 单文件组件；只消费 store，不直接调 `invoke` |
| `stores/` | Pinia 业务状态；组件改状态的唯一入口 |
| `api/` | `invoke()` / `listen()` 的 TypeScript 封装，按领域分文件 |
| `utils/` | 无副作用纯函数 |
| `styles/global.css` | 颜色 token、z-index 层级、全局布局基础 |

数据流：

```
组件 → Pinia store → api/*.ts → Tauri invoke → Rust command
                                      ↓
                              module / 文件 / 网络 / 音频
                                      ↓
                          emit 事件 → 前端 listen
```

## 3. 后端（`src-tauri/src/`）

| 路径 | 职责 |
|---|---|
| `lib.rs` | Tauri 入口：窗口、插件、`generate_handler!` 命令注册 |
| `main.rs` | Windows 入口（避免控制台窗口） |
| `state.rs` | 跨命令共享状态（`AppState` / `MusicState` / `ChartsState`） |
| `commands/` | 命令层：参数校验 + 调度，按领域分文件 |
| `modules/` | 业务实现：音频、下载、认证、数据、前台检测、HTTP/WS |

命令层不写重业务；实际逻辑在 `modules/`。新增命令的四步见
[`../src-tauri/README.md`](../src-tauri/README.md)。

## 4. IPC 契约

- 前端 `invoke("cmd", args)` → Rust `#[tauri::command]`；
- 参数由 Tauri 从 camelCase 自动转 snake_case；
- **返回值不做 camelCase 自动转换**：Rust 结构体字段名必须与前端读取名严格一致，
  需要时显式 `#[serde(rename_all = "camelCase")]`；
- Rust 主动推送用 `emit`，前端用 `listen` 消费；事件名两边必须一致。

字段名不匹配曾导致整个面板渲染崩溃，属于硬约束。

## 5. PWA（`src/pwa/`）

PWA 不复制桌面端组件，而是通过 Vite alias 把 `src/` 原样编译：

| alias | 指向 | 作用 |
|---|---|---|
| `@` | `src/` | 组件/store/API 原样复用 |
| `@tauri-apps/api` | `src/pwa/tauri/` | 浏览器 shim：`invoke` 路由到 localStorage/REST/WS/HTML5 Audio |

因此重构桌面端前端时 PWA 自动同步；只有浏览器做不到的能力
（本地文件、前台检测、系统级下载）在 PWA 层降级。详见
[`../src/pwa/README.md`](../src/pwa/README.md)。

## 6. 数据与安全

- 数据文件：`modules/data_manager.rs` 写入 Tauri `app_data_dir()` 下的
  `data.json` / `settings.json` / `garden_data.json`；
- 凭据：`modules/cloud_auth.rs` 使用 AES-256-GCM + PBKDF2-SHA512；
  云端使用 JWT access/refresh token；
- 前端不保存明文密码；PWA 使用 refresh token 自动登录；
- 详细安全设计见 [`SECURITY.md`](./SECURITY.md)。

## 7. 服务器集成

- 客户端通过 REST + WebSocket + P2P 信令与自建服务器通信；
- **服务器运行代码不在本仓库**，接口权威文档在
  [`../server-planning/EXTERNAL-INTERFACES.md`](../server-planning/EXTERNAL-INTERFACES.md)；
- 线上实现是 Python 标准库 `ThreadingHTTPServer` + PostgreSQL，无 Nginx/Redis；
- 自习室/同步听歌的协议与限制见 [`STUDY_ROOM_ARCHITECTURE.md`](./STUDY_ROOM_ARCHITECTURE.md)。

## 8. 构建与测试

```bash
npm run tauri:dev          # 开发
npm test                   # 前端 Vitest
cd src-tauri && cargo test --lib
npm run tauri:build        # 安装包
npm run docs:check         # 文档/版本一致性
```

构建产物位置、纯 Rust 边界、命令注册细节见
[`../src-tauri/README.md`](../src-tauri/README.md)。

## 9. 文档入口

- 本项目整体结构（自动生成）：[`PROJECT_MAP.md`](./PROJECT_MAP.md)
- 文档状态（当前/草案/历史）：[`README.md`](./README.md)
- 桌面端前端：[`../src/README.md`](../src/README.md)
- 桌面端后端：[`../src-tauri/README.md`](../src-tauri/README.md)
- PWA：[`../src/pwa/README.md`](../src/pwa/README.md)
- 服务器接口：[`../server-planning/README.md`](../server-planning/README.md)
