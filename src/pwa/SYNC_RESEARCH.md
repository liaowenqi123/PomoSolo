# 同步听歌对齐机制调研报告（PWA）

> 部门：PWA部门 —— 2026-08-15
> 任务来源：用户指出"只同步 DJ 动作并不能保证结果一致"（例：本地已有歌、中途加入同步听歌，
> DJ 说开始播放时听众可能不在同一位置起播），要求先调研（查文档 → 读桌面端原始实现），实现放最后。

## 1. 文档线索（已找到）

| 文档 | 内容 |
|---|---|
| `docs/BUGFIX_RECORDS.md` | 同步听歌系列 bug 与解法（见下），**就是本问题的权威记录** |
| `docs/STUDY_ROOM_ARCHITECTURE.md` §4 | 同步听歌机制总述：听众端 `position = position_ms + (Date.now() - timestamp_server)` 校准跟播 |
| `server-planning/EXTERNAL-INTERFACES.md` | WS 协议：`music:state` / `music:sync_state`（含 `dj_server_time` 字段） |
| `server-planning/API-implementation.md` | 服务端：`music:request_state` 需补发最近一次 sync_state 快照 |

`BUGFIX_RECORDS.md` 与本问题直接相关的条目：
- **下载延迟不影响同步**：缺歌分支暂存 `pendingSyncRaw`（position_ms / dj_server_time / ts / playing）；
  合并完成时按服务器时钟重算 DJ 当前进度**立即起播**（`playSongAt`，skip_duration 直接跳目标位置），
  并行 `musicSyncRequestState()` 精调；"播放同步只取决于 seek 延迟，与下载时长无关"。
- **下载完成后跳回 2s/3s 从头播放**：① Rust `is_song_ended` 加位置保护（播到接近末尾才算播完）；
  ② 下载与播放分离——合并后不立即 play，请求 DJ 状态由 `applySyncState` 一次性切歌+校准（3s 兜底）；
  ③ **DJ 操作串行队列 `runDjOp`（"原子锁"）**：时间戳新旧判定 + 一次一个 + 堆积最新。
- **本地已有歌第一次同步却误触发下载**：歌单懒加载导致空 playlist 误判缺歌 → 修复为
  `onMounted`/`setSyncEnabled` 预加载歌单 + `handlePlaylist` 首次加载完成且非 DJ 时主动
  `musicSyncRequestState()` 重取 DJ 状态对齐。
- **切歌打断下载不及时**：DJ 切歌时中断旧歌传输（applyMusicState/applySyncState 里 abortCurrentTransfer）。

## 2. 桌面端完整机制（src/stores/music.ts + src-tauri，精读结论）

针对"中途加入同步听歌位置不一致"这一场景，桌面端的完整解法链：

### 2.1 开启同步时的"动作补充"（setSyncEnabled(true)）
1. `measureClockOffset()`：3 次 ping→pong 取 RTT 最小一次测**本地与服务器时钟偏移**，
   之后 `serverNow() = Date.now() + offset`（本地偏差几百 ms 会听出不同步）；
2. `requestPlaylist()` 预加载本地歌单（空 playlist 会被误判"缺歌"触发 P2P 下载）；
3. 若房间内服务器已补发过 `sync_state`（`lastSyncState` 快照）→ 立即 `applySyncState`；
4. **`musicSyncRequestState()` 主动向服务器请求当前状态**——服务器补发最近一次
   sync_state，听众据此恢复"DJ 正在播的歌 + 进度 + 播放状态"，**不用等 DJ 下一次动作**；
5. `handlePlaylist` 首次加载完成且同步开启、非 DJ → 再 `musicSyncRequestState()` 补一次
   （广播可能早于歌单到达被守卫跳过）。

### 2.2 进度校准（applySyncState / applyMusicState）
- `pos = position_ms + (serverNow() - dj_server_time)`（dj_server_time 覆盖
  DJ→服务器→听众全链路延迟；退回 `timestamp_server`）；
