# 音乐播放器模块文档

> 本文档记录 Tauri 番茄钟应用"音乐播放器"模块的实现方案与踩坑历史。
> 模块从 Electron 旧版（`electron/src/scripts/modules/musicPlayer.js` + `electron/src/styles/music-player.css`）迁移至 Tauri + Vue 3 + Pinia 架构，**音频播放为 Rust 原生实现（rodio + cpal + symphonia），无 Python 子进程**（旧版 `music.py` 子进程方案已废弃）。

---

## 1. 模块概述

### 1.1 职责

音乐播放器模块负责番茄钟工作/休息期间的背景音乐播放，包含以下能力：

- 播放控制：播放/暂停、上一首、下一首、跳转进度（seek）
- 播放模式：随机（shuffle）/ 顺序（order）/ 单曲循环（loop）三种模式循环切换
- 音量控制：竖向滑块、音量图标随大小变化（🔇/🔈/🔉/🔊）、音量持久化到本地存储
- 输出设备：枚举系统音频输出设备，运行时切换（含警告提示）
- 播放列表：扫描 `music/` 目录、展示歌曲标签、点击切歌、删除歌曲、刷新
- 标签管理：预设标签（学习/运动/休息）+ 自定义标签，标签带颜色
- 收起/展开：底部播放器可收起为一条律动条 + 曲名
- 快捷键：媒体键全局快捷键（播放/暂停、上一首、下一首），由 Rust 端 `tauri_plugin_global_shortcut` 注册（见 `commands/system.rs`）

### 1.2 音频引擎与事件架构（Rust 原生，无子进程）

- **播放引擎**：`modules/audio_player.rs` 的 `AudioPlayer` 直接使用 **rodio**（基于 cpal 输出 + symphonia 解码）播放，支持 mp3/m4a/AAC/flac 等格式，自带解码无需外部 ffmpeg。
- **音频输出**：rodio `OutputStream` + `Sink`（0.21 起经 `&Mixer` 创建），设备枚举/切换走 cpal（`AudioPlayer::list_devices`）。
- **seek**：优先 rodio `Sink::try_seek`（不重建 sink、无音频重叠、`get_pos` 连续）；不支持时降级 `skip_duration` 重建 sink。
- **方向 1（前端 → Rust）**：前端 `invoke` → Rust `music_*` 命令（`commands/music.rs`）→ `ensure_init` 懒初始化 `AudioPlayer` → 直接操作播放器。
- **方向 2（Rust → 前端）**：Rust 层 `app.emit("music-xxx", data)`（`music-ready/status/track-change/progress/...`）→ 前端 `useTauriEvent` 监听 → Store `handle*` 方法更新状态。
- **进度上报**：`spawn_progress_task`（tokio 任务，200ms 间隔）上报 `music-progress`，并检测歌曲自然结束自动切歌（`get_next_song` → `play_song`），失败时发 `music-song-missing` / `music-play-error`。
- **同步响应**：需要同步返回结果的命令（`delete_song`、`get_custom_tags`、`add_custom_tag`、`delete_custom_tag`、`update_tag`、标签相关）由命令函数直接返回 `Result`，Tauri IPC 同步回给前端（无子进程、无 oneshot 中转）。
- **全局快捷键**：`commands/system.rs` + `tauri_plugin_global_shortcut` 注册媒体键（PlayPause/PrevTrack/NextTrack），回调直接调对应命令。

---

## 2. 架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                          前端 (Vue 3 + Pinia)                       │
│                                                                     │
│  ┌──────────────────────┐   ┌──────────────────────────────────┐  │
│  │ MusicPlayer.vue      │   │ stores/music.ts (Pinia Store)    │  │
│  │ - UI 渲染            │◄──┤ - state: playing/trackName/...   │  │
│  │ - 事件监听注册        │   │ - actions: togglePlay/next/...   │  │
│  │ - 弹层(设备/音量/列表)│   │ - handle*: 事件回调更新 state    │  │
│  └──────────┬───────────┘   └──────────────┬───────────────────┘  │
│             │ useTauriEvent 监听             │ 调用                │
│             │ music-ready/music-status/...  │                     │
│             ▼                               ▼                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ api/music.ts                                                  │ │
│  │ - invoke<T>("music_toggle_play", {...})                       │ │
│  │ - 类型定义: PlayMode/MusicDevice/MusicStatus/...              │ │
│  └──────────────────────────────┬───────────────────────────────┘ │
└─────────────────────────────────┼───────────────────────────────────┘
                                  │ Tauri IPC (invoke)
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Rust 后端 (src-tauri)                           │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ commands/music.rs                                             │ │
│  │ - #[tauri::command] music_toggle_play / music_next / ...      │ │
│  │ - ensure_init(): 懒初始化 AudioPlayer（rodio）               │ │
│  │ - spawn_progress_task(): 200ms 进度上报 + 自然结束自动切歌    │ │
│  └──────────────────────────────┬───────────────────────────────┘ │
│                                 │ 直接操作（Mutex<AudioPlayer>）    │
│                                 ▼                                  │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ state.rs: MusicState                                          │ │
│  │ - initialized: AtomicBool                                     │ │
│  │ - player: Arc<Mutex<AudioPlayer>>                             │ │
│  └──────────────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ modules/audio_player.rs（AudioPlayer）                        │ │
│  │ - rodio::OutputStream + Sink（cpal 输出）                     │ │
│  │ - symphonia 解码（mp3/m4a/AAC/flac，无需 ffmpeg）             │ │
│  │ - 播放/暂停/seek(try_seek)/音量/模式/播放列表/标签            │ │
│  │ - list_devices(): cpal 设备枚举                               │ │
│  └──────────────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ commands/system.rs（全局快捷键）                              │ │
│  │ - tauri_plugin_global_shortcut 注册媒体键 → 调对应命令        │ │
│  └──────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```
> 事件全部由 Rust 层直接 `app.emit("music-xxx")` 发出，**无子进程、无 stdin/stdout、无 Python**。

### 事件名映射（Rust 事件 → Tauri 前端）

| 触发场景          | Tauri 事件              | 触发时机                          |
| ----------------- | ----------------------- | --------------------------------- |
| `music-ready`     | 播放器初始化并加载首曲     | `ensure_init` 首次调用            |
| `music-status`    | 状态快照                 | `get_status` / 模式切换           |
| `music-track-change` | 切歌（自然结束/手动）    | 新歌开始播放                      |
| `music-play-state`| 播放/暂停切换             | `toggle_play`                     |
| `music-progress`  | 播放进度                 | `spawn_progress_task`（200ms）    |
| `music-devices`   | 设备列表                 | `get_devices` / `set_device`      |
| `music-no-music`  | 无音乐可播               | `music/` 为空或全部消失           |
| `music-play-error`| 播放异常                 | 播放/设备异常                     |
| `music-volume-change` | 音量变化             | 音量调整（含快捷键）              |
| `music-play-mode` | 播放模式                 | `set_play_mode` 后               |
| `music-playlist`  | 播放列表                 | `get_playlist`                    |
| `music-song-missing` | 歌曲文件消失          | 播放时检测文件不存在              |

---

## 3. 关键代码位置索引

| 文件                                                                    | 行号/范围      | 说明                                              |
| ----------------------------------------------------------------------- | -------------- | ------------------------------------------------- |
| `src/components/MusicPlayer.vue`                                        | L1–L155        | `<script setup>`：UI 状态、事件监听、初始化       |
| `src/components/MusicPlayer.vue`                                        | L157–L322      | `<template>`：三行布局结构                        |
| `src/components/MusicPlayer.vue`                                        | L324–L904      | `<style scoped>`：所有样式与 z-index 层级         |
| `src/stores/music.ts`                                                   | L59–L470       | Pinia store：state / getters / actions / handle*  |
| `src/api/music.ts`                                                      | L21–L190       | `invoke` 封装与类型定义                           |
| `src-tauri/src/commands/music.rs`                                       | L21–L42        | `get_music_dir`：开发/生产模式音乐目录            |
| `src-tauri/src/commands/music.rs`                                       | L44–L86        | `ensure_init`：懒初始化 AudioPlayer                |
| `src-tauri/src/commands/music.rs`                                       | L88–L161       | `spawn_progress_task`：进度上报 + 自然结束自动切歌 |
| `src-tauri/src/commands/music.rs`                                       | L163–L500      | 所有 `#[tauri::command]` 函数                     |
| `src-tauri/src/modules/audio_player.rs`                                 | L119–L460      | `AudioPlayer`：rodio 播放/seek/音量/模式/列表/标签 |
| `src-tauri/src/commands/system.rs`                                      | L78–L110       | 媒体键全局快捷键注册（`global_shortcut`）          |
| `electron/src/styles/music-player.css`                                  | 全文           | 旧版样式（对照参考）                              |
| `electron/src/scripts/modules/musicPlayer.js`                           | 全文           | 旧版逻辑（对照参考）                              |

---

## 4. 踩坑记录（最重要）

### 4.1 音乐目录存储位置：从安装目录迁移到用户数据区

