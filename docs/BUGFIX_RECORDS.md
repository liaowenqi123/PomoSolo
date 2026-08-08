# Bug 修复记录

本文档记录项目开发和迭代过程中修复的所有重要Bug。

---

## 2026-08-08

### 8. P2P reverse 反向打洞 + 下载后播放出现 1s+ 预期外延迟（v4.7.6）

**问题一：P2P reverse 反向打洞不稳定 / 无法反向传播**
- **描述**：正常方向（持有端作 offerer）打洞失败时，reverse 反向打洞不稳定，且用户质疑"洞打起来了谁往谁传应该无所谓的吧"。
- **根因（判断错误已纠正）**：WebRTC DataChannel 建立后是**全双工**的，谁持有数据谁 `send()`，与谁创建连接无关。但代码把"发送逻辑"绑死在了 `isOfferer`（`wireChannel` 里 `if (isOfferer) void beginSend()`）——reverse 时持有端作 answerer，channel 收到后**不会发数据**，传输卡死。
- **解决**：
  - `P2PStartOptions` 新增 `sender?: "offerer" | "answerer"`，解耦"协商发起方"与"数据发送方"：`isSender = sender==="offerer" ? isOfferer : !isOfferer`，`wireChannel` 的 onopen/onmessage/onclose/onerror 全部按 isSender 判定。
  - reverse 传输：下载端作 `role:"offerer" + sender:"answerer"`（只打洞收数据），持有端作 `role:"answerer" + sender:"answerer"`（在收到的 channel 上发数据）。
  - `onComplete` 改按 isSender 判定延迟清理：reverse 时接收端（offerer）延迟 500ms 清理，防掐断 answerer 侧发送端收 ack。
  - 新增信令 `p2p:reverse_transfer_request`（Rust 命令 + ws_server.py 转发）：音乐传歌传 songId（`setupReverseServe`），安装包分享传 version（`serveReverseInstaller`）；下载端 `tryReverseReceive` 正常方向失败后反打一次（`p2pReverseTried` 防重复）。
  - 更新下载 reverse 兜底：`trySeedDownload` 正常方向失败 → 通知种子端挂 answerer+sender → 本机 offerer 反打，仅一次，失败才回退服务器/GitHub（`settled` 防迟到 onError 打断）。
  - P2P 曾建连成功但中断 → 重试上限 3 次（`P2P_RETRY_LIMIT`）而非立即回退服务器中转。
- **影响范围**：`src/p2p.ts`、`src/stores/music.ts`、`src/components/SettingsPanel.vue`、`src/seed.ts`、`src/api/musicSync.ts`、`src-tauri/src/commands/p2p.rs`、`src-tauri/src/lib.rs`、`server-planning/ws_server.py`

**问题二：下载后播放延迟比直接播放大得多（1s+，预期外）**
- **描述**：不需要下载时同步延迟可接受；一旦走下载路径，播放延迟明显变大（可能 1s 甚至以上）。要求"就算下载一年半，也不应该影响播放时的同步"——预期内 = seek 延迟，预期外 = 下载路径多出的延迟。
- **根因**：`finalizeTransfer` 合并完成后**串行等待一次 `music:request_state` 网络往返**（听众→服务器→DJ→服务器→听众，4 段网络链路 + DJ 处理）才由 `applySyncState` 切歌；随后又有 800ms 固定等待才 seek。下载路径 = 网络往返 + 播放器加载 + 800ms ≈ 1s+。
- **解决**（合并后立即起播 + 并行精调）：
  - 缺歌分支新增 `pendingSyncRaw`（暂存最近一次 DJ 广播的 position_ms / dj_server_time / ts / playing 原始数据）。
  - 合并完成时用 `pendingSyncRaw` 按服务器时钟重算 DJ 当前进度（`position_ms + (serverNow - dj_server_time)`），**立即** `playSongAt(songId, targetSec)` 起播——Rust 新增 `music_play_song_at` 命令，`play_song` 的 skip_duration 直接从目标位置起播，无"从头播再 seek"的爆音。
  - 并行 `musicSyncRequestState()` 精调：sync_state 到达后同歌分支 `seekIfFar`（带 2s 容忍度，位置相近不跳，无感）。
  - 播放同步只取决于 seek 延迟，与下载时长完全无关；DJ 暂停中则起播后立即暂停（尊重 DJ 状态）。
