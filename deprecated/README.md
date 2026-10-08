# Deprecated 模块归档

这个文件夹存放了 PomoSolo 项目从 Electron + Python 迁移到 Tauri + Rust 过程中被废弃的代码和文件。它们保留在这里只是为了证明"它们曾经来过"。

## 目录结构

### `music-player/` — Python 音乐播放器（已被 Rust 替代）

原位于项目根目录 `music-player/`，是 v4.0.x 及之前版本的音乐播放模块。

| 文件 | 说明 |
|---|---|
| `music.py` | Python 音乐播放器主程序，使用 sounddevice + soundfile |
| `music.exe` | PyInstaller 打包的 music.py 可执行文件 |
| `music.spec` | PyInstaller 打包配置 |
| `manual_downloader.py` | 手动下载器，调用 DeepSeek API 分析 B 站视频 |
| `manual_downloader.exe` | PyInstaller 打包的 manual_downloader.py |
| `manual_downloader.spec` | PyInstaller 打包配置 |
| `youget_download.py` | you-get 下载封装 |
| `you-get.exe` | you-get 命令行工具（B 站视频下载） |
| `ffmpeg.exe` | FFmpeg 音频转码工具 |
| `music打包复制.bat` | music.exe 打包复制脚本 |
| `downloader打包复制.bat` | manual_downloader.exe 打包复制脚本 |
| `README.md` | 旧 Python 音乐播放器说明文档 |
| `__pycache__/` | Python 字节码缓存 |
| `build/` | PyInstaller 构建中间产物 |
| `dist/` | PyInstaller 构建输出 |

**替代方案**：`src-tauri/src/modules/audio_player.rs`（rodio + symphonia）和 `src-tauri/src/modules/downloader.rs`（纯 Rust 实现）

**废弃时间**：v4.1.1（2026-07-30）

---

### `foreground_inspection/` — Python 前台检测（已被 Rust 替代）

原位于项目根目录 `foreground_inspection/`，是 v4.0.x 及之前版本的前台窗口检测模块。

| 文件 | 说明 |
|---|---|
| `foreground_inspection.py` | Python 前台检测脚本，使用 win32gui 获取活动窗口 |
| `foreground_inspection.exe` | PyInstaller 打包的可执行文件 |
| `foreground_inspection.spec` | PyInstaller 打包配置 |
| `list_config.json` | 检测列表配置 |
| `model_config.json` | 模型配置 |
| `打包复制.bat` | 打包复制脚本 |

**替代方案**：`src-tauri/src/modules/foreground_inspection.rs`（windows crate + reqwest，纯 Rust 实现）

**废弃时间**：v4.1.1（2026-07-30）

---

### `supabase-test/` — Electron + Supabase 测试环境

原位于项目根目录 `supabase-test/`，是早期开发时用于测试 Supabase 连接的独立 Electron 测试应用。

| 文件 | 说明 |
|---|---|
| `main.js` | Electron 主进程 |
| `preload.js` | Electron preload 脚本 |
| `renderer.js` | 渲染进程脚本 |
| `index.html` | 测试页面 |
| `package.json` | 测试应用依赖配置 |
| `package-lock.json` | 依赖锁定文件 |

**废弃时间**：项目迁移到 Tauri 后

---

### `legacy-scripts/` — 旧调试脚本

原位于项目根目录，是 Electron 时代的调试工具。

| 文件 | 说明 |
|---|---|
| `一键诊断.js` | Electron 版一键诊断脚本 |
| `调试脚本.js` | Electron 版调试脚本 |
| `cargo-check.log` | Rust 编译检查日志（调试遗留） |
| `cargo-check2.log` | Rust 编译检查日志（调试遗留） |

---

### `old-builds/` — 旧版本安装包

原位于 `src-tauri/target/release/bundle/nsis/`，是旧版本的 NSIS 安装包。

| 文件 | 说明 |
|---|---|
| `PomoSolo_4.0.0_x64-setup.exe` | v4.0.0 安装包（Electron + Python，118MB） |
| `PomoSolo_4.1.0_x64-setup.exe` | v4.1.0 安装包（过渡版本） |
| `PomoSolo_4.1.0_x64-setup.exe.sig` | v4.1.0 签名文件 |
| `PomoSolo_4.1.1_x64-setup.exe` | v4.1.1 安装包（首个纯 Rust 版本，16.6MB） |
| `PomoSolo_4.1.1_x64-setup.exe.sig` | v4.1.1 签名文件 |

---

## 另见

### `electron/` — Electron 版本完整源码

原位于项目**根目录** `electron/`，2026-09 仓库重构时归入本归档目录
（`git mv electron deprecated/electron`，151 个文件）。包含主进程、渲染进程、测试和样式文件。

> **它是冻结的历史参考，不再修改。** 迁移新模块时先读它理解原版行为，
> 再参照当前 `src-tauri/src/commands/` + `modules/` 实现；
> 调样式时 `deprecated/electron/src/styles/*.css` 可作为"在 Chromium 下原本长什么样"的基准。
> `vitest.config.ts` 已显式 `exclude: ['deprecated/electron/**']`，不参与构建与测试。

---

## 归档体积说明（2026-09 重构）

### 已移出版本控制的内容（约 44 MB）

PyInstaller **构建中间产物**（不是源码，也不是成品 exe）已从 git 跟踪中移除，
只保留在本机磁盘上，并由 `.gitignore` 排除：

| 位置 | 内容 | 体积 |
|------|------|------|
| `music-player/build/` | `music.pkg`(21.8MB)、`PYZ-00.pyz`(4.5MB)、`base_library.zip`、`.toc`、`xref-*.html` | ~28 MB |
| `foreground_inspection/build/` | `foreground_inspection.pkg`(11.2MB)、`PYZ-00.pyz`(4.0MB)、`base_library.zip`、`.toc`、`xref-*.html` | ~16 MB |
| `music-player/__pycache__/` | 3 个 `.pyc` | 忽略不计 |

**为什么移除**：这些是 PyInstaller 打包时的临时中间物，既不能运行也无法阅读，
纯粹是仓库噪声。删掉不影响任何源码或成品。
**如何找回**：`git log --all -- deprecated/music-player/build` → 从历史提交里 checkout。

### 仍保留在版本控制中的大件（约 157 MB，**有意保留**）

| 文件 | 体积 | 说明 |
|------|------|------|
| `music-player/ffmpeg.exe` | 98.7 MB | 旧版音频转码依赖 |
| `music-player/music.exe` | 22.2 MB | PyInstaller 打包的 `music.py` |
| `music-player/you-get.exe` | 13.1 MB | B 站视频下载工具 |
| `music-player/manual_downloader.exe` | 11.7 MB | 打包的 `manual_downloader.py` |
| `foreground_inspection/foreground_inspection.exe` | 11.5 MB | 打包的前台检测脚本 |

**为什么保留**：它们是"曾经长这样"的**可运行成品存档**，2026-09 重构时经确认保留。
当前版本**完全不依赖**它们 ——
播放是 `src-tauri/src/modules/audio_player.rs`（rodio + symphonia），
下载是 `downloader.rs`（纯 Rust），前台检测是 `foreground_inspection.rs`（windows crate）。
**禁止**在新代码里引用这些 exe（见 `TEAM_GUIDE.md` §6.3）。

> ⚠️ `git clone` 仍会下载这 157 MB（它们已存在于历史中）。
> 若将来要彻底瘦身，需要 `git filter-repo` 重写历史 —— 那是破坏性操作，需全员协调。