- **背景**：早期运行时音乐目录 = `resource_dir/music`（安装目录）。自动更新会用新安装包**整体覆盖安装目录**，用户下载的歌曲会丢；此前靠 `update.rs::restore_music_dir`（更新前备份 → 更新后还原）保护，但备份/还原本身有遗漏风险（如更新中断）。
- **新设计（已实施）**：
  - 运行时音乐目录 = `app_data_dir/music`（用户数据区，安装/更新永不触碰）
  - 安装包内置歌曲由 Tauri 打包到 `resource_dir/resources/music`，老版本（4.4.x）遗留的用户音乐目录在 `resource_dir/music`；应用启动时由 `update.rs::merge_music_dir` 把**这两个来源 + 老备份 `backup/music`** 合并到用户目录（**不覆盖用户已有同名文件**）
  - `commands/music.rs::get_music_dir` 与 `commands/charts.rs::get_music_dir` 统一返回 `app_data_dir/music`
- **踩坑**：v4.5.0 首发时 `merge_music_dir` 只读 `resource_dir/music`，全新安装主机没有该目录（内置歌实际在 `resource_dir/resources/music`），导致新装用户"无音乐"；v4.5.1 已改为同时合并两个来源
- **改动文件**：`src-tauri/src/commands/update.rs`（`merge_music_dir`）、`src-tauri/src/lib.rs`（setup 钩子）、`commands/music.rs`、`commands/charts.rs`
- **验证**：`cargo test --lib` 通过；全新安装 → 内置 3 首歌出现在用户目录；老版本升级 → 用户下载的歌保留且不重复

---

### 4.2 缺少 Rust invoke handler 导致前端失败

- **现象**：
  - 前端打开后播放器显示"未播放"，曲名始终为空，无论点播放/上一首/下一首都没反应。
  - 输出设备列表弹框打开后显示"加载中..."，永远不出现设备。
  - 浏览器/DevTools 控制台报 `invoke music_toggle_play failed: command not found` 之类错误。
- **根因**：
  - `src/api/music.ts` 中调用的 `invoke("music_toggle_play")` 等命令，必须在 Rust 端用 `#[tauri::command]` 标注并且在 `tauri::Builder::default().invoke_handler(tauri::generate_handler![...])` 中显式注册，缺一不可。
  - 早期迁移时只写了 `commands/music.rs` 中的 `#[tauri::command]` 函数，忘了在 `lib.rs` / `main.rs` 的 `invoke_handler` 列表里追加 `music::music_toggle_play`、`music::music_get_devices` 等。前端 invoke 直接报"command not found"，store 的 `requestStatus` / `requestDevices` 全部失败，UI 自然没有数据。
- **错误尝试**：
  1. 一开始以为是播放器未初始化，加了日志发现 `ensure_init` 根本没被调用——因为 Rust 命令根本没注册成功，前端 invoke 在 IPC 层就被拒了。
  2. 试图在 `MusicPlayer.vue` 的 `onMounted` 里加 retry 逻辑重试 `requestDevices`，毫无意义，因为命令名不存在，重试多少次都一样。
  3. 怀疑过 `MusicState` 没注入 `app.manage(MusicState::default())`，检查后发现已正确注入。
- **正确方案**：
  - 在 `src-tauri/src/lib.rs` 的 `invoke_handler` 中**完整列出**所有 `music_*` 命令：
    ```rust
    .invoke_handler(tauri::generate_handler![
        music::music_toggle_play,
        music::music_next,
        music::music_prev,
        music::music_seek,
        music::music_set_volume,
        music::music_set_play_mode,
        music::music_get_status,
        music::music_get_playlist,
        music::music_get_devices,
        music::music_set_device,
        music::music_play_song,
        music::music_delete_song,
        music::music_get_custom_tags,
        music::music_add_custom_tag,
        music::music_delete_custom_tag,
        music::music_update_tag,
        // ... 其他模块命令
    ])
    ```
  - 注册后重启 Tauri dev server（`npm run tauri dev`），前端 invoke 即可命中 Rust handler，播放器被懒初始化（`ensure_init`），事件回流，UI 正常显示。
- **验证**：打开 DevTools 控制台不再出现 `command not found`；点击播放按钮后 stderr 日志出现 `toggle: 恢复播放`；设备列表弹框能列出系统音频设备。

### 4.3 布局结构问题：三行结构与原版按钮位置

- **现象**：
  - 迁移后播放器看起来"按钮全挤在一行"，进度条与控制按钮位置混乱，与 Electron 旧版的视觉差异明显。
  - 旧版布局是"信息行（含音量/设备/列表按钮）→ 进度条行 → 控制行（含播放/上一首/下一首/模式）"，但迁移版一度把所有按钮堆到了同一个 flex 容器里。
- **根因**：
  - 直接照搬旧版 CSS 类名但 HTML 结构没对齐。旧版 `.music-info` 只放曲名 + 音量 + 设备 + 播放列表按钮，进度条与主控制按钮分别在 `.music-progress-container` 与 `.music-controls` 两个独立行。迁移时把控制按钮误塞进了 `.music-info`。
- **错误尝试**：
  1. 试图用 `flex-wrap: wrap` 让按钮自动换行——结果按钮顺序乱、间距不一致，且进度条被挤到第三行。
  2. 给每个按钮加 `margin` 硬调位置——不同分辨率下表现不一致。
  3. 把进度条移到最下面、控制按钮放中间——和原版相反，用户反馈"不习惯"。
- **正确方案**：在 `MusicPlayer.vue` `<template>` 中严格采用**三行结构**，与旧版对齐：
  - **第 1 行 `.music-info`**：🎵 曲名（flex:1）+ 🔊音量按钮 + 🎧设备按钮 + 📋播放列表按钮（4 个元素横排，曲名占满剩余空间）
  - **第 2 行 `.music-progress`**：当前时间 + 进度条 + 总时长
  - **第 3 行 `.music-controls`**：📊榜单（绝对定位左）+ ⏮上一首 + ▶/⏸播放 + ⏭下一首 + 🔀模式（绝对定位右）
  - 中间的"上一首/播放/下一首"用 `justify-content: center` 居中，左右两侧的"榜单/模式"用 `position: absolute; left: 0 / right: 0` 浮出去，不影响中间居中。
  - `.music-player__main` 用 `display: flex; flex-direction: column; gap: 6px` 把三行纵向排列。
- **验证**：与旧版截图并排对比，按钮位置完全一致；不同窗口宽度下中间按钮始终居中。

### 4.4 收起/展开动画：max-height 过渡

- **现象**：
  - 旧版收起时，播放器内容会"平滑缩成一条"，曲名与律动条淡入。
  - 迁移版直接 `v-if` 切换，内容瞬间消失/出现，体验很差。
  - 也尝试过 `display: none`，更是没有动画。
- **根因**：
  - `display: none ↔ block` 不可过渡；`v-if` 是直接卸载 DOM，没有过渡过程。
  - 必须用 `max-height` + `opacity` 双过渡，并且**展开/收起两个方向的时序不对称**。
- **错误尝试**：
  1. 用 `v-show` + `opacity` 过渡——元素仍占据空间，收起后下方留白。
  2. 用 `transform: scaleY(0)` ——变换后子元素也跟着挤压，按钮看起来被压扁。
  3. 同时给 `max-height` 和 `opacity` 设相同 transition 时长——收起时内容先变透明再塌陷，视觉上"先消失后缩"，不符合"内容跟着塌陷一起淡出"的原版效果。
- **正确方案**：仿照旧版 `music-player.css` 的延迟动画策略：
  - `.music-wrapper` 用 `max-height: 300px → 0` + `transition: max-height 0.45s cubic-bezier(0.5, 0, 0.5, 1)` 做主体塌陷。
  - `.music-player.collapsed .music-wrapper` 同时设 `overflow: hidden`，防止过渡期间内容溢出。
  - 收起态的 `.music-player__collapsed`（律动条 + 曲名）用 `position: absolute; bottom: 0` + `opacity: 0 → 1` + `visibility: hidden → visible`，**展开时先让收起态淡出（快速腾出空间），收起时延迟等播放器先收起再淡入**。
  - 关键：`cubic-bezier(0.5, 0, 0.5, 1)`（对称缓动）让动画进出一致；`max-height` 取一个足够大的值（300px）确保展开时不会被截断。
  - 收起按钮图标 `▼` 用 `transform: rotate(0deg) → rotate(180deg)` 翻转为 `▲`，过渡 0.45s 与主体同步。
- **验证**：收起时内容随高度塌陷淡出，律动条 + 曲名紧接着浮现；展开时反向，无闪烁、无留白。

### 4.5 输出设备弹框被遮挡

- **现象**：
  - 点击 🎧 设备按钮，弹框"闪了一下"就消失，或者根本看不到。
  - 在某些窗口尺寸下弹框只露出上半截，下半截被侧边栏/主内容区切掉。
- **根因**：
  - **不是 z-index 问题**。根因是 `.main-content` 父容器设了 `overflow: hidden`，对播放器弹出的浮层进行了**物理裁剪**——设备弹框 `position: absolute; bottom: 100%` 向上弹出，超出了 `.main-content` 的内容盒范围，被硬切。
  - 即使把弹框 `z-index` 调到 9999 也无济于事，因为 `overflow: hidden` 是物理裁剪，与 z-index 无关。
- **错误尝试**：
  1. 把 `.music-device__list` 的 `z-index` 从 100 一路加到 9999——无效，弹框还是被切。
  2. 把 `.music-player` 的 `z-index` 提到 200——也无效，因为父级 `.main-content` 的 `overflow: hidden` 才是元凶。
  3. 给弹框加 `position: fixed`——虽然能逃逸裁剪，但定位会脱离 `.music-player` 的相对锚点，弹框位置乱跑，且滚动时不同步。