- **影响范围**：`src-tauri/src/commands/music.rs`、`src-tauri/src/lib.rs`、`src/api/music.ts`、`src/stores/music.ts`

**测试：** Rust 276 passed；前端 58 文件 1149 用例通过（新增：reverse answerer+sender 发数据、offerer+sender:answerer 只收不发、reverse 失败回退、reverse 成功直接合并、下载完成即播 playSongAt 重算位置）。

---

## 2026-08-02

### 7. 同步听歌：下载完成后跳回 2s/3s 从头播放（P2P 下载后偶发，v4.5.10 起）（v4.5.13）

**问题描述：**
- DJ 有歌在播（如 22s），A 用户没歌正在 P2P 下载；下载完成瞬间 A 正确跳到 DJ 进度（22s），但一小段时间后（约 200ms）A 又跳回 2s/3s"继续播放"

**根因（两层，缺一不可）：**
1. **播放器侧（Rust 误判"播完"自动切歌）**：`handleTransferDone` 下载完成立即 `playSong`（从头播）+ 800ms 后 `seek(22)` 校准 + 请求 DJ 状态后 `seekIfFar(22)` 再校准——播放器被多次驱动。而 Rust `AudioPlayer::seek` 的 `sink.try_seek` 对 `SkipDuration<Amplify<Decoder>>` 不支持 → fallback `play_song(name, 22)` 用 `skip_duration(22s)` **惰性**跳过（sink 拉取时逐帧解码丢弃前 22 秒样本）。**跳过期间 `sink.empty()` 为 true**，200ms 进度任务的 `is_song_ended()`（原实现就是 `sink.empty()`）误判"歌曲播完" → 自动 `play_song(next, 0)` 切到歌单下一首从头播 → 前端收到 track-change → 进度从 0 走到 2s/3s。
   - **为什么"一定是 P2P 下载后"**：本地已有歌切歌时 seek 校准目标 ≈ 0-3s（skip 快，<200ms 不触发误判）；P2P 下载完成后校准目标是 DJ 当前进度（如 22s，skip 解码丢弃需 >200ms）→ 恰好落入误判窗口。且下载完成有两条校准路径几乎同时触发，连续两次 seek(22) 放大概率。
2. **前端侧（动作堆积/多次驱动）**：下载完成的校准（800ms 定时 seek）+ DJ 回发 sync_state 的 seekIfFar + DJ 广播并发，无串行锁，多次 seek/playSong 交错驱动播放器。

**解决方案：**
1. **Rust `is_song_ended` 加位置保护**：`sink.empty()` 且播放位置已接近歌曲末尾（`>= duration - 2s`）才判定播完；`duration==0` 保持旧行为。skip_duration 惰性跳过窗口（位置=position_offset << duration）不再误判自动切歌。
2. **下载与播放分离（前端 `handleTransferDone`）**：合并完成后**不立即 playSong**，播放器保持暂停"无感"；请求 DJ 实时状态，等 sync_state 回发后由 applySyncState **一次性**切歌 + 校准（3s 兜底定时器：服务器不回时本地播放 + 校准）。
3. **DJ 操作串行队列（前端 `runDjOp`，用户要求的"原子锁"）**：所有播放器副作用（切歌 playSong / 播放暂停 togglePlay / 进度校准 seek）统一入队串行执行——带时间戳（ts <= 已处理最新 → 丢弃）；一次只做一个操作（锁）；执行中到达的新操作堆积为"最新操作"（ts 最大者，中间舍去）；执行完记录已完成时间戳，队列中更新操作继续执行，否则整队丢弃。seekIfFar 用 ts=-1（只串行不参与新旧判定，避免本地时间与服务器时间戳偏差误丢 DJ 广播）。

**影响范围：**
- `src-tauri/src/modules/audio_player.rs`、`src/stores/music.ts`、`src/stores/__tests__/music.test.ts`

**测试：** Rust 新增 `test_is_song_ended_without_sink_returns_false`（190 passed）；前端新增 4 用例（下载与播放分离 ×2、队列最新优先 + 中间舍去、迟到旧广播过滤），全量 52 文件 962 用例通过。

---
### 6. 音量记忆 UI 不一致：退出记忆的音量不显示在 UI（v4.5.12）

