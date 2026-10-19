# `src-tauri/` —— 桌面端 Rust 后端

> **范围**：只讲本目录（Tauri v2 的 Rust 侧）。
> 前端目录职责见 [`../src/README.md`](../src/README.md)；
> PWA 见 [`../src/pwa/README.md`](../src/pwa/README.md)。
> 整体结构/版本/模块数量由 `npm run docs:map` 生成到
> [`../docs/PROJECT_MAP.md`](../docs/PROJECT_MAP.md)。

## 1. 目录职责

| 路径 | 职责 |
|---|---|
| `src/lib.rs` | Tauri 应用入口；注册所有 commands、窗口、插件 |
| `src/main.rs` | Windows 入口（避免控制台窗口） |
| `src/state.rs` | 跨命令共享状态（`AppState` / `MusicState` / `ChartsState`） |
| `src/commands/` | `#[tauri::command]` 层：参数校验 + 调度，按领域分文件 |
| `src/modules/` | 业务实现：音频、下载、认证、数据、前台检测、HTTP/WS |
| `capabilities/` | Tauri 权限配置 |
| `tauri.conf.json` | 窗口、CSP、打包、updater 配置 |
| `Cargo.toml` / `Cargo.lock` | Rust 依赖与锁定版本 |

当前模块清单以 [`../docs/PROJECT_MAP.md`](../docs/PROJECT_MAP.md) 为准，
不在本文件手写文件数量。

## 2. 新增一个 Tauri 命令（四步）

1. 在 `src/commands/<领域>.rs` 加 `#[tauri::command]` 函数；
2. 在 `src/lib.rs` 的 `generate_handler!` 宏里注册
   （**漏了这步前端会报命令不存在**）；
3. 在 `../src/api/<领域>.ts` 封装 `invoke()` 并写 TypeScript 类型；
4. 在 `../src/stores/` 或 `../src/components/` 消费。

参数由 Tauri 从 camelCase 自动转 snake_case；**返回值不做自动转换**。
Rust 结构体字段名必须与前端读取名严格一致；需要 camelCase 时显式加
`#[serde(rename_all = "camelCase")]`。字段名不匹配曾导致整个面板渲染崩溃。

## 3. 纯 Rust 边界

以下能力**必须**纯 Rust 实现，不得引入 Python 子进程或外部 `ffmpeg.exe`：

- 音乐播放：`modules/audio_player.rs`（rodio + cpal + symphonia）；
- 音乐下载：`modules/downloader.rs`（reqwest + DASH 解析）；
- 前台窗口检测：`modules/foreground_inspection.rs`（`windows` crate）。

历史文档里出现的 `music.exe` / `music_process.rs` / Python 子进程描述属于
Electron 时代，已不适用；以本文件和代码为准。

## 4. 数据与安全

- 数据文件：`modules/data_manager.rs` 写入 Tauri `app_data_dir()` 下的
  `data.json` / `settings.json` / `garden_data.json`；
- 凭据：`modules/cloud_auth.rs` 使用 AES-256-GCM + PBKDF2-SHA512，
  JWT refresh token 自动续期；
- 安全设计详见 [`../docs/SECURITY.md`](../docs/SECURITY.md)。

## 5. 开发、测试与构建

```bash
npm run tauri:dev            # 完整 Tauri（会打开真实窗口）
cargo test --lib             # 在 src-tauri/ 下跑 Rust 单测
npm test                     # 前端 Vitest
npx vue-tsc --noEmit         # 前端类型检查
```

构建：

```bash
npm run tauri:build
```

产物位置取决于是否设置了 `CARGO_TARGET_DIR`：

- **本地默认**：`src-tauri/target/release/bundle/nsis/`（`*.exe` + `*.sig`）；
- **CI / 自建 runner**：`CARGO_TARGET_DIR` 指向共享缓存（本机为
  `D:\pomosolo-cache\target`），产物在
  `%CARGO_TARGET_DIR%/release/bundle/nsis/`。

不要在本地 `cargo test` 时把 `CARGO_TARGET_DIR` 指到 CI 的共享目录，
两套 target 混用会互相污染增量缓存。发版流程与红线见
[`../TEAM_GUIDE.md`](../TEAM_GUIDE.md) §16。