- `lastSyncTs` 新旧判定：时间戳更小的迟到广播直接丢弃；
- 播放器副作用统一入 `runDjOp` 串行执行（原子锁）：
  - 带 ts 的操作：`ts <= 已处理最新 → 丢弃`；执行中堆积"最新操作"（ts 最大者，中间舍去）；
  - `seekIfFar` 用 `ts=-1`：只串行、不参与新旧判定（避免本地/服务器时间戳偏差误丢广播）；
  - 校准带 **2s 容忍度**（`SYNC_SEEK_TOLERANCE_S`），位置相近不跳；目标越界（旧歌信息）直接忽略。

### 2.3 下载与播放分离（finalizeTransfer，immediate 模式）
- 合并完成不立即从头 play；用 `pendingSyncRaw` 重算 DJ 当前进度
  `targetSec = (position_ms + (serverNow - base))/1000`，`playSongAt(songId, targetSec)`
  **直接从目标位置起播**（Rust skip_duration 跳过前 N 秒样本，无"从头播再 seek"的爆音）；
- DJ 暂停中则起播后立即暂停（尊重 DJ 状态）；
- 并行 `musicSyncRequestState()` 精调（applySyncState 同歌分支 seekIfFar）；
- 3s 兜底定时器：服务器不回 state 时本地播放 + 校准。

### 2.4 周边
- 听众端禁自动切歌（`applyAutoNext`），播完保持等待、由 DJ sync_state 驱动；
- Rust `is_song_ended` 位置保护：`sink.empty()` 且接近歌曲末尾才判定播完（防 skip 窗口误判）；
- `playlistLoaded` 守卫：歌单未加载不判缺歌。

## 3. PWA 复用情况与差距分析（关键结论）

**音乐 store（src/stores/music.ts）是原样复用的** → 2.1~2.4 的机制（measureClockOffset /
requestState / applySyncState / runDjOp / seekIfFar / pendingSyncRaw / playlistLoaded 守卫 /
autoNext）**全部随 store 自动进入 PWA**，不需要重写。PWA 需要的是"引擎能力等价"：

| 桌面端能力 | PWA 现状（src/pwa/music/engine.ts + commands） | 结论 |
|---|---|---|
| `music_play_song_at`（skip_duration 跳 N 秒起播） | `engine.play(name, startSec)`：设 src → loadedmetadata 后 `currentTime=startSec` → play | ✅ 已实现，等价于"直接定位起播"，无"从 0 播再 seek" |
| seek（`music_seek`） | `engine.seek(sec)` → `audio.currentTime` | ✅ |
| `is_song_ended` 位置保护（防 skip 窗口误判播完） | 引擎只在真实 `ended` 事件触发切歌；seek 不产生伪 ended | ✅ **天然规避**（HTML5 Audio 无"惰性解码跳过"窗口） |
| 时钟偏移测量（ping→pong ×3） | `cmdMusicSyncMeasureTimeOffset` 已 shim（RTT 最小） | ✅ |
| `music:request_state` | `cmdMusicSyncRequestState` 已 shim | ✅（依赖服务器支持，见 §4） |
| 进度 stale-filter | store.handleProgress 的 name 过滤，引擎 progress 带 name | ✅ |

**PWA 特有风险点（实现阶段要验证）**：
1. `engine.play(name, startSec)` 时序：`audio.play()` 的 resolve 时机 vs `loadedmetadata`
   里设置 currentTime —— 需保证 **loadedmetadata（currentTime 已设）之后再 play()**，
   避免极端情况下先播 0 再跳（当前实现 pendingStartSec 在 loadedmetadata 设置，基本安全，需联调确认）。
2. seek 后浏览器 `currentTime` 异步生效，progress 可能瞬时回跳 → store 的 2s 容忍度 + stale-filter 兜底。

## 4. 结论与后续动作（实现放最后）

- **机制层**：桌面端解法已通过 store 复用进入 PWA，无需移植。
- **待办（按优先级，等用户确认时机再做）**：
  1. 微调 `engine.play` 保证"先定位再播放"的时序确定性（一行级改动，联调时验证）；
  2. 与服务器部门联调验证：加入房间 → `music:request_state` 补发 → `applySyncState`
     位置对齐；P2P 下载完成 → `pendingSyncRaw` 起播位置正确；
  3. 服务器端确认 `music:request_state` 已实现（否则加入时对齐依赖下一次 DJ 广播，体验打折）。