**问题描述：**
- 上次退出时的音量会被记忆（Rust 端播放器 `volume` 持久化生效），但重启后 UI 音量条仍显示满格
- 根因：前端 `volume` 是本地持久化值，与实际播放音量脱钩——status 事件从未携带音量字段，前端无法感知真实音量

**解决方案：**
- Rust `PlayerSnapshot` 新增 `volume: f32`（实际播放音量），随 `music_status` 下发
- 前端 `handleStatus` 收到 `payload.volume` 即同步音量（status 作为音量真相源）

**影响范围：**
- `src-tauri/src/modules/audio_player.rs`、`src-tauri/src/commands/music.rs`、`src/api/music.ts`、`src/stores/music.ts`

---
### 5. 进度条超出最大值（4.5.10 起偶发，新歌 P2P 下载后多见）（v4.5.12）

**问题描述：**
- 进度条当前时间超过歌曲时长（>100%），怀疑新歌加载与 DJ 广播时序错位 + 多条 DJ 信息同时进入（DJ 操作过快或 P2P 下载期间旧信息堆积）

**解决方案（多防线钳制，DJ 信息跳转"原子锁"替代方案）：**
- `seekIfFar`：目标超当前歌曲时长 → 忽略不跳转（旧 DJ 信息不干扰新歌）
- `seek`：目标钳制 `[0, duration]`（前端 + Rust 双侧）
- `handleProgress`：`currentTime > duration` 钳制回 duration；`progress` getter 钳制 100% 兜底
- `music_seek` 命令 emit 的 `current` 改用 `player.get_position()` 真实位置（seek 目标钳制后回传传入参数会得越界值）

**影响范围：**
- `src/stores/music.ts`、`src-tauri/src/modules/audio_player.rs`、`src-tauri/src/commands/music.rs`

---
### 4. 自动更新 404：latest.json 的 url 指向旧版本安装包（v4.5.11）

**问题描述：**
- 用户检查更新报 `Download request failed with status:404 Not Found`
- 根因链：本地固定 `CARGO_TARGET_DIR` 共享目录里残留 v4.5.10 安装包 → upload-artifact 的 `*.exe` 通配符把 4.5.10/4.5.11 两个版本一起传进 artifact → Release job 里 `ls installer/*.exe | head -1` 按字典序取到 **4.5.10**（4.5.10 < 4.5.11）→ latest.json 的 `url`/`signature` 指向 4.5.10 → 清理多余 asset 后该 url 404

**解决方案：**
1. 手工修复 v4.5.11 release 的 latest.json（url/signature 改回 4.5.11）
2. ci.yml 根治：
   - Generate latest.json 改为按版本号精确匹配 `installer/PomoSolo_${VERSION}_x64-setup.exe`，禁止 `ls|head -1`，并校验文件存在
   - Clean NSIS bundle dir 步骤**不要显式指定 `shell: powershell`**——conda 注入 $PROFILE 的初始化失败会导致步骤假失败（exit 1，虽实际清空了目录）；用默认 shell 正常
   - 构建前清空 NSIS bundle 目录，杜绝旧版本残留
3. **手工上传 latest.json 必须用无 BOM 的 UTF-8**（`[System.Text.UTF8Encoding]::new($false)`）：PowerShell 默认 `[Text.Encoding]::UTF8` 写 BOM，tauri 的 serde_json 解析带 BOM 的 JSON 报 `error decoding response body`（v4.5.11 手工修复时踩过，线上已重传无 BOM 版）；CI 的 bash 写法无此问题

**影响范围：**
- `.github/workflows/ci.yml`

---
### 3. 🎲 随机按钮 hover 旋转导致左右横向滚动条（v4.5.11）

**问题描述：**
- 房间名输入框旁的 🎲 按钮 hover 时 `transform: rotate(15deg) scale(1.05)`，旋转/缩放使按钮视觉外接矩形横向变宽，超出可滚动容器边界 → 出现左右横向拖动条

**解决方案：**
- 弃用旋转/缩放，hover 改为 `translateY(-2px)` + 外发光阴影（`box-shadow`），active 改为 `scale(0.92)` 缩小，均不产生横向溢出，保留"会动"的手感

**影响范围：**
- `src/components/StudyRoom.vue`

