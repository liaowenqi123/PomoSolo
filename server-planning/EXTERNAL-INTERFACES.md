# PomoSolo 外部接口总览

> **定位**：本文档是客户端**所有与外部服务器通信的接口清单**（唯一权威索引）。
> 覆盖：REST API、WebSocket 消息、P2P 信令、P2P 传歌、P2P 测试工具、安装包 P2P 种子、自动更新源。
> **纯本地的 Tauri 命令（invoke）不算外部接口**，仅在本文档"客户端命令映射"一节做索引对照。
>
> 详细实现与迭代记录见 `API-implementation.md`；REST 速查见 `API-quickref.md`。

---

## 1. 服务器地址与端口

```
Base URL (REST): http://<服务器>/api/v1        # 经 Nginx 反代到 3000
WebSocket:       ws://<服务器>/ws?token=<access_token>   # 经 Nginx 反代到 3001
备用 WS:         ws://<服务器>:3001/ws?token=<access_token>
更新静态托管:    http://<服务器>/update/*      # latest.json + 安装包
公告:            http://<服务器>/updates/notice.json
对外端口:        80 (HTTP) / 443 (HTTPS, 备案后)
```

- **认证方式**：`Authorization: Bearer <access_token>`（REST）；WS 走 URL query `token`。
- **Token 有效期**：Access 15 分钟，Refresh 30 天（滚动刷新）。

---

## 2. REST API 清单

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | `/api/v1/auth/register` | 否 | 注册（**username** 必填 + password，email 可选）→ user + tokens |
| POST | `/api/v1/auth/login` | 否 | 登录（同时接受 username 或 email）→ user + tokens |
| POST | `/api/v1/auth/refresh` | 否 | 刷新 token（滚动刷新） |
| POST | `/api/v1/auth/logout` | 是 | 登出（失效 refresh token） |
| GET | `/api/v1/auth/session` | 是 | 当前会话信息 |
| POST | `/api/v1/feedback` | 是 | 提交反馈 `{ content }`（≤500 字） |
| GET | `/api/v1/feedback` | 是 | 我的反馈列表 |
| DELETE | `/api/v1/feedback/:id` | 是 | 删除我的反馈（403 非本人 / 404 不存在） |
| GET | `/api/v1/config/mode` | 否 | 返回 `{ "mode": "cloud" \| "local" }` |
| GET | `/api/v1/config/deepseek-key` | 是(admin) | 获取 DeepSeek API Key（非 admin 403） |
| PUT | `/api/v1/config/deepseek-key` | 是(admin) | 更新 DeepSeek API Key `{ api_key }` |
| GET | `/api/v1/health` | 否 | `{ status, version, uptime }` |
| GET | `/api/status` | 否 | 服务器详细信息（服务名/版本/python/平台/ws_port） |
| GET | `/api/v1/settings` | 是 | 拉取云端设置 `{ settings, updated_at }` |
| PUT | `/api/v1/settings` | 是 | 上传设置 `{ settings }` |
| POST | `/api/v1/pomodoro/records/batch` | 是 | 批量上传番茄钟记录 `{ records: [...] }` → `{ synced }` |
| GET | `/api/v1/rooms` | 是 | 公开房间列表（仅含在线成员>0 的房间） |
| GET | `/api/v1/rooms/:id` | 是 | 房间详情（含 `has_password`） |
| PUT | `/api/v1/rooms/:id` | 是(房主) | 改房间（is_public/password/name/description；设密码→自动私密，设公开→清密码） |
| DELETE | `/api/v1/rooms/:id` | 是(房主) | 删房间（服务器同步清内存房 + 广播 `room:closed`） |
| GET | `/api/v1/rooms/:id/leaderboard?period=today\|week` | 是 | 房间排行榜 |

> 完整请求/响应示例见 `API-implementation.md` §REST API 接口清单。

---

## 3. WebSocket 基础

```
连接: ws://<服务器>/ws?token=<access_token>
验证失败: { "type": "error", "error": "认证失败" } 后关闭
```

**请求-响应模式**：客户端消息**可选携带 `id`** 字段——
- 携带 `id` → 服务端处理后回传同名 `id` 的响应（请求-响应类：`room:create` / `room:join` / `p2p:online` / `p2p:seed_list`）
- 不携带 `id` → 纯广播（fire-and-forget）
- 错误统一回 `{ "type": "error", "error": "...", "id": ... }`

