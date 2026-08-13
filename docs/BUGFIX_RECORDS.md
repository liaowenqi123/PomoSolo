# Bug 修复记录

本文档记录项目开发和迭代过程中修复的所有重要Bug。

---

## 2026-08-13

### 19. 服务器域名迁移到 api.pomogrow.top + CI 双推安装包（v4.7.11）

**背景**：原服务器用 IP（`http://115.159.49.112`）+ HTTP；域名 `pomogrow.top` 备案通过后，统一迁移到 `https://api.pomogrow.top`（HTTPS），并让 CI 构建完成后同时上传安装包到 GitHub 和服务器（服务器↔GitHub 线路慢/不通，只能从本地 runner 双推）。

**实现**：
1. 客户端：`SERVER_URL` → `https://api.pomogrow.top`，更新源 `latest.json` / `latest-beta.json` / `notice.json` 全切到 `api.pomogrow.top`，WS 走 `wss://api.pomogrow.top/ws`；
2. CI（`.github/workflows/ci.yml`）：打 tag 时从本地 runner 生成服务器版 `latest.json`（url 指向 `api.pomogrow.top`）并 scp 安装包 + 签名 + `latest.json` 到服务器 `/home/ubuntu/frontend/updates/`（新增 `SERVER_HOST` / `SERVER_USER` / `SERVER_SSH_KEY` secrets）；
3. 证书：certbot 签发覆盖 `pomogrow.top` + `api.pomogrow.top` 的证书，deploy hook 自动续期复制 + 重启容器（停用原 1Panel DNS 续期 + `sync-le-cert.sh`，避免旧证书覆盖）。

### 18. 新增「一键预处理全部歌曲」统一旧歌响度（v4.7.10）

**背景**：v4.7.10 起下载时才对音乐做响度归一化，旧版本已下载的 mp3/m4a 响度仍不一致。

**实现**（`src-tauri/src/commands/charts.rs` + `modules/downloader.rs` + `Charts.vue`）：
1. 后端 `preprocess_all_songs` 命令：遍历 music 目录所有 mp3/m4a，逐首 decode → 响度归一化 → 重编码为 mp3（192kbps），并 emit `preprocess-progress`（current/total/name）进度事件；
2. 复用 `normalize_audio_to_mp3`（原 `convert_m4a_to_mp3_builtin`，改为按扩展名探测，symphonia 增加 `mp3` 解码特性）；
3. 前端 `Charts.vue` 工具栏新增「🎚 统一响度」按钮，点击后显示逐首进度（N/M + 曲名），完成后 toast 汇总成功/失败数。

### 17. 下载页面「单首一直 loading」改为任务队列 + 虚假进度条（待发版）

**实测场景（用户）**：下载歌曲时单首一直 loading，用户看不到进度、无法连续下载，体验差。

**修复**（前端，`src/stores/downloadQueue.ts` + `DownloadDialog.vue` + `Charts.vue`）：
1. 新增 Pinia 队列 store：多首可排队、串行下载，每首显示状态（排队/下载中/完成/失败）；
2. 每首配一条「虚假进度条」——随时间约 +1%/秒前进、封顶 90%，任务真正完成才跳到 100%，把"正在处理"的情绪价值给到用户（不反映真实阶段，避免瞬时步骤一闪而过）；
3. `DownloadDialog` 由「单首下载」改为「下载队列」弹窗，榜单下载与手动下载都进同一队列；关闭弹窗后下载仍在后台继续。

### 16. 音乐响度不一致——下载时内置 RMS 归一化（纯 Rust，无 ffmpeg）（待发版）

**实测场景（用户）**：B站抓取的音乐每首响度不一，有的太响、有的太轻（拉满音量仍觉得轻）。

**方案**：下载转码阶段预处理，把整段 PCM 规整到统一响度；纯 Rust 内置实现，不引入 ffmpeg loudnorm（保持"无外挂二进制"的设计，解码也用内置 symphonia）。

**实现**（`src-tauri/src/modules/downloader.rs`）：
1. `convert_m4a_to_mp3_builtin` 由单遍流式「解码→编码」改为两遍：先解码全部为 i16 交错 PCM，再做响度归一化，最后分块编码；
2. 新增 `compute_loudness_gain`（单遍整数累加平方和+峰值，避免逐样本 f64）：目标 RMS -14 dBFS（偏响，用户可随时调小音量），增益限幅 [-12, +18] dB，并做削波保护；
3. 新增 `apply_gain` 施加线性增益 + 限幅防溢出。