---
### 1. 本地明确已有的歌，第一次同步听歌也先触发下载（v4.5.10）

**问题描述：**
- 应用重启后第一次开始同步听歌，DJ 播的第一首歌**本地明明有**，却先触发 P2P 下载，下载到一半"发现"有这首歌，放弃下载开始播放

**原因分析：**
- 歌单是懒加载的（只有点开播放列表面板才 `requestPlaylist`），进自习室开启同步时 `playlist` 仍是空数组、`localHasSongs` 为空
- 同步广播先于歌单到达 → 空 playlist 被误判"缺歌" → 触发 P2P 下载；下载中歌单加载补齐后，下一轮广播改走 `playSong` 放弃下载

**解决方案：**
1. `MusicPlayer.vue onMounted` 启动即 `requestPlaylist()` 预加载歌单；`setSyncEnabled(true)` 开启同步时也预加载
2. 新增 `playlistLoaded` 标志：`applyMusicState` / `applySyncState` 缺歌分支在歌单未加载时直接 `return`，空数组不判定缺歌
3. `handlePlaylist` 首次加载完成且同步已开启、非 DJ → 主动 `musicSyncRequestState()` 重取 DJ 最新状态对齐

**影响范围：**
- `src/stores/music.ts`、`src/components/MusicPlayer.vue`

### 2. 切歌打断下载不及时，被同步端切歌时间与 DJ 有时差（v4.5.10）

**问题描述：**
- DJ 切歌后，旧歌的迟到传输事件（`transfer_done` / `transfer_failed`）污染听众端新状态：旧歌 `transfer_done` 会 finalize 并**播放旧歌**（听众被拽回旧歌）；旧歌 `transfer_failed` 会复位正在进行的**新歌**传输并误报"无这首歌"

**原因分析：**
- `handleTransferDone` 不校验当前传输目标歌就 finalize + playSong；`handleTransferFailed` 无条件复位传输状态 + 设 `missingSongName`

**解决方案：**
- `handleTransferDone`：`songTransfer.songName !== songId` → 忽略
- `handleTransferFailed`：正在传别的歌 → 忽略；`missingSongName` 仅当失败歌曲是当前曲目时设置
- `handleTrackChange` 广播延迟 250ms → 100ms，听众更快收到切歌、更快打断下载

**影响范围：**
- `src/stores/music.ts`

---

## 2026-04-10

### 1. 父进程崩溃后子进程残留

**问题描述：**
- 当番茄钟主进程被强制关闭时，music.exe 和 foreground_inspection.exe 会残留
- 残留进程占用资源，需要手动清理

**原因分析：**
- Python子进程的 stdin_reader 线程检测到stdin断开后无法通知主线程退出
- 主线程在播放/检测循环中阻塞，无法及时响应退出信号

**解决方案：**
1. 前台检测：用 requests 替换 openai 包，减少打包体积（从1GB+降至~12MB）
2. stdin_reader：捕获stdin断开（EOF），线程自然结束
3. 主线程：定期检查 stdin_thread.is_alive()，线程死亡则退出
4. music播放器：在播放循环和暂停等待循环中都检查线程存活状态

**影响范围：**
- `foreground_inspection/foreground_inspection.py`
- `music-player/music.py`

---

## 2026-04-04

### 1. 前台检测警告弹窗无法正确置顶

**问题描述：**
- 第一次触发娱乐前台检测时，警告弹窗不能正确抢占到最顶层
- 用户可能看不到警告，导致惩罚机制失效

**原因分析：**
- Windows窗口管理器在首次执行 `setAlwaysOnTop` 和 `bringToFront` 时需要预热
- 第一次调用可能存在时序问题，窗口还未完全渲染就执行了置顶操作

**解决方案：**
- 在 `foregroundDetection.js` 中添加 `warmUpBringToFront()` 预热函数
- 应用启动时快速执行一次显示/隐藏 + 置顶/取消置顶流程
- 确保后续的真实置顶操作能正常工作

**影响范围：**
- `src/scripts/modules/foregroundDetection.js:155-169`

---

### 2. 计时器后台运行时时间不准确

**问题描述：**
- 当应用最小化或切换到后台时，计时器会出现时间偏差
- Electron的后台节流机制导致 `setInterval` 执行频率降低