**心跳**：客户端每 10s 发 `{ "type": "ping" }` → 服务器回 `{ "type": "pong", "server_time": ... }`；30s 无 ping 标记 offline。

---

## 4. WS 消息总表（全部 type）

### 4.1 客户端 → 服务端

| type | 模块 | 说明 | 关键参数 |
|------|------|------|----------|
| `room:create` | 自习室 | 创建房间（请求-响应） | name, max_members, password, description |
| `room:join` | 自习室 | 加入房间（请求-响应） | room_id, password |
| `room:leave` | 自习室 | 离开房间 | room_id |
| `presence:update` | 自习室 | 状态上报 | status: idle/focusing/short_break/long_break, room_id |
| `room:chat` | 自习室 | 聊天 | message |
| `room:pomo_done` | 自习室 | 番茄完成 | room_id, mode |
| `music:play` | 同步听歌 | 播放（旧协议，兼容保留） | song_id, position_ms |
| `music:pause` | 同步听歌 | 暂停（旧协议，兼容保留） | position_ms |
| `music:seek` | 同步听歌 | 跳转（旧协议，兼容保留） | position_ms |
| `music:next` | 同步听歌 | 切歌（旧协议，兼容保留） | song_id |
| `music:volume` | 同步听歌 | 音量 | volume: 0-1 |
| `music:add_song` | 同步听歌 | 加歌 | song_name, song_url |
| `music:request_dj` | 同步听歌 | 申请当 DJ | - |
| `music:sync_state` | 同步听歌 | **DJ 全量状态快照（现行主协议）** | song_id, playing, position_ms, volume, transfer_mode |
| `music:sync_config` | 同步听歌 | 切传歌方案 | transfer_mode: immediate / wait_all |
| `music:request_state` | 同步听歌 | 请求补发状态快照 | - |
| `music:request_song` | P2P 传歌 | 听众请求拉缺失歌曲 | song_id, from_chunk, p2p:true |
| `music:offer_song` | P2P 传歌 | 持有者回传分片（服务器中转） | song_id, chunk_index, total_chunks, chunk_size, data_base64 |
| `music:transfer_done` | P2P 传歌 | 传输完成 | song_id |
| `music:transfer_failed` | P2P 传歌 | 传输失败 | song_id |
| `peer:offer` | P2P 信令 | WebRTC offer 转发 | sdp, tag |
| `peer:answer` | P2P 信令 | WebRTC answer 转发 | sdp, tag |
| `peer:ice` | P2P 信令 | ICE 候选转发 | candidate, tag |
| `peer:bye` | P2P 信令 | 断开通知 | - |
| `p2p:online` | P2P 测试 | 在线用户列表（请求-响应） | - |
| `p2p:test_request` | P2P 测试 | 发起测速（定向转发） | to_user_id |
| `p2p:test_result` | P2P 测试 | 回传测速结果（定向转发） | to_user_id, ok, ms, speed_bps, bytes, error |
| `p2p:reverse_test_request` | P2P 测试 | 反向测速（定向转发） | to_user_id |
| `p2p:bidir_test_request` | P2P 测试 | 双向测速（定向转发） | to_user_id |
| `p2p:seed_register` | 安装包种子 | 种子注册（重复注册覆盖） | version, file, size |
| `p2p:seed_heartbeat` | 安装包种子 | 心跳保活（每 30s） | - |
| `p2p:seed_unregister` | 安装包种子 | 主动注销 | - |
| `p2p:seed_list` | 安装包种子 | 查在线种子（请求-响应） | version |
| `p2p:seed_fetch` | 安装包种子 | 请服务器通知种子端发起传输 | to_user_id, version |
| `p2p:reverse_transfer_request` | 反向打洞 | 通知对端挂起 reverse 传输 | to_user_id, song_id?, version?, parallel? |
| `ping` | 基础 | 心跳 | - |

### 4.2 服务端 → 客户端

