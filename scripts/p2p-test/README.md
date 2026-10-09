# 多客户端传歌测试（无需启动多个客户端）

在**不启动任何 GUI 客户端**的前提下，用 N 个**虚拟客户端**经**真实服务器**跑完整条
传歌链路：认证 → 连 WS → 建房/进房 → 申请 DJ → 广播状态 → 请求歌曲 → 回传分片 →
收齐并做 **SHA-256 逐字节校验**。

## 为什么需要它

传歌横跨四段：**DJ 读分片 → 服务器转发 → 听众重组 → 完整性**。
手工验证要开两个客户端 + 建房间 + 请求 DJ + 切歌，成本极高且**不可重复**；
出问题时也无法区分是"持有者发得慢""服务器中转慢"还是"接收端慢"。

虚拟客户端说的是**真协议**——消息名与字段逐条对照
`src-tauri/src/commands/music_sync.rs`（权威）与
`server-planning/EXTERNAL-INTERFACES.md`（契约），信封格式对照
`src-tauri/src/modules/ws.rs`。所以它测的是**真实服务器 + 真实客户端都会走的路径**，
不是一套只在测试里成立的假协议。

## 用法

```bash
cd scripts/p2p-test
npm install            # 首次：装 werift + ws

node auth.js 4                          # 确认服务器可达 + 自动注册 4 个测试账号
node transfer-test.mjs --scenario all   # 跑全部自动化场景
```

单独跑某个场景：

```bash
node transfer-test.mjs --scenario relay-1to1                    # 中转 1→1 + 完整性
node transfer-test.mjs --scenario relay-fanout --listeners 4    # 1 个 DJ → 4 个听众
node transfer-test.mjs --scenario resume                        # 断点续传（from_chunk）
node transfer-test.mjs --scenario waitall                       # wait_all 协调观察
```

| 参数 | 说明 |
|------|------|
| `--scenario <name>` | `all` / `relay-1to1` / `relay-fanout` / `resume` / `waitall` / `listener-only` |
| `--song <文件名>` | 默认 `Are you lost.mp3`（3.3MB，跑得快） |
| `--song-path <路径>` | 覆盖源文件路径（默认取仓库 `music-player/music/`） |
| `--listeners <N>` | 扇出场景的听众数，默认 3 |
| `--ws <地址>` | 默认 `wss://api.pomogrow.top` |
| `--room <roomId>` | `listener-only` 必填 |
| `--keep-room` | 跑完不删房间（排查用） |
| `--verbose` | 打印每条 WS 消息 |

## 场景

| 场景 | 验证什么 |
|------|---------|
| `relay-1to1` | 中转链路端到端可用 + **逐字节一致** + 分段计时（定位瓶颈） |
| `relay-fanout` | **1 个 DJ → N 个听众**全部逐字节一致；服务器是否对多听众去重 |
| `resume` | 服务器把 `from_chunk` 转发给持有者；只传后半段；**续传片段与源文件对应区间逐字节一致** |
| `waitall` | `wait_all` 下仍能传完；**观察** `song_waiting` / `songs_ready` 是否出现 |
| `listener-only` | **真实应用当 DJ** + 虚拟听众拉歌（见下节） |

`waitall` 里的 `song_waiting` / `songs_ready` 记为 **INFO 而非断言**：
它们的触发条件可能依赖真实客户端才会上报的信息，虚拟客户端不一定满足条件。
工具只如实报告观察到的行为，不武断判失败。

## 「真实应用当 DJ」怎么跑

这是"真实且完整"最强的一条：**应用自己的 Rust 服务端路径**（读分片、回传、
`transfer_done`）真的被检验，而虚拟客户端只做听众。

1. 打开应用 → 进入自习室 → 创建房间（记下 roomId）→ 开启同步听歌 → 请求成为 DJ →
   播放一首歌
2. 拿到 roomId 后：
   ```bash
   node transfer-test.mjs --scenario listener-only --room <roomId> --song "歌名.mp3"
   ```

> ⚠️ 该场景只做**交叉校验**（各听众收到的内容彼此一致），因为虚拟端不知道应用本地
> 文件的 sha256。它**不证明**"与源文件一致"。
> 要证明与源文件一致：把 `--song-path` 指向仓库里同一个文件并对比 sha256，
> 或直接对比应用音乐目录里那个文件的 sha256。

## 实测基线（2026-10，经真实服务器 `api.pomogrow.top`）

| 项 | 数值 |
|---|---|
| 中转 1→1 · 完整性 | ✅ 27/27 片，3,482,510 字节，sha256 一致 |
| 中转吞吐 | **≈0.28 MB/s**（首片延迟 ~370ms） |
| **瓶颈定位** | DJ 发完 27 片仅 **19ms**；听众收完 **12,452ms** → 瓶颈在**服务器中转/网络**，不是客户端读盘或 base64 |
| 扇出 1→3 | ✅ 3/3 全部一致；DJ 服务 3 次（**未去重**，上行放大 3×） |
| 断点续传 | ✅ 服务器确实转发 `from_chunk`；只传后半段且逐字节一致 |

> **未去重**这一条是实质发现：协议文档
> （`EXTERNAL-INTERFACES.md`）提到服务器"可同时转发给房间内所有缺歌者，
> 减少重复传输，由服务器实现取舍"——实测**未实现**，N 个听众会让 DJ 上传 N 倍数据。

## 与 `peer.js` 的分工

| 工具 | 层次 | 测什么 |
|------|------|--------|
| `peer.js` / `run.js` | **传输层** | WebRTC 打洞、DataChannel 直连、原始字节速率（Phase 0） |
| `transfer-test.mjs` | **应用层** | `music:*` 传歌协议、服务器中转、多听众扇出、断点续传、完整性 |

两者互补：`peer.js` 证明"通道能建、能跑多快"，`transfer-test.mjs` 证明
"传歌流程真的能跑完且数据没错"。

## 已知限制

- **未覆盖 P2P 直连路径的应用层流程**：虚拟客户端目前只走服务器中转。
  P2P 的传输层已由 `peer.js` 覆盖；把应用层 `p2p: true` 流程也虚拟化是后续工作。
- **未覆盖真实客户端的 UI 触发**：例如"DJ 切歌时打断传输""下载完自动起播"这类
  依赖前端状态机的行为，需要真实客户端参与。
- 测试账号 `p2ptest_a`…`p2ptest_z` 会在服务器上累积（共用固定密码）。
  它们是测试账号，勿用于生产。