**性能**：归一化预处理（RMS+增益）实测约 248ms（debug，4 分钟立体声 21.2M 样本），release 约 1/10；相对下载+转码（秒级）可忽略。

### 15. 音乐下载偶发「未找到音乐」（B站搜索无重试）（待发版）

**实测场景（用户）**：点下载偶发提示「未找到音乐」，多点两下就能成功；怀疑当时网络抖动/没连上网。

**根因**：`search_bilibili` 把任何失败（请求失败 / HTTP 非 2xx / 空响应 / JSON 解析失败 / API code!=0）都 `return Ok(Vec::new())`，被调用方判为「无结果」→ 前端提示「未找到相关视频」。网络抖动时单次失败即误判，且无重试。

**修复**：拆出 `search_bilibili_once`（失败返回 Err，仅 code==0 返回 Ok），`search_bilibili` 对其做 3 次重试（退避 500ms/1000ms），重试耗尽才返回空。新增单测覆盖。

### 14. 签到周视图跨自然周残留旧勾（改为「最近 7 天」滚动窗口）（待发版）

**实测场景（用户）**：上周日签过到，到了下周周日那格仍打勾；今天一签到，表切到这周，旧勾又消失。

**根因**：`weekRecords` 按星期几（0=周日..6=周六）固定索引，只有「断签」才清零，跨自然周更替时不重置，导致上周勾残留；前端又按「周一~周日」固定重排，切周时视觉混乱。

**修复**：`weekRecords` 语义改为「最近 7 天」滚动窗口（index 0 = 6 天前 … index 6 = 今天），新增 `weekStartDay` 锚点；每次签到按天数差滚动窗口（`roll_week_records` 纯函数），跨周自然滚动不再残留。前端 `GardenSignin.vue` 的 `weekDots` 改为「今天永远是最后一位」。新增 Rust 单测 + 前端测试更新。

### 13. 签到偶发点击无反应（前后端时区不一致）（待发版）

**实测场景（用户）**：番茄中菜园签到偶尔点击无反应，用户未反馈具体原因。

**根因**：签到「今天」判定用 UTC——前端 `canSignInToday` 用 `toISOString()`（UTC 日期），后端 `today_date_string()`/`week_day_index()` 也用 UTC。UTC+8 凌晨 0:00–7:59（本地已是新一天，UTC 仍停在前一天）时，前端 UTC 日期与 `lastDate` 相等 → `canSignInToday=false` → 按钮禁用、点击无反应（实际本地已该签到）；若只改前端不改后端，又会因后端仍按 UTC 记昨天，导致同一本地日重复签到。

**修复**：后端引入 `time` crate（`local-offset`），`today_date_string`/`date_string_offset`/`week_day_index` 全部改用本地时区；前端 `canSignInToday` 改用本地日期字符串（`getFullYear/getMonth/getDate` 拼 YYYY-MM-DD），与后端对齐。

## 2026-08-08

### 12. 前台警告第三次文案误导 + 缺少诚实使用呼吁（v4.7.9）

**实测（用户）**：第三次警告的提示文案「再点'知道了'将触发惩罚！」措辞有误导（"再点"暗示还有下一次），而实际逻辑是第 3 次点"知道了"立即惩罚；另外警告弹窗缺少对"不是娱乐"按钮的诚实呼吁——该按钮会触发误判纠正（黑名单关键词移白名单 / 历史记录标记"不是"），影响应用对窗口的判断。

**修复**（`ForegroundWarning.vue`）：
1. 第三次警告文案改为「**本次点击"知道了"将触发惩罚！**」，与"第 3 次点击即惩罚"逻辑一致；
2. 警告内容区新增诚实使用呼吁文案：「请诚实使用专注工具：只有真正回到专注状态时才点击『不是娱乐』。随意虚报会误导检测判断，让应用无法准确守护你的专注。」

### 11. 菜园子界面不实时更新——枯萎/生长/救活需重启才可见（跨窗口数据同步缺失）（v4.7.9）