- **正确方案**：
  - **治本**：确保 `.main-content` 不对播放器区域做 `overflow: hidden` 裁剪。如果 `.main-content` 必须保留 `overflow: hidden`（例如为了裁剪其他浮层），则把播放器提到一个**不带 overflow 裁剪的祖先节点**下，或者给 `.main-content` 改用 `overflow: visible` 并对真正需要裁剪的子节点单独处理。
  - **治标**：保留 `.music-device__list` 的 `z-index: 9999` 与 `position: absolute; bottom: 100%; right: 0`，确保在 `.music-player` 自身的层叠上下文内不被其他浮层遮挡。
  - `.music-player` 容器自身设 `overflow: visible`（不能 `hidden`），否则子节点弹框同样被切。
  - `.music-wrapper` 展开态也必须 `overflow: visible`，仅收起态才 `overflow: hidden`（用于塌陷动画）。
- **验证**：弹框完整显示在播放器上方，不再被裁剪；窗口缩放时弹框跟随设备按钮定位。

### 4.6 输出设备 emoji：🎧 vs 🔊

- **现象**：
  - 旧版设备按钮用 🎧（耳机）图标，迁移版一度用 🔊（扬声器）——与音量按钮的 🔊 撞图标，用户分不清"哪个是设备、哪个是音量"。
- **根因**：
  - 迁移时图省事，把"输出设备"和"音量"都用了 🔊。语义上 🔊 应该归音量，🎧 才表示"输出设备选择"。
- **错误尝试**：
  1. 用 📢 表示设备——语义不对，📢 是广播。
  2. 用 🔈 🔉 🔊 三档音量图标轮换给设备——更混乱。
- **正确方案**：
  - 音量按钮：根据 `volume` 大小动态切换 🔇/🔈/🔉/🔊（store 的 `volumeIcon` getter）。
  - 设备按钮：固定 🎧，与音量图标明确区分。
  - 当前 `MusicPlayer.vue` L213：`<button class="music-btn" title="输出设备" @click="toggleDeviceList">🎧</button>`，已修复。
- **验证**：两个按钮图标不同，用户一眼能区分。

### 4.7 进度条数字颜色对比度不足

- **现象**：
  - 进度条两侧的"当前时间 / 总时长"数字在深色背景上几乎看不清，用户反馈"像贴了层灰雾"。
- **根因**：
  - 旧版 `.music-time` 用 `color: rgba(255, 255, 255, 0.7)`，迁移版早期也照搬了这个值，但新背景的对比度比旧版更低（新背景半透明叠加在番茄钟主色上，整体偏暗），0.7 透明度的白字几乎糊掉。
- **错误尝试**：
  1. 把数字字号从 10px 加到 12px——还是看不清，根因是颜色不是字号。
  2. 给数字加 `text-shadow` 发光——视觉上有点改善，但风格与原版不符。
- **正确方案**：
  - `.music-progress__time` 直接用 `color: #fff`（纯白），保证对比度。
  - 同时 `font-variant-numeric: tabular-nums` 让等宽数字，防止跳动。
  - 当前 `MusicPlayer.vue` L611：`.music-progress__time { font-size: 11px; color: #fff; font-variant-numeric: tabular-nums; }`。
- **验证**：数字在任何工作/休息模式下都清晰可读。

### 4.8 滚动条样式缺失

- **现象**：
  - 设备列表/播放列表滚动时，浏览器默认滚动条（灰色粗条）特别突兀，与整体毛玻璃风格完全不搭。
- **根因**：
  - 旧版 `.music-player.css` 已经写过 `::-webkit-scrollbar` 样式，迁移时只搬了主体样式，漏了滚动条。
- **错误尝试**：
  1. 给容器加 `scrollbar-width: none`（Firefox）直接隐藏——用户无法感知列表可滚动。
  2. 用 JS 监听滚动事件自定义滚动条——过度工程。
- **正确方案**：在 `MusicPlayer.vue` `<style scoped>` 中为每个可滚动容器单独写 `::-webkit-scrollbar` 规则：
  - `.music-device__list::-webkit-scrollbar { width: 6px }` + `track: transparent` + `thumb: rgba(255,255,255,0.2)` + `thumb:hover: 0.4`
  - `.music-playlist__items::-webkit-scrollbar { width: 4px }` + 同上
  - 注意 `scoped` 样式下 `::-webkit-scrollbar` 需要带容器前缀，不能裸写，否则不生效。
- **验证**：滚动条变成半透明细条，与背景融合，hover 时变亮。

### 4.9 音量调节拨动条层级和宽度

- **现象**：
  - 音量拨动条弹出后，被收起按钮挡住一半，无法完整操作。
  - 拨动条是横向的，与旧版的"竖向 4px 宽"完全不同。
  - 拖动滑块时，鼠标稍微偏离就被"点击外部"逻辑关掉弹层。
- **根因**：
  - 收起按钮 `.music-collapse-btn` 设了 `z-index: 10`，音量拨动条没设 z-index，被按钮压在下面。
  - HTML 原生 `<input type="range">` 默认是横向的，要竖向必须用 `writing-mode: vertical-lr; direction: rtl`。
  - 全局点击关闭弹层的逻辑判断范围不对，没有把 `.music-volume` 容器整体纳入"内部点击不关闭"。
- **错误尝试**：
  1. 给音量拨动条 `z-index: 100` 想压过收起按钮的 `10`——结果还是被挡，因为收起按钮的 `z-index` 在 `.music-player` 层级下重新建立。
  2. 把拨动条改成横向 100px 宽——和旧版视觉差异大，且占用横向空间。
  3. 用 `transform: rotate(-90deg)` 旋转横向滑块——布局错乱，定位计算复杂。
- **正确方案**：
  - **z-index**：`.music-volume__slider { z-index: 1000 }`，**高于** `.music-collapse-btn` 的 10，弹开时暂时遮住收起按钮（用户调音量时不需要按收起）。关闭后自然让位。
  - **宽度**：`input { width: 4px; height: 100px; writing-mode: vertical-lr; direction: rtl; }`，与旧版 `.volume-range` 完全一致。
  - **thumb**：`-webkit-slider-thumb { width: 14px; height: 14px; background: #fff; border-radius: 50% }`，hover 时 `transform: scale(1.1)`。
  - **关闭逻辑**：`handleGlobalClick` 中 `if (isVolumeOpen && !target.closest('.music-volume')) isVolumeOpen = false`，把 `.music-volume` 整个容器（含按钮和拨动条）作为"内部"判断，拖动滑块时点击事件目标在 `.music-volume` 内，不会误关闭。
  - **背景色**：`.music-volume__slider` 用 `linear-gradient(145deg, rgba(255,120,120,0.5), rgba(255,100,100,0.4))`，休息模式切换为绿色调（`.container.break-mode .music-volume__slider`）。
- **验证**：拨动条完整可见、可拖动；拖动时弹层不关闭；收起按钮在拨动条关闭后可正常点击。

### 4.10 播放列表样式

- **现象**：
  - 迁移版播放列表宽度只有 200px，歌曲名带扩展名时被截断；条目间距过大，单屏显示歌曲数少。
- **根因**：
  - 旧版 `.music-playlist-panel { width: 200px }` 是基于旧字号设计的；迁移版字号微调后 200px 显得拥挤。
  - 条目 `padding: 8px 12px` 偏大，旧版实际是 `6px 10px`，迁移时误改。
- **错误尝试**：
  1. 改回 200px 宽 + 减小字号到 9px——字太小看不清。
  2. 用 `width: fit-content` 自适应——不同歌曲名长度差异大，列表宽度跳动。
- **正确方案**：对照旧版精确还原，并在不破坏视觉的前提下微调：
  - `.music-playlist { width: 240px; max-height: 280px; }`（从 200px 扩展到 240px，完整显示歌曲信息）
  - `.music-playlist__item { padding: 6px 10px; }`（与旧版 `.playlist-item` 一致）
  - `.music-playlist__name { font-size: 10px; }`（与旧版 `.playlist-item-name` 一致）
  - `.music-playlist__tag { font-size: 8px; padding: 2px 6px; border-radius: 4px; }`（与旧版 `.playlist-item-tag` 一致）
  - `.music-playlist__header { padding: 10px 12px; font-size: 13px; font-weight: 600; }`（标题比旧版略大，更醒目）
  - `.music-playlist` 同样 `z-index: 9999`，与设备弹框层级一致。
- **验证**：列表宽度合适，歌曲名完整显示；条目紧凑，单屏能显示 8-10 首歌。

### 4.11 z-index 层级

- **现象**：
  - 播放器浮层（设备列表、播放列表、音量拨动条）时不时被侧边栏、HeaderButtons、ModeSlider 遮挡。
  - 不同弹层之间互相覆盖，操作时闪烁。
- **根因**：
  - 旧版 `.music-player { z-index: 100 }` 与 HeaderButtons、sidebar-collapse-btn 等的 z-index 没有显式规划，迁移后新增的弹层（9999）与父级（100）跨层叠上下文，导致行为不一致。
- **错误尝试**：
  1. 把所有弹层 `z-index` 都设为 9999——在 `.music-player` 内部互相覆盖，弹设备列表时音量拨动条还在前面。
  2. 把 `.music-player` 提到 z-index: 9999——整个播放器压过 HeaderButtons，番茄钟主界面按钮被遮。
