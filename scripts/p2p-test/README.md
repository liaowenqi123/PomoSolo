# 多客户端传歌测试（无需启动多个客户端）

在**不启动任何 GUI 客户端**的前提下，用 N 个**虚拟客户端**经**真实服务器**跑完
传歌的**整条链路**：认证 → 连 WS → 建房/进房 → 申请 DJ → 广播状态 →
`request_state` 对齐 → 缺歌检测 → 请求下载（**P2P 直连优先，失败回退中转**）→
收齐 → **SHA-256 逐字节校验** → 下载后重对齐。

## 为什么需要它

传歌横跨多段：**DJ 读分片 →（P2P 直连 或 服务器中转）→ 听众重组 → 完整性 → 进度重对齐**。
手工验证要开两个客户端 + 建房间 + 请求 DJ + 切歌，成本极高且**不可重复**；
出问题时也无法区分是"持有者发得慢""服务器中转慢""P2P 没打通"还是"接收端慢"。

虚拟客户端说的是**真协议**——消息名与字段逐条对照客户端实现：

| 协议 | 权威来源 |
|------|---------|
| `music:*` 线协议 | `src-tauri/src/commands/music_sync.rs` |
| 信封 `{ type, ...params }` | `src-tauri/src/modules/ws.rs` 的 `send()` |
| 持有端路径选择逻辑 | `src/stores/music.ts` 的 `handleSongRequested`（P2P 门控/去重/5s 广播） |
| P2P 线协议（DataChannel） | `src/p2p.ts`（控制消息 JSON + 4 字节大端 index 分片） |
| 契约文档 | `server-planning/EXTERNAL-INTERFACES.md` |

所以它测的是**真实服务器 + 真实客户端都会走的路径**，不是一套只在测试里成立的假协议。

## 用法

```bash
cd scripts/p2p-test
npm install            # 首次：装 werift（Node 的 WebRTC）+ ws

node auth.js 4                          # 确认服务器可达 + 自动注册 4 个测试账号
node transfer-test.mjs --scenario all   # 跑全部自动化场景（约 90s）
```

单独跑某个场景：

```bash
node transfer-test.mjs --scenario relay-1to1                    # 中转 1→1 + 完整性 + 分段计时
node transfer-test.mjs --scenario relay-fanout --listeners 4    # 1 个 DJ → 4 个听众
node transfer-test.mjs --scenario resume                        # 断点续传（from_chunk）
node transfer-test.mjs --scenario waitall                       # wait_all 协调观察
node transfer-test.mjs --scenario p2p-1to1                      # WebRTC 直连 + 速率对比
node transfer-test.mjs --scenario p2p-reverse                   # 反向打洞（含并行多连接分段）
node transfer-test.mjs --scenario late-joiner                    # 中途加入的听众（缺头分片隐患）
node transfer-test.mjs --scenario full-chain                    # 整条听众链路（sync 驱动）
```

| 参数 | 说明 |
|------|------|
| `--scenario <name>` | `all` / `relay-1to1` / `relay-fanout` / `resume` / `waitall` / `p2p-1to1` / `p2p-reverse` / `late-joiner` / `full-chain` / `listener-only` |
| `--song <文件名>` | 默认 `Are you lost.mp3`（3.3MB，跑得快） |
| `--song-path <路径>` | 覆盖源文件路径（默认取仓库 `music-player/music/`） |
| `--listeners <N>` | 扇出场景的听众数，默认 3 |
| `--ws <地址>` | 默认 `wss://api.pomogrow.top` |
| `--room <roomId>` | `listener-only` 必填 |
| `--keep-room` | 跑完不删房间（排查用） |
| `--verbose` | 打印每条 WS 消息与 ICE 候选 |

## 场景