**实测场景（用户）**：专注模式被中断、作物枯萎后，菜园子窗口仍显示正常作物，界面不更新；重启应用才看到枯萎（用户多次枯萎后才发现）。同源问题还包括：专注中作物生长进度不实时刷新、完成番茄钟救活枯萎作物后界面不变。

**根因**：旧版（Electron）主进程每个 garden 操作完成后向菜园子窗口发 `garden-refresh` IPC 通知（见 `docs/GARDEN_DATA_ARCHITECTURE.md`「IPC 处理器」一节），菜园子窗口收到后重新加载数据渲染。**Tauri 迁移时漏掉了这条跨窗口数据同步**：惩罚/生长/救活都由主窗口触发（前台检测、计时器 tick、专注完成），数据经 Rust 写盘后常驻的菜园子窗口（独立 WebView）毫无感知，只有重新打开窗口（`onMounted` → `load()`）或重启应用才刷新。

**修复**（恢复旧版"操作后通知-菜园子重载"机制，对应 `garden-refresh`）：
1. **Rust 端** `src-tauri/src/commands/garden.rs`：新增 `notify_garden_refresh(&app)`（`app.emit("garden-refresh", ())`），在四个"主窗口/计时器外部触发"的 garden 命令写盘后广播：`garden_punishment`（惩罚枯萎）、`garden_record_focus`（专注完成救活/中断）、`garden_grow`（每分钟生长）、`garden_unlock_easteregg`（彩蛋发奖）。菜园子窗口自身发起的操作（种植/收获/商店/签到等）本地已 `applyResult` 刷新，无需广播。
2. **前端** `src/components/garden/GardenMain.vue`：`onMounted` 注册 `listen("garden-refresh")` → `store.load()` 重新拉取渲染；`onUnmounted` 清理监听。

**验证**：`cargo check` 通过（仅原有 warnings）、`vue-tsc` 零错误、前端 1159 测试全过、`vite build` 成功。

### 10. 传歌百分比越界（200w%/112%）+ reverse 并行反复从 0 重传 + 曲名反向滚动（v4.7.8）

**实测场景（用户）**：① P2P 测试/传歌显示的百分比涨到 200w% 这种巨大数字；② P2P 传歌稳步传到一半突然卡住 → P2P 直连标签消失 → 从 0 开始（无标签）→ 又变 P2P（又从 0）→ 又变服务器中转（又从 0）→ 服务器中转超 100%（112%）→ 突然跳 0% 无标签；③ P2P 直传模式下曲名滚动"反向滚动"。

**① 百分比越界（展示层 + 计数层双修）**
- **展示**：`MusicPlayer.trackDisplay` 的 `pct = received/total*100` 无钳制。跨通道切换/多次重启传输后 `received` 会累计超过 `total`（服务器中转 112% 的直接原因；极端累积时即 200w%）。修复：`Math.max(0, Math.min(100, ...))` 钳制，`total<=0` 显示 0%。
- **计数**：`received` 语义统一为"当前传输会话已保存分片数"并**钳制到 total**——正向 P2P（`setupP2PReceive`）、并行 reverse（`tryReverseReceive`）、服务器中转（`handleSongChunk`）三处 `received` 都改为 `min(received+1, total)`；P2P→服务器回退时 `received/total` 归零（服务器从头重发分片）。

**② reverse 并行传歌反复从 0 重传（多线程没写好的核心根因）**
- **根因**：`tryReverseReceive` 并行 K 条连接，**任一条 `onError` 即 `finish(false)` 整体从 0 重启**。实测场景（汤圆 4.7.6 旧持有端不认 parallel）：下载端 K=2 并行 offer，旧持有端只有 1 个 answerer → 连接 A 被匹配并**传完全部数据**（用户看到"稳步在传"），连接 B 的 offer 无匹配被丢弃 → 10s 建连超时 → `onError` → `finish(false)` → **已传完的数据整体弃掉，从 0 重传** → 又走 K=1 重试 → 失败 → 服务器中转（同样从 0）→ 循环。
- **修复**（`tryReverseReceive` 重写）：
  1. **收齐即完成**：`globalTotal`（文件全局分片总数）确定后，`received >= globalTotal` 即 `finish(true)` 合并——不等全部 K 条连接完成，死连接的迟到 onError 被 `settled` 守卫忽略；
  2. **单条失败不弃整体**：改 `failedCount`，全部 K 条失败（或全部完成+失败但分片未收齐）才回退单连接 reverse → 服务器中转；
  3. **新增协议字段 `meta.globalChunks`**：持有端在每条段的 meta 声明文件全局分片总数（权威值），接收端启动即知真实总数——否则各段 meta 只带段数、取 max 估算，段间 meta 到达时序不同时可能**提前合并出残缺文件**（旧持有端不携带 → 退回 max 估算，单连接场景估算即真实总数，安全）。