- **正确方案**：建立明确的 z-index 层级表（见下方第 5 节）。核心原则：
  - `.music-player` 父容器 `z-index: 200`，高于 HeaderButtons(100)、ModeSlider(50)、sidebar-collapse-btn(10)，确保播放器整体不被遮挡。
  - `.music-player` 内部弹层（设备列表、播放列表）`z-index: 9999`，在 `.music-player` 自身的层叠上下文内最高，且不会逃逸到外部。
  - `.music-volume__slider { z-index: 1000 }`，高于 `.music-collapse-btn` 的 10，调音量时临时遮住收起按钮。
  - `.music-collapse-btn { z-index: 10 }`，在 `.music-player` 内部最低，正常态下不遮挡内容。
- **验证**：所有浮层正确显示在对应层级；不同弹层互不干扰；番茄钟主界面按钮可正常点击。

---

### 4.12 下载的 m4a 歌曲播放"解码失败"/"卡死"（全新主机无 ffmpeg）

- **现象**：全新主机（系统未装 ffmpeg）上下载歌曲后，播放列表显示该歌，但一选择就报解码失败或播放器卡死；老电脑（下载的歌都是 mp3）正常。
- **根因**（三层叠加）：
  1. **下载器依赖系统 ffmpeg 转码**：`downloader.rs::find_ffmpeg` 先查系统 PATH，其次查打包资源 `resource_dir/ffmpeg.exe`——但 ffmpeg 从未打进安装包（96MB，`tauri.conf.json` resources 只有 `resources/music/`）。全新主机无 ffmpeg → `download_song` 转码失败回退，**直接保存 B 站 DASH 的 m4a 原文件**。
  2. **rodio 0.20 无 AAC 支持**：`rodio 0.20` 默认 features 只含 mp3/wav/flac/vorbis。v4.5.1 加了 `symphonia-aac` + `symphonia-isomp4`，但**依然崩**。
  3. **rodio 0.20 的 symphonia 集成有 panic bug（真正断点）**：`rodio-0.20.1/src/decoder/symphonia.rs:45` 对初始化阶段的 `SeekError` 直接 `unreachable!("Seek errors should not occur during initialization")`——而 symphonia 0.5.5 解析 m4a（读 moov/gapless 信息）时确实会返回 `SeekError`，rodio 直接线程 panic 而非返回错误。tauri async command 里 panic → 持有播放器锁的线程崩溃 → 前端报错、后续音乐命令全部堵死。**实测三种 m4a（moov 前/moov 尾/fMP4）打开全部 panic**；绕过 rodio 用 symphonia 0.5.5 原生 API 解同样的文件**全部成功**，证明解码器本身没问题。
- **正确方案（v4.5.2 已实施）**：**升级 rodio 0.20.1 → 0.21.1**（官方修复，不引入 ffmpeg，不换解码器）：
  ```toml
  # src-tauri/Cargo.toml
  rodio = { version = "0.21", default-features = false, features = ["playback", "mp3", "wav", "flac", "vorbis", "mp4"] }
  ```
  - rodio 0.21.0 changelog 明确修复：*"Symphonia decoder for MP4 now seeks correctly (#577)"*，且 **MP4+AAC 默认支持**（`mp4 = ["symphonia-isomp4", "symphonia-aac"]`，官方自带 `music_m4a` 示例）。
  - 0.21 是 breaking 大版本，`audio_player.rs` 适配：`OutputStream::try_default()` → `OutputStreamBuilder::open_default_stream()`；`OutputStreamHandle` 移除 → 存 `Mixer`（`stream.mixer()`），`Sink::try_new(&handle)` → `Sink::connect_new(&Mixer)`（不再返回 Result）；`Decoder::new(BufReader)` → `Decoder::try_from(file)`；样本输出 i16 → **f32**；设备切换 `OutputStreamBuilder::from_device(device).open_stream_or_fallback()`。
  - 下载器逻辑不变：有 ffmpeg（系统 PATH）仍转 mp3；无 ffmpeg 直接保留 m4a，播放器可原生播放。
- **验证**：`cargo test --lib` 184 通过；升级后用三种 m4a（moov 前/moov 尾/fMP4）实测全部解码成功（48000Hz 双声道，时长/样本数正确）。
- **遗留**：见 4.13 —— v4.5.3 起下载时**内置转码 m4a → mp3**（不依赖 ffmpeg），彻底规避 m4a 播放兼容性问题。

---

### 4.13 下载时内置 m4a → mp3 转码（v4.5.3，不依赖系统 ffmpeg）

- **背景**：虽然 rodio 0.21 已能直接播放 m4a，但 m4a（尤其分片 MP4）仍有体验问题（部分流时长解析为 0、进度条无总长）。用户要求**下载时默认转成 mp3**，且**不借助 ffmpeg**。
- **方案**：内置转码管线 `downloader.rs::convert_m4a_to_mp3_builtin`：
  ```
  B站 DASH 音频流 → temp.m4a
      → symphonia 解封装 MP4 + 解码 AAC（i16 交错 PCM）
      → mp3lame-encoder（libmp3lame，LGPL，静态链接进 exe，无需外挂 DLL）
      → song.mp3（192kbps，采样率/声道取自解码器输出）
  ```
  - 转码成功：删除 temp.m4a；失败才回退保存 m4a（rodio 0.21 仍可播放）。
  - 曾试过纯 Rust 的 `shine-rs 0.1.3`（基于 shine 移植），但 `quantization.rs` 存在真实 bug（debug 下 i16 取负 overflow、release 下也 panic），放弃改用工业级 lame。
- **禁用系统 ffmpeg 检测**（v4.5.3）：`downloader.rs::find_ffmpeg` 不再查系统 PATH，仅查打包资源（当前未打包 → 恒返回 None），避免下载/转码行为依赖用户机器环境。未来若打包 ffmpeg 仍走原 ffmpeg 转码分支。
- **m4a 播放时长兜底**（v4.5.3）：`audio_player.rs` 的 `get_song_duration` / `play_song` 在 `total_duration` 为 0（分片 MP4）时，调用 `scan_estimate_duration` 全文件解码计数估算时长，保证进度条有最大值。
- **验证**：用真实下载的 `刚刚好.m4a`（10MB，B站 DASH）实测：内置转码出 6MB mp3（debug 模式 14s，release 更快），rodio 解码验证 sr=48000、时长 250.5s 正常。

### 4.14 同步听歌：DJ 全量状态同步 + P2P 传歌（v4.5.4）

- **DJ 状态同步改造**：DJ 播放操作（播放/暂停/切歌/上一首/进度/自然切歌）统一改发 `music:sync_state` 全量快照（`{ song_id, playing, position_ms, volume, transfer_mode }`），取代旧动作消息（play/pause/seek/next 兼容保留）。听众端 `applySyncState` 应用完整状态（切歌 + 播放状态 + 进度校准 + 音量 + 传歌方案），解决"DJ 只同步动作、不同步状态"与"新听众加入不知道 DJ 在播什么"的问题。
- **非 DJ 禁控**：同步听歌开启且非 DJ 时，`MusicPlayer.vue` 的 `controlsDisabled` 禁用全部控制按钮（歌单/上下首/播放暂停/进度/音量/模式），样式置灰。
- **P2P 传歌（服务器中转分片）**：听众缺歌 → `music:request_song` → 服务器选持有者（优先 DJ）→ `music:song_requested` → 持有者 Rust `music_read_song_chunk` 分片（128KB）→ `music:offer_song` → 服务器 `music:song_chunk` 转发 → 听众 `music_receive_song_chunk` 落盘 `app_data_dir/.transfer/` → `music:transfer_done` → `music_finalize_song` 合并进 `app_data_dir/music` 并刷新歌单。
- **两种传歌方案（DJ 面板切换，`settings.syncTransferMode` 持久化）**：
  - `immediate`（默认）：下完即播，seek 到 DJ 当前进度（开头可能缺几秒）
  - `wait_all`：服务器广播 `music:song_waiting` → DJ 暂停并提示"等待其他用户下载歌曲" → 全员就绪广播 `music:songs_ready` → DJ 从头播放
- **降级**：服务器未实现 P2P 时，`music:request_song` 无响应 → 播放器显示"⚠️ 无这首歌"。
- **服务器需求**（详见 `server-planning/API-implementation.md` 留言区）：sync_state 透传 + 快照补发、P2P 分片转发、wait_all 协调、WS 消息上限 ≥512KB。

### 4.15 同步听歌细节修复（v4.5.5）

实测发现并修复的 4 个问题：