| type | 模块 | 说明 |
|------|------|------|
| `room:created` | 自习室 | 创建成功 `{ room: {...} }` |
| `room:joined` | 自习室 | 加入成功（请求-响应） |
| `room:members` | 自习室 | 成员列表（join 时快照 + 服务器每 30s 校准） |
| `room:member_joined` / `room:member_left` / `room:member_status` | 自习室 | 成员变动 |
| `room:closed` | 自习室 | 房间被删（收到后退出房间视图） |
| `room:chat` | 自习室 | 聊天广播 |
| `room:pomo_done` | 自习室 | 番茄完成广播 |
| `music:state` | 同步听歌 | 播放状态同步（旧协议：action + position_ms + timestamp_server） |
| `music:sync_state` | 同步听歌 | **全量状态同步（新）**：DJ 消息原样广播 + timestamp_server |
| `music:dj_changed` | 同步听歌 | DJ 切换 |
| `music:playlist_updated` | 同步听歌 | 歌单更新 |
| `music:volume` | 同步听歌 | 音量同步 |
| `music:sync_config` | 同步听歌 | 传歌方案广播 |
| `music:state_request` | 同步听歌 | 服务器转达：请 DJ 广播一次实时 sync_state |
| `music:song_requested` | P2P 传歌 | 要求持有者传歌 `{ song_id, requester_user_id, p2p? }` |
| `music:song_chunk` | P2P 传歌 | 转发歌曲分片（服务器中转） |
| `music:transfer_done` / `music:transfer_failed` | P2P 传歌 | 传输结果通知 |
| `music:song_waiting` | P2P 传歌 | 有听众缺歌，DJ 暂停等待（wait_all 模式） |
| `music:songs_ready` | P2P 传歌 | 全员就绪，DJ 从头播放（wait_all 模式） |
| `peer:offer` / `peer:answer` / `peer:ice` / `peer:bye` | P2P 信令 | 对端信令转发（附加 from_user_id） |
| `p2p:online` | P2P 测试 | 在线用户列表响应 |
| `p2p:test_request` / `p2p:test_result` / `p2p:reverse_test_request` / `p2p:bidir_test_request` | P2P 测试 | 测试消息定向转发 |
| `p2p:seed_list` | 安装包种子 | 种子列表响应 `{ peers:[{userId, username}], version }` |
| `p2p:seed_request` | 安装包种子 | 服务器转发：有下载端找你拉安装包 |
| `p2p:reverse_transfer_request` | 反向打洞 | 服务器转发：下载端请你挂起 reverse 传输 |
| `pong` | 基础 | 心跳回复（含 server_time） |
| `error` | 基础 | 错误信息 |

---

## 5. P2P 传歌（同步听歌缺歌拉取）

**两条路径，失败自动回退**：

```
听众缺歌 ──> music:request_song { song_id, p2p:true }
              │
              ├─ P2P 直连（推荐）：服务器选持有者（优先 DJ）→ music:song_requested
              │    → 持有者 WebRTC offerer 建 DataChannel → 分片直传（不经服务器）
              │    → 打洞失败/超时 8s → 自动回退服务器中转
              │
              └─ 服务器中转（兜底）：持有者 music:offer_song 逐片 base64 → 服务器转发
                   music:song_chunk 给请求者（128KB/片，base64 约 170KB，单消息上限 ≥512KB）
```

- 收齐后客户端合并写入 `app_data_dir/music`，刷新歌单并播放。
- **传歌方案**（DJ 切换，设置持久化）：
  - `immediate`（默认，边下边播）：下载完成立即播放并 seek 到 DJ 进度
  - `wait_all`（全员就绪统一播）：缺歌者存在 → 广播 `music:song_waiting` → DJ 暂停 → 全员就绪广播 `music:songs_ready` → DJ 从头播
- **同步精度**：客户端收到状态后 `local_position = position_ms + (now - timestamp_server)`，偏差 >200ms 静默 seek；每 30s 校准一次。
- 断点续传：`music:request_song` 带 `from_chunk`（已存分片数）。

---

## 6. P2P 信令协议（peer:*，WebRTC 打洞牵线）

- 客户端复用现有 WS 通道发送 `peer:*` 消息（Tauri 命令 `p2p_signal`）。
- 服务器校验 type/to_user_id 白名单 → 附加 `from_user_id` → 定向转发；对端离线/解析失败**静默丢弃**。
- 仅做 KB 级信令转发 + 在线目录，**媒体数据始终走两端 WebRTC 直连**，不经服务器。
- 路由键：`peerId:tag`（同 peer 多连接时用 tag 区分；缺省空 = 单连接，向后兼容）。
- 数据通道：`RTCDataChannel("p2p", { ordered: true })`，可靠有序。