- **P2P 重试语义**：正向 P2P 重试仍从 0 重发（P2P 无续传），但并行容错修好后重试不再频繁触发。

**③ 曲名"反向滚动"**
- **根因**：传输状态文本（"⏳ 获取歌曲中… x%（第 N 次续传）"）每收一片就变化 → `trackDisplay` watch → `updateTrackOverflow` 频繁改 `--track-marquee-end`/`isTrackOverflow` → 动画目标/内容抖动、`active` class 反复摘挂导致动画**重启回跳到起点** → 表现为"反向滚动"。
- **修复**：传输状态展示期间**不做 marquee**（`isTransferStatus` 判定，仅真实曲名——稳定文本——启用滚动）；`--track-marquee-end` 照常更新保证恢复曲名后立即可用。

**测试**：前端 +6（music store：并行单条失败不立即回退×2、旧持有端单连接场景收齐即合并且迟到失败不重启、received 钳制；MusicPlayer：百分比越界钳 100%；p2p：buildMeta/parseMeta globalChunks 往返）。1161 全过、vue-tsc 零错误。

### 9. 种子 P2P 下载卡死（0 进展/永久"准备下载"）+ reverse 传歌 2-5% 中断（v4.7.7）

**实测场景**：汤圆(4.7.6 种子) → cici(4.7.5 下载端) 种子更新：显示"正在从汤圆直连下载..."但无进度条、始终"准备下载"，P2P 能打洞却不下数据；同时 reverse 传歌传 2% 或 5% 就断、变服务器中转（正向 10MB/s 丝滑，反向慢/断）。

**根因一：`sendFile` 的 `dc.send` 无 try/catch + 无背压 → 发送端静默死亡（核心根因）**
- DataChannel 发送快于对端消费时 `bufferedAmount` 持续增长，超过实现上限后 `dc.send()` 抛 `OperationError`（Chromium 行为）。异常被顶层 async 吞掉（`void beginSend()` 无 catch）→ 发送端**静默停止**：无 onError、无 cleanup、通道不关 → 对端收不到数据也收不到错误 → 永久等待（种子 0% 卡死 / 传歌 2-5% 中断的同一根因）。
- **修复**：`sendFile` 每片改走 `sendWithBackpressure`——缓冲 >512KB 先等 `bufferedamountlow` 排空再发（防缓冲满抛错）；任何 `dc.send` 异常 → `onError` + `cleanup`（发送端不静默死亡，对端可及时回退）。meta 发送同样加 try/catch。

**根因二：建连成功后无任何超时兜底 → 永久挂起**
- `pc.connectionState === "connected"` 时 `clearTimeout(timeoutTimer)`（建连超时），但之后**没有任何超时机制**——数据因任何原因不到/中断就永久挂起，UI 卡"准备下载"无进度。
- **修复**：新增"无进展超时"（`progressTimer`，默认 30s，调用方可传 `progressTimeoutMs` 缩短）：channel open 即启动，每收/发一片重置；超时无进展 → `onError` + `cleanup`，由调用方回退（种子 → reverse → 服务器/GitHub）。音乐传歌传 15s（能通但慢速不误杀，死链尽快重试）。

**根因三：种子下载 offer 竞态 → 正常方向 offer 被丢弃**
- `trySeedDownload` 里 `await seedFetch(...)` 之后才 `p2pReceive(...)`：种子端收到请求后读片+发 offer 可能比本机下一行执行 p2pReceive 还快 → offer 早到被 `handlePeerSignal` 以"无挂起接收"丢弃，正常方向白费。
- **修复**：先挂 `p2pReceive` 再 `seedFetch`（offer 未达仍由 10s 等待超时兜底）。