1. **DJ 播放中不传歌、只显示"无这首歌"**：缺歌判断原为 `playlist.length > 0 && !includes(songId)`，听众刚进房间歌单未加载（length=0）时误走 `playSong` 失败分支，只设 `missingSongName` 不触发 P2P；等 DJ 暂停再广播时歌单已加载才传。**修复**：缺歌判断改为 `!playlist.includes(songId)`（空歌单也走 P2P 分支），且 `playSong` 失败兜底时也触发 `startSongTransfer`。
2. **非 DJ 不能调音量**：`controlsDisabled` 连音量一起禁用。**修复**：音量是本地输出，不受同步控制（DJ 调音量才广播），音量按钮/滑块/`handleVolumeInput` 移出禁用。
3. **DJ 上台瞬间所有听众的歌都开始放（而 DJ 暂停中）**：`applySyncState` 切歌分支无条件 `playSong` 播放，未尊重 DJ 的 `playing` 状态。**修复**：DJ 处于暂停（`playing=false`）时，听众切歌后 900ms 内自动暂停，只切歌不播放。
4. **传歌卡在"获取歌曲中 x%"**：三处加固——① `handleSongChunk` 单片保存失败自动重试一次；② `startSongTransfer` 请求发出 6s 无分片自动重发 `request_song`（幂等）；③ DJ 侧 `handleSongRequested` 加 `activeTransfers` 并发守卫（服务器"一传多"可能重复收到请求）+ 每片 15ms 节流，避免 170KB×N 消息瞬时堆积。
5. **传完/本地已有后曲名仍锁定显示"获取歌曲中 2%"**：`songTransfer` 状态因中断/未复位而残留时，曲名位置被传输提示永久占住（切到别的歌也如此）。**修复**：① `trackDisplay` 传输提示只在"当前没有歌在播放"（`!playing`）时占位——一旦有歌在播放（传完自动播放 / 手动切歌），曲名立即恢复正常显示，不被锁定；② store 增加传输兜底定时器（`ensureTransferWatch`）：requesting 超 20s / downloading 30s 无进展自动复位 `songTransfer`，避免永久占用（同步开启时启动、关闭时停止）。

### 4.16 同步听歌体验加固（v4.5.6）

用户实测反馈 5 个问题，逐一修复：

1. **DJ 切歌后这边没反应（旧传输挂死）**：P2P 卡顿重试耗尽后降级"无这首歌"是正常兜底，但 DJ 已切歌时旧传输状态残留，新歌的 `request_song` 被"同歌幂等"吞掉 → 完全无反应。**修复**：`startSongTransfer` 目标歌变化时先中断旧传输（复位 `lastChunkAt`/`transferRetry`），再启动新歌下载，旧歌分片由 `music_finalize_song` 同名覆盖清理。
2. **自习室抢 DJ 时崩溃/莫名掉线（心跳频率太低）**：业务心跳 `study_room_update_status` 仅 30s 一次且依赖 REST 轮询，经过代理/NAT 长时间无流量会被中间设备掐断。**修复**：① Rust `ws.rs` 增加协议层保活——每 10s 发 WS Ping 帧（tungstenite 自动回 Pong），与业务心跳解耦；② 业务心跳提到 15s 一次（`REFRESH_INTERVAL_MS` 30s→15s），每轮刷新都发 `studyRoomUpdateStatus`。
3. **加入已有 DJ 的同步听歌没反应（只能等 DJ 下台重来）**：服务器仅在 `room:join`/`request_dj` 时补发快照，客户端中途开启同步时拿不到当前 DJ 状态。**修复**：双兜底——① 未开启同步时缓存最近一次 `music:sync_state`（`lastSyncState`），开启同步立即应用；② 开启同步时主动发 `music:request_state` 请求服务器补发快照（需服务器配合，见协议文档留言区）。
4. **传歌卡在某百分比长时间无进展才报错**：旧逻辑 requesting 20s / downloading 30s 才判定超时，卡在 41% 要等很久。**修复**：超时阈值降为 **12s**（`TRANSFER_TIMEOUT_MS`），无进展自动重新下载，最多 **3 次**（`TRANSFER_MAX_RETRY`），多次机会但每次阈值低——每次超时 `transferRetry+1` 并重发 `request_song`，耗尽才降级"无这首歌"。
5. **从 DJ 下载的歌曲打上 DJ 名字标签**：`handleTransferDone` 合并成功后，若存在 `djName` 自动调用 `updateSongTag(songId, djName, null)`——B 从 A（DJ）处下载的歌，标签直接显示"A"。

**服务器配套需求**（已在 `server-planning/API-implementation.md` 留言区留言）：`music:request_state` 收到后向该客户端回发房间最近一次 `music:sync_state` 快照（附加 `timestamp_server`）；WS 心跳已由客户端自保，服务器侧空闲断连阈值建议调大。

### 4.17 immediate 模式下载后进度对齐 + 歌单刷新前误判缺歌（v4.5.6 补充）

发版前用户实测又发现 2 个问题，随 v4.5.6 一并修复：

1. **immediate 边下边播，下完从头播放（缺的不是开头是结尾）**：DJ 只在动作时广播一次 `sync_state`，进度并不持续广播。听众下载耗时越久，`pendingSyncPosition`（下载开始时暂存的 DJ 位置）就越过时，合并完成 seek 到旧位置 = 从头播放；DJ 切歌/自动下一首后这首直接被切掉。**修复（三层）**：① DJ 侧 `handleSongRequested` 传歌期间每 5s 广播一次 `sync_state`，听众 `pendingSyncPosition` 持续保持最新；② 听众合并完成后除 seek `pendingSyncPosition` 外，主动发 `music:request_state` 请求服务器补发最新快照校准（需服务器实现，见协议文档留言区）；③ 服务器未实现时回退到 ①② 的进度，至少是传输开始时刻的位置而非 0。
2. **DJ 暂停时听众显示"获取歌曲中…2%"，DJ 恢复才切回标题**：传输完成合并成功后歌单刷新（`requestPlaylist`）有延迟，期间 `playlist` 仍不含该歌；DJ 任何一次 `sync_state` 广播（如暂停）都会命中缺歌分支 → 重新触发 P2P → 又显示"获取歌曲中 2%"。**修复**：新增 `localHasSongs` 集合（模块级）记录"本地已确认存在的歌曲"——P2P 合并成功 / `playSong` 成功后加入；`applySyncState` / `applyMusicState` 缺歌判断改为 `!playlist.includes(songId) && !localHasSongs.has(songId)`，传输期间 `startSongTransfer` 从集合移除；`deleteSong` 成功时也从集合移除（本地真的删了，下次 DJ 播放需重新 P2P）。

### 4.18 刚下载完的歌暂停时仍显示"获取歌曲中 2%" + 本地已有歌误触发下载（v4.5.7）

v4.5.6 发布后用户实测仍有 2 个残留症状，根因与修法：

1. **刚下载完的歌在 DJ 暂停时显示"获取歌曲中 2%"**：`handleTransferDone` 合并成功后 `void playSong(songId)`（fire-and-forget），若 `playSong` 因文件刚合并/播放器未就绪而失败，旧逻辑 catch 分支自动 `startSongTransfer(songId)`，而 `startSongTransfer` 开头会 `localHasSongs.delete(songId)`（重新视为缺失）→ 重新发起下载；此时 DJ 暂停广播 sync_state 命中缺歌分支 → 显示"获取歌曲中 2%"。**修复**：`playSong` 失败不再自动触发 P2P 下载——缺歌场景本应由 sync_state 缺歌分支驱动 `startSongTransfer`，这里误触发只会删掉"本地已有"标记制造重复下载；播放失败保持已有标记，等下次 sync_state 驱动重播。
2. **本地已有的歌也触发下载**：`localHasSongs` 是内存集合，**应用重启后清空**；且歌单加载完成前（`handlePlaylist` 未执行）它一直为空。此时 DJ 播一首本地已有的歌 → `playlist` 空 + `localHasSongs` 空 → 误判缺歌 → 触发 P2P。**修复**：`handlePlaylist` 收到歌单时把**全部歌曲加入 `localHasSongs`**（歌单 = 本地真实存在的歌曲），应用重启后歌单一加载即恢复"本地已有"标记；配合 `deleteSong` 成功时移除，保证标记与本地文件一致。

### 4.19 传歌失败/重试可见性 + seek 校准容忍度 + WS 断开自动重连（v4.5.8）

用户实测反馈 4 个问题（前 2 个根因在服务器侧，已留言联调；后 2 个纯客户端修复）：

1. **传歌失败三阶段（% → 《歌名》 → 无这首歌）且重试几乎不成功**：客户端侧改进——`songTransfer` 新增 `retryCount`，超时重试时写入并在 UI 显示"（第 n/3 次重试）"，用户能明确看到在自动重试而非卡死；重试时复位 `lastChunkAt`。**根因疑似服务器**（重复 request_song 被忽略 / 传输状态未清理 / transfer_failed 未及时转发），已留言协议文档，待服务器确认后闭环。
2. **下载失败后从自习室掉出（其他客户端看到掉线，需退出重进）**：客户端侧防御——Rust `ws.rs` 连接断开时 emit `ws-disconnected`；`StudyRoom.vue` 监听后若在房间内，提示"连接断开，正在自动重连…"，3s 后自动：① `musicSyncRequestState()` 触发 Rust 重新建立 WS 连接；② 重新 `studyRoomJoin` 让服务器恢复成员关系；③ 刷新成员/排名。**根因疑似服务器**（P2P 传输失败触发未捕获异常断开用户 WS / 移除房间成员），已留言排查。
3. **已有 DJ 的房间开启同步后显示"DJ 暂无"（能听歌但 djName 空）**：`djName` 只在 `music:dj_changed`（DJ 切换）时更新，加入已有 DJ 房间时服务器未补发。**纯服务器需求**：`room:join` / `music:request_state` 时补发 `music:dj_changed { dj_user_id, dj_username }`（客户端已能处理，无需改代码）。
4. **DJ 切歌时听众听到 AABCD 重复开头（多次 seek 校准导致回跳）**：DJ 切歌/传歌期间广播 sync_state 较频繁（5s 一次），听众端每次收到都无条件 `seek(posSec)`，进度小偏差也被反复回跳。**修复**：新增 `SYNC_SEEK_TOLERANCE_S = 2` 容忍度与 `seekIfFar(target)`——`|本地进度 - 目标| ≤ 2s` 时不 seek，超过 2s 才校准；`applySyncState` / `applyMusicState` 的所有校准点（同歌分支、切歌后 800ms、pause/seek 动作）统一改用 `seekIfFar`。下载完成后的对齐（`pendingSyncPosition`）保持无条件 seek，不受容忍度影响。