### DataChannel 传输协议

```
控制消息（字符串 JSON）:
  { "t": "meta", "size": N, "totalChunks": M, "chunkSize": K, "compress"?, "baseChunk"?, "globalChunks"? }
  { "t": "hello", "v": 2 }                    // 发送端压缩协商（v4.6.4）
  { "t": "hello-ack", "compress": 0|1 }       // 对端回包；不回 → 1.2s 后按旧格式不压缩
  { "t": "ack" }                              // 接收端收齐确认（发送端等它安全关闭）
  { "t": "duplex_switch" } / { "t": "duplex_done" }   // 双向测速专用

数据消息（二进制）:
  不压缩: 4 字节大端 chunk_index + 原始字节
  压缩:   4 字节大端 index + 1 字节压缩标志 + payload（deflate-raw；压缩后更大则发原片）
```

- 分片默认 128KB；发送端背压阈值 512KB（缓冲超阈值等 bufferedamountlow 排空再发）。
- 建连超时默认 8s；建连后"无数据进展"超时默认 30s（音乐场景 15s）。
- **STUN 列表**（国内可达性优先）：`stun.cloudflare.com:3478`、`stun.miwifi.com:3478`、`stun.chat.bilibili.com:3478`、`stun.l.google.com:19302`（兜底）。无 TURN，对称 NAT 下打洞失败走回退。

### Reverse 反向打洞（v4.7.5/4.7.6）

正常方向（持有端作 offerer）建连失败时，下载端发 `p2p:reverse_transfer_request { to_user_id, song_id?, version?, parallel? }`：
- 服务器定向转发给持有端 → 持有端挂起 `answerer + sender`（DataChannel 全双工，在收到的 channel 上发数据）
- 下载端随后作 offerer 反向发起协商。
- `parallel > 1`：多连接并行分片传输（连接 k 负责全局 index ∈ [base, base+段数)，meta 带 baseChunk/globalChunks）。

---

## 7. P2P 连通性测试工具（设置面板）

| 消息 | 方向 | 语义 |
|------|------|------|
| `p2p:online` | C→S（请求-响应） | 返回在线用户列表（排除自己），供选测试目标 |
| `p2p:test_request` | C→S → 定向转发 B | A 发起测速：`from_user_id, from_username`；B 离线静默丢弃，A 8s 超时判失败 |
| `p2p:test_result` | C→S → 定向转发 A | B 回传 `{ ok, ms, speed_bps, bytes, error }` |
| `p2p:reverse_test_request` | C→S → 定向转发 B | 正常方向失败后反向测速（B 作 offerer） |
| `p2p:bidir_test_request` | C→S → 定向转发 B | 双向测速（3 打洞方式 × 上行/下行） |

- 测试数据 2MB（64KB/片），建连复用 `peer:*` 信令 + `p2p_signal`，无新协议。
- 双向测速在同一连接上完成：offerer 推一程（self）→ `duplex_switch` → answerer 推一程（peer）→ `duplex_done`。

---

## 8. 安装包 P2P 种子（更新下载直连）

**种子端**（设置面板"分享安装包"开关，需登录）：
- `p2p:seed_register`（version + file + size）→ 每 30s `p2p:seed_heartbeat` 保活 → 关闭/登出 `p2p:seed_unregister`
- 服务器只维护内存种子表（60s 无心跳自动清理），**不存文件、不中转数据**

**下载端**（更新按钮，种子优先）：
1. `check_update` 拿 `UpdateInfo`（含 `signature`）
2. `p2p:seed_list(version)` 查在线种子（带 id 走请求-响应）
3. 有种子 → 前端 WebRTC 收片（复用 `peer:*` 信令）→ 逐片落盘（`update_seed_download_chunk`）
4. 收齐 → Rust 校验 Ed25519 签名 → 启动安装器并退出应用
5. 无种子 / P2P 失败（`update_seed_download_abort` 清会话删残留）→ 回退服务器/GitHub 下载