**原因分析：**
- Chromium浏览器会对后台标签页进行节流优化
- `setInterval` 在后台可能被延迟执行，导致累积误差

**解决方案：**
- 使用时间戳计算真实流逝时间，而非依赖 `setInterval` 的执行次数
- 在 `timer.js` 中引入 `timerStartTime` 和 `pausedElapsedTime`
- 每次tick通过 `Date.now() - timerStartTime` 计算真实经过的秒数

**影响范围：**
- `src/scripts/modules/timer.js:74-77, 208-210, 226-269`

---

### 3. 音乐播放器播放无响应时缺少错误提示

**问题描述：**
- Python子进程可能因为音频设备问题而卡死
- 用户点击播放后没有任何反馈，不知道是否成功

**原因分析：**
- 缺少对Python端响应的超时检测机制
- 用户无法区分"正在加载"和"完全失败"

**解决方案：**
- 在 `musicPlayer.js` 中添加 `startPlayTimeout()` 超时检测
- 如果3秒内未收到Python响应，自动显示错误提示
- 收到Python响应后立即清除超时计时器

**影响范围：**
- `src/scripts/modules/musicPlayer.js:40-41, 75-110, 1004-1009`

---

### 4. 菜园子数据在不同窗口间不同步

**问题描述：**
- 主窗口和菜园子窗口同时打开时，数据可能不一致
- 在一个窗口的操作不会立即反映到另一个窗口

**原因分析：**
- 两个窗口各自维护一份数据缓存
- 缺少跨窗口的数据同步机制

**解决方案：**
- 在关键操作前强制从文件重新读取最新数据
- `garden.js` 的 `loadGardenData(true)` 支持强制刷新
- `handleResetPunishment()` 中自动调用强制刷新

**影响范围：**
- `src/scripts/modules/garden.js:157-178, 620-622`

---

### 5. 计划模式切换时状态丢失

**问题描述：**
- 从单次模式切换到计划模式再切回来，之前的时间和状态会重置
- 用户体验不流畅

**原因分析：**
- 模式切换时没有保存和恢复状态
- 每个模式的状态是独立的，缺少状态管理机制

**解决方案：**
- 在 `timer.js` 中实现 `modeStates` 对象保存各模式状态
- 添加 `saveState()` 和 `restoreState()` 方法
- 切换模式时自动保存当前状态并恢复目标模式状态

**影响范围：**
- `src/scripts/modules/timer.js:82-115, 557-594`

---

### 6. 音量调节快捷键与滑块冲突

**问题描述：**
- 使用键盘方向键调节音量时，音量滑块也会响应
- 造成意外的UI行为

**原因分析：**
- HTML range input 默认会响应键盘事件
- 与Python端的快捷键控制产生冲突

**解决方案：**
- 在 `musicPlayer.js` 中禁用音量滑块的键盘事件
- 只保留鼠标拖动和滚轮操作
- Python端快捷键继续正常工作

**影响范围：**
- `src/scripts/modules/musicPlayer.js:1071-1075`

---

### 7. AI计划生成中途关闭弹窗导致状态混乱

**问题描述：**
- AI正在生成计划时关闭弹窗，再次打开时仍显示加载状态
- 之前的请求完成后会覆盖新的请求结果

**原因分析：**
- 异步请求没有唯一标识，无法区分新旧请求
- 关闭弹窗时没有清理进行中的请求

**解决方案：**
- 引入 `currentRequestId` 递增ID机制
- 每次新请求时递增ID，只有当前ID匹配的响应才处理
- 关闭弹窗时清空所有内容和状态

**影响范围：**
- `src/scripts/modules/aiHelper.js:10-11, 47-49, 153-162, 170-181`

---

### 8. 删除预设按钮在只剩一个时仍可点击

**问题描述：**
- 当预设列表只剩一个项目时，删除按钮仍然可用
- 删除后列表为空，导致界面异常

**原因分析：**
- 缺少对列表长度的判断
- 没有设置最小数量限制

**解决方案：**
- 在 `planMode.js` 的 `render()` 中检查 `planList.length === 1`
- 只剩一个项目时隐藏删除按钮
- 保证列表至少有一个项目

**影响范围：**
- `src/scripts/modules/planMode.js:24, 59-60, 82-89`

---

## 历史版本

更多早期版本的Bug修复记录请参考Git提交历史。