### 4.20 下载完成后主动向 DJ 要实时位置（v4.5.8）

- **现象**：immediate 模式下下载完成不再从头播（v4.5.6 已修），但 seek 到的是"传输期间最后一次广播的位置"（DJ 传歌期间 5s 广播一次，最多落后几秒）→ 与 DJ 实际位置仍有差距
- **原因**：`musicSyncRequestState()` 服务器回发的是**服务器保存的快照**（也可能旧），不是 DJ 实时进度；且 `seekIfFar` 的 2s 容忍度遇到小差距不校准
- **修复（需服务器配合，已留言）**：
  - 服务器：收到 `music:request_state` 时若房间有 DJ → **向 DJ 单发 `music:state_request`**（新消息）；DJ 收到后立即广播一次实时 `music:sync_state`（含 `timestamp_server`）→ 请求者拿到 DJ 广播时刻的实时进度并 `seekIfFar` 校准
  - 客户端（已实现）：DJ 侧 `handleSyncWsEvent` 新增 `case "music:state_request"` → `broadcastSyncState()` 立即广播实时状态
- **触发点**：`musicSyncRequestState()` 已覆盖全部"要位置"场景——开启同步时、`handleTransferDone` 下载完成合并后、StudyRoom WS 断线重连时

### 4.21 服务器侧三项根因修复确认（v4.5.8，服务器回复 c99b841）

v4.5.8 在 `server-planning/API-implementation.md` 留言的三项服务器需求已全部处理上线，客户端本地验证通过后闭环：

1. **掉线问题（同用户多连接 bug，真根因）**：服务器排查确认无"传输失败即踢人"逻辑，但发现 `connections[user_id]` 是**单值 dict**——客户端重连/重开连接时新连接覆盖旧连接，旧连接线程退出时 `cleanup_user` 误 pop 到新连接 → 误从房间移除 + 广播 `member_left` → 其他端看到"掉线"。**修复**：连接建立时先清理旧连接（单连接语义），`cleanup_user` 只清理 socket 匹配的当前连接。实测二次连接后旧连接被服务器正确接管，房间成员/DB 清理正确。
2. **传输卡死（song_requests 永久悬挂）**：持有者收到 `song_requested` 但永不回传分片时状态悬挂。**修复**：① 30s 传输超时清理——超时后向请求者广播 `transfer_failed` 并清状态（覆盖客户端 12s×3 重试窗口）；② 重复 `request_song` 每次都重新选持有者重新触发 + 重置超时；③ 分片到达重置超时（活跃传输不误杀）。实测 60s 收到 failed（此前 65s 收不到）、重复请求每次触发、20s 活跃期不清理。
3. **DJ 信息补发**：`room:join` 和 `music:request_state` 时补发 `music:dj_changed`，实测均收到——解决"已有 DJ 的房间开启同步显示 DJ 暂无"（4.19 第 3 点）。
4. **`music:state_request` 配合确认**（4.20 服务器需求）：`request_state` 时有 DJ → 向 DJ 单发 `music:state_request`（DJ 广播实时进度）；无 DJ → 回发保存的快照。

**验证**：v4.5.8 五项验证全过 + 全部旧功能回归（P1/P2/wait_all/大消息/自习室/广播/双用户）通过；DB 无残留。服务器已保证单连接语义，客户端 WS 断线重连（4.19 第 2 点）不再误报 `member_left`。

### 4.22 P2P 断点续传 + DJ 切歌打断传输 + 自习室心跳加密（v4.5.9）

用户实测反馈 3 个问题（第 1 项部分根因在服务器，已留言联调）：

1. **传歌卡在某个进度后不再前进，重试是完全重传且再次卡同一位置**：用户经验——"只要卡住 3s 它就能卡住一辈子"。**修复**：① 超时阈值 12s → **3s**（`TRANSFER_TIMEOUT_MS`），检查间隔 10s → 1s；② 重试次数 3 → **10**（`TRANSFER_MAX_RETRY`，每次续传成本低）；③ **断点续传**——超时重试时 `music:request_song` 携带 `from_chunk`（`songTransfer.received` 已成功保存的分片数），Rust 命令 `music_sync_request_song` 新增 `from_chunk` 参数透传；DJ 侧 `handleSongRequested` 从 `evt.from_chunk` 继续读取回传（服务器需转发该字段，见协议文档留言区）。
2. **DJ 切歌应能打断 P2P 传输**（DJ 误触/快速切歌时旧歌继续下载完还会被播出来）：**修复**——新增 `abortCurrentTransfer()`；`applySyncState` / `applyMusicState` 的切歌分支（`songId !== trackName`）检测到正在传输的歌不是 DJ 当前歌时立即中断（置 idle + 清续传状态），旧歌残留分片由 Rust finalize 同名覆盖清理。
3. **自习室容易掉线，心跳够不够频？耗流量吗**：WS 心跳消息仅几十字节，几乎不耗流量。**修复**——心跳与数据刷新分离：`StudyRoom.vue` 新增独立 **5s 心跳定时器**（纯 `studyRoomUpdateStatus` 保活，防代理/NAT 掐断），成员/排名 REST 刷新保持 15s 不变；与 Rust 协议层 10s Ping 双保活。（服务器多连接 bug 已在 4.21 修复，此为防御性加固，需服务器确认心跳阈值兼容，见留言区）
4. **服务器补充：掉线疑似真根因——多线程并发写 socket 帧交错**（2026-08-01）：服务器校准线程 / 业务线程 / WS 主线程**同时对同一用户 socket 写帧**（无锁），TCP 层数据交错 → 客户端收到半个帧解析失败 → WS 异常断开 → 掉出自习室（"偶尔掉"的特征）。**服务器已修复**：每连接发送锁（send_to_user / broadcast_room / 响应 / ping 全串行化）+ `TCP_NODELAY`；并发压测 15s 177 帧 0 帧交错损坏。客户端侧无需改动（帧解析在 Rust tungstenite 层），心跳 5s + WS 断线自动重连（4.19）继续兜底。
5. **下载完成后弹到 DJ 位置又往回缩**（v4.5.9 补充，后改为时间戳方案）：传输期间 DJ 每 5s 广播 `sync_state`，下载合并完成瞬间**迟到的旧广播**（携带传输早期位置）陆续到达，会覆盖刚校准的新位置。**修复（广播新旧判定，按时间戳不按位置）**：`music:sync_state` / `music:state` 的 `timestamp_server` 由服务器转发时附加（可比较），新增 `lastSyncTs`——时间戳**更小的迟到旧广播直接忽略**（旧状态不覆盖新状态），时间戳更大的新广播正常应用；**与进度方向无关**（DJ 手动回退/前进都是新广播 ts 更大，都能正常生效，不做"只进不退"假设）。
6. **DJ 切歌时旧歌还在继续上传（切歌被下载拖住）**（v4.5.9 补充）：DJ 侧 `handleSongRequested` 上传循环原本会**传完整个文件**（几百片 × 15ms 节流 ≥ 5s）才停，切歌后旧歌分片仍持续发给服务器/听众。**修复（上传可打断）**：循环每片发送前检查 `songId !== trackName.value`（DJ 已切歌）→ 立即 `musicSyncTransferFailed` 中断并让服务器清理传输状态；节流 15ms → 5ms。听众端 `handleSongChunk` 本就按 `songTransfer.songName` 丢弃打断后的分片，配合服务器 30s 传输超时清理闭环。

**服务器回复确认（2026-08-01，dde25e3 已合并）**：
- **from_chunk 断点续传已实现**：`music:request_song` 带 `from_chunk` 时，转发给持有者的 `music:song_requested` 同样携带（实测 from_chunk=7 完整透传）；不带时协议兼容老客户端；**传输状态接管**——已有传输状态时新请求重置超时计时并重新选持有者重发（带 from_chunk），不会被旧状态挡掉；30s 传输超时维持（分片到达仍重置）
- **心跳频率确认无需改动**：服务器 `recv` 无超时、不主动断开任何频率的心跳连接，客户端 5s 业务心跳 + 10s 协议 Ping 均兼容（不会误踢高频，也不会过早清理低频）

### 4.23 歌单未加载误判缺歌 + 切歌打断下载不及时（v4.5.10）

用户反馈两个与"下载"相关的问题，根因同源：**下载相关路径都缺"当前目标歌/歌单状态"的特判**。