**种子端持有安装包位置**：`resources/installers/PomoSolo_<version>_x64-setup.exe`（更新成功后 Rust 自动留存，只保留最新版）。

> 注：`p2p:seed_fetch` 是客户端向服务器请求"通知某种子端发起传输"的消息（服务器转发 `p2p:seed_request` 给种子端）。

---

## 9. 自动更新（外部源）

| 源 | 用途 | 说明 |
|----|------|------|
| GitHub Releases | 默认更新源 | `check_update` / `download_and_install`，国内可能不稳定 |
| 服务器静态托管 `GET /update/latest.json` | 服务器更新源 | 返回 `{ version, notes, pub_date, platforms: { "windows-x86_64": { url, signature } } }` |
| 服务器 `GET /update/<PomoSolo_x.x.x_x64-setup.exe>` | 安装包下载 | CI 自动更新，作为国内 CDN 加速 |
| 服务器 `GET /updates/notice.json` | 公告 | 更新失败时展示官方指引 `{ active, level, text, url, min_version, max_version }` |
| 本地覆盖安装 `installLocalInstaller(path)` | 本地 | 文件名版本匹配时先校验 Ed25519 签名，失败拒绝安装 |

- 下载支持暂停/继续/取消 + 断点续传（`Range: bytes=<offset>-`，416 视为完整直接验签）。
- P2P 种子传输快，不提供暂停。

---

## 10. 客户端命令映射（Tauri invoke，内部接口索引）

以下均为**本地 Tauri 命令**（非外部接口），对应外部行为汇总如下：

| 命令 | 外部效果 |
|------|----------|
| `p2p_signal` | 经 WS 发 `peer:*` 信令 |
| `music_sync_*`（play/pause/seek/next/volume/add_song/request_dj/state/measure_time_offset/request_song/offer_song/transfer_done/transfer_failed/set_config/request_state） | 对应 §4.1 的 music:* WS 消息 |
| `music_read_song_chunk_bin` / `music_receive_song_chunk_bin` | P2P 传歌本地分片读写 |
| `p2p_reverse_transfer_request` | §6 Reverse 反向打洞 |
| `update_seed_download_begin/chunk/abort`、`update_seed_read_chunk`、`update_seed_has_installer` | §8 安装包种子本地读写 |
| `check_update` / `download_and_install` / `update_download_*` / `fetch_notice` / `install_local_installer` | §9 更新 |
| `sync_*`（settings/pomodoro records） | §2 REST 设置同步与番茄记录 |
| `room_*` / `study_room_*` | §4.1 自习室 WS 消息 |
| `ai_generate_plan` | DeepSeek 云端/本地生成计划（走服务器下发 Key，见 §2 deepseek-key） |

---

## 11. 外部依赖清单

| 外部服务 | 用途 | 备注 |
|----------|------|------|
| 自建服务器（REST + WS + 更新托管） | 认证/反馈/同步/自习室/同步听歌/P2P 信令中转/种子目录/更新 | 见 §1-§9 |
| STUN（4 个，国内优先） | WebRTC NAT 打洞 | 无 TURN，对称 NAT 打洞失败自动回退 |
| GitHub Releases | 更新源（默认） | 国内不稳 |
| DeepSeek API | AI 计划生成 / 歌曲下载 | Key 由服务器 `GET /api/v1/config/deepseek-key` 下发（仅 admin 可配置） |
| 备案域名 | 服务器对外入口 | 备案未完成时用 IP + 80 端口 |

---

## 12. 相关文档索引

| 文档 | 内容 |
|------|------|
| `server-planning/API-implementation.md` | API 实现细节 + 服务器部门迭代留言（最详细） |
| `server-planning/API-quickref.md` | REST 速查卡（P0/P1/P2 优先级） |
| `server-planning/ws_server.py` | 服务器 WS 服务端源码（消息处理权威实现） |
| `server-planning/nginx.conf` | Nginx 路由配置 |
| `docs/STUDY_ROOM_ARCHITECTURE.md` | 自习室架构 |
| `docs/AUTO_UPDATE_DESIGN.md` | 自动更新设计（含 Phase 2 P2P 种子） |
| `docs/SECURITY.md` | 安全设计 |
| `docs/modules/music-player.md` | 音乐播放器模块 |
| `docs/modules/cloud-and-charts.md` | 云端与图表模块 |