| 场景 | 验证什么 |
|------|---------|
| `relay-1to1` | 中转链路端到端 + **逐字节一致** + 分段计时（定位瓶颈在发送端/中转/接收端） |
| `relay-fanout` | **1 个 DJ → N 个听众**全部逐字节一致；服务器是否对多听众去重 |
| `resume` | 服务器把 `from_chunk` 转发给持有者；只传后半段；**续传片段与源文件对应区间逐字节一致** |
| `waitall` | `wait_all` 下仍能传完；**断言** `song_waiting`（缺歌即通知 DJ 暂停等人）/ `songs_ready`（全员就绪，从头统一起播）必然发出，且不依赖 DJ 是否周期广播 |
| `p2p-1to1` | **WebRTC 直连**（媒体不经服务器）+ 完整性 + 与中转的速率对比；服务器是否透传 `p2p` 标志 |
| `late-joiner` | **中途加入的听众**：A 先请求并开始下载，5 秒后 B 才请求 —— B 必须也能拿到完整文件（否则会缺前半段却收到"已完成"） |
| `p2p-reverse` | **反向打洞**：下载端作 offerer、持有端在收到的 channel 上发数据；含并行多连接**分段映射**（`baseChunk`/`globalChunks`） |
| `full-chain` | **整条听众链路**：`request_state` → 缺歌检测 → 下载 → 重对齐 → 位置推进 |
| `listener-only` | **真实应用当 DJ** + 虚拟听众拉歌（见下节） |

`waitall` 的三个对照组（传歌期间：不广播 / 循环内广播 / 独立广播）用于证明
**协调消息的触发是设计使然、而非"DJ 恰好在此期间广播"的巧合** ——
这个区别决定了传输快于 5s 广播间隔时（P2P 实测 ~1.3s）会不会漏触发。

## 实测基线（2026-10，经真实服务器 `api.pomogrow.top`）

**20 通过 / 0 失败 / 6 观察**，约 93s。

| 场景 | 结果 |
|------|------|
| relay 1→1 | 27/27 片，3,482,510 字节，**sha256 逐字节一致** |
| relay 吞吐 | **≈0.28 MB/s ≈ 2.2 Mbps** |
| **瓶颈归因** | DJ 发完 27 片仅 **15ms**，听众收完 **12,591ms** → 慢在**服务器带宽**，不是客户端读盘/base64 |
| relay 扇出 1→3 | 3/3 全部逐字节一致；聚合 **0.24 MB/s ≈ 1.9 Mbps** |
| **多听众去重** | ✅ **已实现（v4.11）**：3 个听众同时缺歌时 DJ **只服务 1 次**，服务器扇出；修复前为 3 次（上行放大 3×） |
| 断点续传 | 服务器确实转发 `from_chunk`；只传后半段且逐字节一致 |
| `wait_all` 协调 | ✅ **已修复**（原为 0 条）：三组对照全部 2/2 条；详见 `docs/STUDY_ROOM_ARCHITECTURE.md` §8 |
| **P2P 直连** | ✅ 建连成功（`typ srflx` NAT 打洞），**20.95 Mbps**，逐字节一致 |
| P2P vs 中转 | **快约 10.5×**（同样 3.3MB：P2P 1.33s vs 2Mbps 中转理论 13.9s） |
| **反向打洞**（单连接） | ✅ 逐字节一致，端到端 1.9s |
| **反向打洞**（并行 3 连接分段） | ✅ **3/3 段**，`baseChunk` 映射正确，逐字节一致 |
| **中途加入听众** | ✅ **已修复（v4.11）**：B 从"只拿到 12/27 片却收到已完成"变为 **27/27 逐字节一致** |
| full-chain | 6/6：状态对齐、缺歌检测、P2P 下载、**下载期间位置推进 +1304ms** |

> **关于 0.28 MB/s 的正确解读**：这不是"中转实现慢"。
> 服务器上行带宽本身约 **2 Mbps**，而 relay 的 1→1（2.2 Mbps）与 1→3 聚合（1.9 Mbps）
> **两次都顶在这个上限**——说明中转**已经跑满物理带宽**，是健康表现。
> 也正因如此，**P2P 的价值是决定性的**（20.95 Mbps，绕开服务器带宽）。

**已澄清的服务器行为**（原本是文档里的悬而未决项）：