1. **本地明确已有的歌，第一次同步听歌也先触发下载**（下载到一半才"发现"有这首歌，放弃下载开始播放）：根因——**歌单是懒加载的**（只有点开播放列表面板才 `requestPlaylist`），进自习室开启同步时 `playlist` 仍是空数组 + `localHasSongs` 为空（重启后未填充），同步广播先到 → 空 playlist 被误判"缺歌" → 触发 P2P 下载；下载中歌单加载完成，`playlist`/`localHasSongs` 补齐后下一轮广播走 `playSong` 放弃下载。**修复**：
   - **三处提前加载歌单**：① `MusicPlayer.vue onMounted` 启动即 `requestPlaylist()`；② `setSyncEnabled(true)` 开启同步时预加载；③ `handlePlaylist` **首次加载完成**且同步已开启、非 DJ → 主动 `musicSyncRequestState()` 重取 DJ 最新状态（此前广播被守卫跳过，重取补对齐）。
   - **`playlistLoaded` 守卫**：`applyMusicState` / `applySyncState` 的切歌缺歌分支，`!playlistLoaded` 时直接 `return`——playlist 空数组不能判定缺歌，等歌单加载完成后再由重取状态/后续广播驱动（DJ 传歌期间每 5s 广播，不担心永久丢失）。
2. **切歌打断下载不及时，被同步端切歌时间与 DJ 有时差**：根因——**迟到的旧歌传输事件污染新状态**。DJ 切到 B 后，服务器转发的旧歌 A 的 `transfer_done` / `transfer_failed` 仍会到达听众端：`handleTransferDone` 原来不校验歌曲就 `finalize + playSong(A)`（"下载完播放旧歌"，把听众拽回 A）；`handleTransferFailed` 原来无条件复位传输状态 + 设 `missingSongName`（会打断正在进行的 B 传输、错误提示"无这首歌"）。**修复（按当前目标歌特判）**：
   - `handleTransferDone`：`songTransfer.songName !== songId` → 直接忽略（不 finalize、不播放旧歌）。
   - `handleTransferFailed`：正在传输其他歌（`songName !== songId`）→ 忽略不打断；复位仅限同歌；`missingSongName` 仅当失败歌曲是当前曲目时设置。
   - 配套：`handleTrackChange`（DJ 自然切歌）广播延迟 250ms → **100ms**，让听众端更快收到切歌、更快打断下载，缩小与 DJ 的时差。（`handleSongChunk` 本就有按 `songTransfer.songName` 丢弃分片的守卫，传输环节闭环。）

**测试**：music.test.ts 更新"歌单未加载时缺歌 → 不再触发 P2P"用例；新增 sync_state 未加载守卫、setSyncEnabled 预加载、handlePlaylist 首次重取、transfer_done/transfer_failed 旧歌迟到事件特判共 8 个用例（全量 52 文件 950 用例通过）。

### 4.24 音量记忆 UI 不一致 + 进度条超出最大值（v4.5.12）

用户反馈两个小 bug：

1. **音量记忆 UI 不一致**：退出时音量会被记忆（Rust 端 `AudioPlayer::volume` 持久化生效），但重启后 UI 音量条仍显示满格。根因——前端 `volume` 是持久化的本地值，**与实际播放音量脱钩**：历史版本里前端持久化丢了/被覆盖，而 status 事件从未携带音量字段，前端无法感知真实音量，只能显示初始值 `1.0`。**修复**：
   - Rust `PlayerSnapshot` 新增 `volume: f32`（实际播放音量 0.0-1.0），`music_status` 事件随 status 一起下发。
   - 前端 `handleStatus` 收到 `payload.volume` 即同步 `volume.value`（status 作为音量真相源）；`MusicStatus` 接口补 `volume?: number`。
   - 配套测试：Rust `test_snapshot_volume_reflects_set_volume`；前端 handleStatus 带/不带 volume 两用例。

2. **进度条超出最大值**（4.5.10 起偶发，多见于新歌 P2P 下载之后）：进度条当前时间超过歌曲时长（>100%）。怀疑链：新歌加载与 DJ 广播时序错位（加载歌曲与 DJ 报告歌曲不一致）+ 多条 DJ 信息同时进入（DJ 操作过快或 P2P 下载期间旧信息堆积）→ 刚加载好新歌时旧 DJ 的 seek/进度覆盖新歌，跳到越界位置。**修复（DJ 信息跳转的"原子锁"替代方案，多防线覆盖）**：
   - `seekIfFar`：目标超过当前歌曲时长 → 直接忽略不跳转（旧 DJ 信息不干扰新歌）。
   - `seek()`：目标钳制到 `[0, duration]`（前端 + Rust `AudioPlayer::seek` 双侧钳制）。
   - `handleProgress`：`currentTime > duration` 防御性钳制回 `duration`。
   - `progress` getter：钳制到 100%（最后一层兜底）。
   - `music_seek` 命令 seek 完成后 emit 的 `current` 改为 `player.get_position()`（真实位置）——seek 目标被钳制后若回传传入参数会得到越界值（进度条超界的直接触发点之一）。
   - 歌曲切换路径本就带 `songId` 匹配（v4.5.10）+ `timestamp_server` 新旧判定（v4.5.9），配合超界忽略形成闭环；无需真正的互斥锁，状态机语义已覆盖。

**测试**：music.test.ts 新增 7 用例（handleStatus 音量同步 ×2、seek 钳制 ×2、seek 时长内透传、applySyncState DJ 越界位置忽略、handleProgress 钳制、progress getter 钳制 100%）；Rust 新增 snapshot 音量用例。前端全量 958 用例通过。

---

## 5. 最终布局结构清单

### 5.1 三行结构（`.music-player__main`，`flex-direction: column; gap: 6px`）