**根因四：3s 传歌看门狗误杀"能通但慢"的反向传输**
- `ensureTransferWatch` 3s 无进展即断点续传；续传 `from_chunk>0` 时 DJ 侧 `tryP2PTransfer` 直接跳过 P2P 走服务器中转 → 反向每片间隔稍长（>3s）就被掐断转服务器。
- **修复**：P2P 直连期间（`channel==="p2p"`）看门狗不介入，死链改由 p2p 层 15s 无进展超时判定，走重试/反向/服务器完整链。

**根因五：reverse 传歌一次中断立即回退服务器，无重试**
- `tryReverseReceive` 的 onError 直接 `channel="server"`，P2P 不稳定时不给机会（与正常方向 P2P_RETRY_LIMIT=3 不一致）。
- **修复**：reverse 同样重试上限 3 次（`p2pReverseRetryCount`），曾成功建连但中断 → 重新通知 DJ 反打，上限内不回退服务器中转。

**影响范围**：`src/p2p.ts`、`src/stores/music.ts`、`src/components/SettingsPanel.vue`

**新增：P2P 测试工具升级为"3 种打洞方式 × 双向测速 = 6 项"（v4.7.7）**
- 一次点击跑 6 项测试：A 打洞（本机 offerer）、B 打洞（对端 offerer）、AB 互相打洞（两端同时各打一条连接），每种打洞方式建立的管道再分别测上行（A→B）与下行（B→A）。
- p2p.ts 新增：
  - `tag` 连接标签：同一对端并发多条连接（AB 互相打洞 = A offerer + B offerer 两条同时），信令 payload 带 tag，路由键 `peerId:tag`（缺省空 = 单连接，向后完全兼容）。
  - `mode: "duplex-test"` 双向测速：同一连接上 offerer 先推一程 → `duplex_switch` → 对端推一程 → `duplex_done`；回调 `onDirection`（self/peer）+ `onDuplexComplete`。
- 新信令 `p2p:bidir_test_request`（Rust 命令 + ws_server.py 转发）：目标端收到后同时挂 answerer(tag1) + 发起 offerer(tag2)。
- 面板 UI：3×2 结果矩阵 + 结论（三种打洞方式双向总吞吐对比，标记洞质量最高者，验证"双方同时狂暴发包"是否更稳定）。

**新增：reverse 传歌多连接并行传输（v4.7.7，绕开单连接 SCTP 流控窗口）**
- 背景：同一对机器正向 10MB/s、反向巨慢——物理路径非瓶颈，瓶颈是 Chromium SCTP 对单条连接的流控窗口（固定小窗口 + 对端延迟 SACK ~200ms）。
- 方案：文件按分片均分 K 段（默认 2，上限 4），reverse 时下载端建 K 条并行连接（tag p0..pK-1），持有端按段在各自连接上发数据——每条连接独立 SCTP 流控窗口，总吞吐 ≈ K × 单条。
- p2p.ts：meta 新增 `baseChunk`（本连接全局起始分片序号，缺省 0=单连接整文件，向后兼容）；`onChunk` 第 4 参透传 baseChunk；接收端按全局 index 落盘（part 文件按全局 index 写，天然支持交错到达，无需 Rust 改读写）。
- 协商：reverse 请求带 `parallel`（Rust `p2p_reverse_transfer_request` + ws_server.py 转发）；旧持有端忽略该字段 → 下载端并行连接超时后自动回退单连接 reverse，单连接也失败才回退服务器中转（两级降级）。
- 影响范围：`src/p2p.ts`、`src/stores/music.ts`、`src/api/musicSync.ts`、`src-tauri/src/commands/p2p.rs`、`server-planning/ws_server.py`

**测试：** 前端 58 文件 1157 用例通过（新增：dc.send 抛错 → onError+清理不静默死亡、建连成功无数据 30s 超时 onError、缓冲超阈值等 bufferedamountlow 背压不中断、同 peer 多 tag offer 路由、duplex offerer/answerer 双向切换、meta baseChunk 往返、并行分段 onChunk 携带 baseChunk、reverse 并行失败回退单连接再回退服务器、reverse 并行收齐合并）；vue-tsc 通过；Rust 全量通过。

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