- ✅ `music:request_song` 的 **`p2p` 标志会被透传**到 `music:song_requested`
  （`API-implementation.md:558` 的疑问已确认：透传）。
  这一点很关键——真实持有端就是靠这个字段门控 P2P 的，不透传则生产上永远走中转。
- ✅ `music:request_state` → **DJ 侧确实收到 `music:state_request`**（转达链路可用）。
- ❌ N 个听众不去重（`EXTERNAL-INTERFACES.md` 提到的"同时转发给所有缺歌者"未落地）。

## 「真实应用当 DJ」怎么跑

这是"真实"最强的一条：**应用自己的 Rust 服务端路径**（读分片、回传、`transfer_done`）
真的被检验，虚拟客户端只做听众。

1. 打开应用 → 进入自习室 → 创建房间（记下 roomId）→ 开启同步听歌 → 请求成为 DJ →
   播放一首歌
2. `node transfer-test.mjs --scenario listener-only --room <roomId> --song "歌名.mp3"`

> ⚠️ 该场景只做**交叉校验**（各听众收到的内容彼此一致），因为虚拟端不知道应用本地
> 文件的 sha256。要证明"与源文件一致"，把 `--song-path` 指向本地同一文件并对比 sha256。
> P2P 也支持：加 `--p2p`（虚拟听众会回 `hello-ack{compress:0}`，与真实应用的不压缩路径互通）。

## ⚠️ P2P 分片大小：这是**工具限制，不是产品缺陷**

`werift`（Node 的纯 JS WebRTC）单条 DataChannel 消息上限 **65536 字节**，且
**不会自动分片**。发 128KB 会直接报
`max-message-size exceeded: 131076 > 65536`。

**真实应用跑在 WebView2/Chromium 上，浏览器会自动做 SCTP 分片**，所以
`src/p2p.ts` 的 `DEFAULT_CHUNK_SIZE = 128KB` 在生产是正常的。

因此虚拟客户端的 P2P 用 16KB 分片（`WERIFT_SAFE_CHUNK_SIZE`，与 `peer.js` 同一个值）。
分片大小经 DataChannel 的 `meta.chunkSize` 告知对端、接收端按 `totalChunks` 判定收齐，
**换大小不影响互通**（与真实应用对传也成立）。

## 与 `peer.js` 的分工

| 工具 | 层次 | 测什么 |
|------|------|--------|
| `peer.js` / `run.js` | **传输层** | WebRTC 打洞、DataChannel 直连、原始字节速率（Phase 0） |
| `transfer-test.mjs` | **应用层** | `music:*` 传歌协议、中转与 P2P 两条路径、扇出、断点续传、完整性、进度重对齐 |

两者互补：`peer.js` 证明"通道能建、能跑多快"，`transfer-test.mjs` 证明
"传歌流程真的能跑完、数据没错、路径选择与回退都对"。

## 已知限制

- **P2P 压缩路径未覆盖**：`src/p2p.ts` 支持 `hello`/`hello-ack` + deflate-raw 压缩。
  虚拟端只走**不压缩**（正是旧对端与向后兼容的路径）：作发送方不发 `hello`；
  作接收方收到 `hello` 回 `hello-ack{compress:0}` 婉拒。压缩未验证。
- **反向打洞的「触发时机」未覆盖**：反向路径本身已覆盖（单连接 + 并行 3 段），
  但"正常方向失败后自动切反向"是应用状态机里的**竞态**
  （`music.ts` 的 `!p2pHadConnected && !p2pReverseTried && channel !== "server"`），
  与服务器中转谁先完成有关，无法在虚拟客户端里确定性复现。
  本工具直接验证反向路径本身，不验证那次切换决策。
- **依赖前端状态机的行为未覆盖**：DJ 切歌打断传输、`wait_all` 的 UI 提示与起播时刻、
  下载完成后的自动起播（本工具只验证到"能对齐到正确进度"）。
- **测试账号 `p2ptest_a`…`p2ptest_z`** 会在服务器上累积（共用固定密码）。
  它们是测试账号，勿用于生产。