```
┌─────────────────────────────────────────────────────────────┐
│ 第 1 行 .music-info（顶部信息行）                            │
│  ┌────┐ ┌─────────────────┐ ┌──┐ ┌──┐ ┌──┐                 │
│  │🎵 │ │ 曲名（flex:1）   │ │🔊│ │🎧│ │📋│                 │
│  └────┘ └─────────────────┘ └──┘ └──┘ └──┘                 │
│         music-player__track  vol  dev  playlist             │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ 第 2 行 .music-progress（进度条行）                          │
│  ┌──────┐ ┌─────────────────────────────┐ ┌──────┐         │
│  │ 0:32 │ │██████████░░░░░░░░░░░░░░░░░░│ │ 3:45 │         │
│  └──────┘ └─────────────────────────────┘ └──────┘         │
│   time      bar(fill + handle)              time            │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ 第 3 行 .music-controls（底部控制行，justify-center）        │
│  ┌──┐         ┌────┐ ┌──────┐ ┌────┐         ┌──┐          │
│  │📊│(abs L)  │⏮  │ │▶/⏸  │ │⏭  │         │🔀│(abs R)    │
│  └──┘         └────┘ └──────┘ └────┘         └──┘          │
│  charts       prev    play     next           mode          │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 各按钮位置与尺寸

| 按钮           | 所在行         | 位置             | 尺寸      | 样式类                 |
| -------------- | -------------- | ---------------- | --------- | ---------------------- |
| 🎵 曲名图标    | 第 1 行        | 最左             | 14px      | `.music-icon`          |
| 曲名文本       | 第 1 行        | 左 2，flex:1     | 12px      | `.music-player__track-name` |
| 🔊 音量按钮    | 第 1 行        | 右 3             | 24×24 圆形 | `.music-btn`（基础）   |
| 🎧 设备按钮    | 第 1 行        | 右 2             | 24×24 圆形 | `.music-btn`           |
| 📋 播放列表按钮 | 第 1 行        | 最右             | 20×20 圆形 | `.music-btn--small` + `.music-playlist-btn` |
| 当前时间       | 第 2 行        | 最左             | 36px 宽   | `.music-progress__time` |
| 进度条         | 第 2 行        | 中间，flex:1     | 高 4px    | `.music-progress__bar` |
| 总时长         | 第 2 行        | 最右             | 36px 宽   | `.music-progress__time` |
| 📊 榜单按钮    | 第 3 行        | 绝对定位 left:0  | 20×20 圆形 | `.music-btn--small` + `.music-charts-btn` |
| ⏮ 上一首       | 第 3 行        | 中间左           | 32×32 圆形 | `.music-btn--prev`     |
| ▶/⏸ 播放       | 第 3 行        | 中间居中         | 38×38 圆形 | `.music-btn--play`     |
| ⏭ 下一首       | 第 3 行        | 中间右           | 32×32 圆形 | `.music-btn--next`     |
| 🔀 模式按钮    | 第 3 行        | 绝对定位 right:0 | 20×20 圆形 | `.music-btn--mode`     |

### 5.3 浮层（绝对定位，向上弹出）

| 浮层             | 锚点容器        | 定位                          | z-index | 触发按钮       |
| ---------------- | --------------- | ----------------------------- | ------- | -------------- |
| 音量拨动条       | `.music-volume` | `bottom: 100%; left: 50%`     | 1000    | 🔊 音量按钮    |
| 输出设备列表     | `.music-info`   | `bottom: 100%; right: 0`      | 9999    | 🎧 设备按钮    |
| 播放列表面板     | `.music-player__main` | `bottom: 100%; right: 0` | 9999    | 📋 播放列表按钮 |

### 5.4 z-index 层级总表

| 元素                          | z-index | 所在层叠上下文       | 说明                            |
| ----------------------------- | ------- | -------------------- | ------------------------------- |
| `.music-player`（根容器）     | 200     | `.main-content`      | 高于 HeaderButtons(100)/ModeSlider(50)/sidebar-collapse-btn(10) |
| `.music-collapse-btn`         | 10      | `.music-player` 内部 | 最低，正常态不遮挡内容          |
| `.music-volume__slider`       | 1000    | `.music-player` 内部 | 高于收起按钮(10)，调音量时临时遮住收起按钮 |
| `.music-device__list`         | 9999    | `.music-player` 内部 | 设备弹框，浮层最高              |
| `.music-playlist`             | 9999    | `.music-player` 内部 | 播放列表弹框，与设备弹框同级    |

### 5.5 收起状态结构

- `.music-player.collapsed .music-wrapper { max-height: 0; overflow: hidden }`：主体塌陷。
- `.music-player__collapsed`（绝对定位 `bottom: 0`，律动条 + 曲名）：展开态 `opacity: 0; visibility: hidden`，收起态 `opacity: 1; visibility: visible`。
- 律动条 `.music-visualizer`：4 个 3px 宽的竖条，`playing` 类时 `animation: visualizerBounce 0.8s ease-in-out infinite`，每条延迟 0.15s。
- 收起按钮图标 `▼` 旋转 180° 变 `▲`。

---

## 6. 命令与事件说明（Rust 原生）

### 6.1 前端 → Rust（Tauri invoke）

| invoke 命令                | 参数                              | 返回                              | Rust 实现                       |
| -------------------------- | --------------------------------- | --------------------------------- | ------------------------------- |
| `music_toggle_play`        | 无                                | `void`                            | `AudioPlayer::toggle_play`      |
| `music_next`               | 无                                | `void`                            | `AudioPlayer::get_next_song`    |
| `music_prev`               | 无                                | `void`                            | 历史表回溯                       |
| `music_seek`               | `{ seconds: number }`             | `void`                            | `AudioPlayer::seek`（try_seek） |
| `music_set_volume`         | `{ volume: number }`（0-1）       | `void`                            | `AudioPlayer::set_volume`       |
| `music_set_play_mode`      | `{ mode: "shuffle"\|"order"\|"loop" }` | `void`                            | `AudioPlayer::set_play_mode`    |
| `music_get_status`         | 无                                | `void`（事件回传）                | 快照 + `music-status`           |
| `music_get_playlist`       | 无                                | `void`（事件回传）                | `refresh_playlist` + `music-playlist` |
| `music_get_devices`        | 无                                | `void`（事件回传）                | `AudioPlayer::list_devices`     |
| `music_set_device`         | `{ deviceId: number }`            | `void`                            | cpal 设备切换                    |
| `music_play_song`          | `{ songName: string }`            | `void`                            | `AudioPlayer::play_song`        |
| `music_delete_song`        | `{ songName: string }`            | `{ success, error? }`             | 删除文件 + 刷新列表              |
| `music_get_custom_tags`    | 无                                | `{ success, customTags }`         | 读 `tags.json`                   |
| `music_add_custom_tag`     | `{ tagName, color }`              | `{ success, error? }`             | 写 `tags.json`                   |
| `music_delete_custom_tag`  | `{ tagName }`                     | `{ success, error? }`             | 写 `tags.json`                   |
| `music_update_tag`         | `{ songName, tag, color: string\|null }` | `{ success, error? }`             | 写 `tags.json`                   |

### 6.2 Rust 命令内部行为（无子进程，直接操作 AudioPlayer）

- `toggle_play`：翻转播放状态（rodio `Sink` pause/play），发 `music-play-state`
- `next`/`prev`：`get_next_song`（shuffle 用 `choose` 随机）/ 历史表回溯，成功后发 `music-track-change`
- `seek`：优先 `Sink::try_seek`（不重建 sink）；失败降级 `skip_duration` 重建，发进度
- `set_volume`：更新音量（0-1 clamp）→ 音频流增益，发 `music-volume-change`
- `set_play_mode`：更新模式，shuffle 重置随机历史，发 `music-play-mode`
- `get_status` / `get_devices` / `get_playlist`：读当前状态/枚举 cpal 设备/扫描目录，发对应事件
- `set_device`：切换 cpal 默认输出设备，失败发 `music-play-error`（提示重启）
- `play_song`：`play_song(name, 0.0)`，解码失败返回 `song_missing` 错误
- 标签类（`update_tag`/`add_custom_tag`/`delete_custom_tag`/`get_custom_tags`）：读写 `app_data_dir/music/tags.json`

### 6.3 进度上报与自动切歌（`spawn_progress_task`）

- tokio 后台任务，每 200ms：
  - `Sink::get_pos()` → `music-progress`（带曲名，前端按名过滤过期事件）
  - 检测 `is_song_ended() && is_playing()` → 自然结束 → `get_next_song(true)` 自动播下一首；失败按 `song_missing` / `play_error` / `no_music` 分发事件

---

## 7. 常见问题排查

### 7.1 前端 invoke 报 "command not found"

- **检查**：`src-tauri/src/lib.rs` 的 `invoke_handler(tauri::generate_handler![...])` 是否列全了所有 `music_*` 命令。
- **修复**：补全缺失的命令注册，重启 `npm run tauri dev`。

### 7.2 播放器无任何反应、播放器未初始化

- **检查**：
  1. `music/` 目录下是否有音频文件（支持 `.mp3/.m4a/.flac/.wav/.ogg`）。
  2. Rust 日志是否有 `ensure_init` 失败（如输出设备不可用、解码器缺失）。
  3. `MusicState.initialized` 是否已置位（首次 `ensure_init` 成功后）。
- **修复**：放入音频文件；检查系统默认输出设备是否可用（被其他应用独占时 rodio 打开失败）。

### 7.3 设备列表弹框被裁剪

- **检查**：`.main-content` 是否设了 `overflow: hidden`。
- **修复**：改为 `overflow: visible`，或把播放器移到不带裁剪的祖先节点下。详见 4.4。

### 7.4 播放错误："播放失败，请切换输出设备后重启番茄钟"

- **根因**：rodio 播放失败（输出流打开失败/解码异常），`music-play-error` 事件触发。
- **修复**：
  1. 打开 🎧 设备列表，切换到另一个输出设备。
  2. 重启番茄钟（重新初始化音频输出流）。
  3. 检查系统音频设备是否被占用（其他应用独占）。

### 7.5 歌曲消失提示

- **现象**：播放器显示"⚠️ 原歌曲已消失"。
- **根因**：`music/` 目录下的当前歌曲文件被外部删除，`AudioPlayer::play_song` 解码失败返回 `song_missing`，`spawn_progress_task` 自动切到下一首可用歌曲。
- **修复**：无需手动处理——自动跳转下一首；全部消失时发 `music-no-music`，前端显示"无音乐"。

### 7.6 音量调节无效果

- **检查**：
  1. 滑块值是否传到 Rust（DevTools Console 看 invoke 调用）。
  2. Rust `set_volume` 是否更新音量（stderr 日志）。
  3. 系统混音器是否静音。
- **修复**：重启番茄钟；检查默认输出设备是否有效（rodio 增益作用于当前 Sink）。

### 7.7 收起/展开动画卡顿

- **检查**：`.music-wrapper` 的 `max-height` 是否设得过大（如 9999px），过渡时间会按比例拉长。
- **修复**：`max-height` 设为刚好覆盖内容的值（300px），过渡 0.45s。

### 7.8 播放列表不刷新

- **检查**：点击 🔄 刷新按钮是否触发 `store.requestPlaylist()`。
- **修复**：`music_get_playlist` 命令调用 `AudioPlayer::refresh_playlist` 重新扫描目录，确保 `music/` 目录有变更后再点刷新。

### 7.9 标签颜色不生效

- **检查**：`music/tags.json` 中歌曲条目是否为 `{"name": "学习", "color": "#64b4ff"}` 新格式；旧格式（纯字符串）由 Rust 端兼容处理。
- **修复**：通过 `music_update_tag` 命令重新设置标签，Rust 端写入新格式。

### 7.10 快捷键冲突

- **现象**：媒体键（播放/暂停、上一首、下一首）与其他应用冲突。
- **根因**：`tauri_plugin_global_shortcut` 注册的全局快捷键可能被系统/其他应用抢占。
- **修复**：快捷键冲突时由系统裁决（不强制抢占），检查其他媒体控制软件（如播放器、语音助手）是否占用媒体键。

---

## 附录：迁移要点速查

1. **Rust 原生播放**：音频由 `modules/audio_player.rs`（rodio + cpal + symphonia）直接播放，无 Python 子进程、无 stdin/stdout。
2. **前端只管 UI**：所有播放操作走 `invoke` → Rust `music_*` 命令 → 直接操作 `AudioPlayer`。
3. **事件驱动**：前端通过 `useTauriEvent` 注册监听，Store 的 `handle*` 方法更新状态；事件全部由 Rust 层 `app.emit`。
4. **同步命令**：需要返回值的命令（删除/标签）由命令函数直接返回 `Result`，Tauri IPC 同步回传。
5. **样式对照旧版**：`electron/src/styles/music-player.css` 是权威参考，迁移时类名从 kebab-case 改为 BEM（`.music-device-list` → `.music-device__list`），但布局结构与尺寸完全对齐。
6. **z-index 规划**：`.music-player` 200，内部弹层 9999，音量拨动条 1000，收起按钮 10。
7. **三行结构**：信息行 → 进度条行 → 控制行，中间按钮居中，左右按钮绝对定位。
8. **收起动画**：`max-height` 过渡 + `opacity/visibility` 配合，0.45s `cubic-bezier(0.5,0,0.5,1)`。
9. **音乐目录**：开发模式 `<project_root>/music-player/music/`，生产模式 `app_data_dir/music`（安装/更新不覆盖，见 4.1）。
