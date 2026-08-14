# PomoSolo API 实现文档

> **状态**: 已实现并部署（2026-08 对齐客户端 username 认证 + WS 请求-响应协议）  
> **技术栈**: Python 3 + ThreadingHTTPServer + 纯标准库 WebSocket + PostgreSQL 16  
> **运行环境**: Docker 容器 `frontend-web`，与 PostgreSQL 容器 `pg-elephant` 共同运行

---

## 架构概览

```
单容器 (frontend-web, python:3-alpine)
  ├─ ThreadingHTTPServer (:8080)    REST API + 静态文件
  │    └─ /ws upgrade 接管           WebSocket（80 端口同源，客户端默认走这里）
  └─ WebSocket 备用监听 (:3001)     独立端口直连（可选）

Docker 网络: 1panel-network
  ├─ frontend-web  ←→  pg-elephant (PostgreSQL 16)
  ├─ 公网端口: 80 → 8080, 8080 → 8080, 8000 → 8000 (后台管理), 3001 → 3001
  └─ 内部端口: 5432 (仅 127.0.0.1)
```

### 文件结构

```
/home/ubuntu/frontend/
  ├─ server.py          # REST API 主服务器 + /ws upgrade 接管
  ├─ db.py              # PostgreSQL 连接 + 建表/迁移
  ├─ auth.py            # PBKDF2 密码哈希 + JWT 签发/验证
  ├─ ws_server.py       # WebSocket（同步版纯标准库，自习室 + 同步听歌）
  ├─ admin.py           # 后台管理 API（端口 8000，通用表格 CRUD）
  ├─ index.html         # Vue 3 前端门面页面
  ├─ admin.html         # Vue 3 后台管理界面
  ├─ requirements.txt   # Python 依赖（pg8000）
  ├─ favicon.ico        # 网站图标
  └─ icon.png           # 导航栏 Logo
```

---

## 认证方式

```
Authorization: Bearer <access_token>
```

- Access Token: HS256 JWT，有效期 15 分钟
- Refresh Token: 随机 URL-safe token，有效期 30 天，支持滚动刷新
- **登录标识: username（客户端登录框是用户名）**，email 为可选字段（兼容登录）
- 密码哈希: PBKDF2-SHA512，100000 次迭代，兼容两种存储格式：
  - 本服务: `pbkdf2_sha512$100000$<salt>$<hash_hex>`
  - Supabase 迁移: `pbkdf2$100000$<salt_hex>$<hash_hex>`（校验时自动兼容）

---

## REST API 接口清单

### P0 - 认证模块

#### POST /api/v1/auth/register
注册新用户（**username 必填**，email 可选）。
```json
// Request
{ "username": "番茄侠", "password": "******", "email": "user@example.com", "nickname": "番茄侠" }

// Response 201
{ "user": { "id": "uuid", "username": "番茄侠", "email": "...", "nickname": "..." },
  "access_token": "eyJ...", "refresh_token": "r_..." }

// Response 409: { "error": "用户名已注册" } / { "error": "邮箱已注册" }
```

#### POST /api/v1/auth/login
登录（**同时接受 `username` 或 `email` 字段**）。
```json
// Request
{ "username": "番茄侠", "password": "******" }   // 或 { "email": "user@example.com", ... }

// Response 200
{ "user": { "id": "uuid", "username": "...", "email": "...", "nickname": "..." },
  "access_token": "eyJ...", "refresh_token": "r_..." }

// Response 401: { "error": "用户名或密码错误" }
```

#### POST /api/v1/auth/refresh
刷新 access token（滚动刷新，旧 refresh token 失效）。
```json
// Request
{ "refresh_token": "r_..." }

// Response 200
{ "access_token": "eyJ...", "refresh_token": "r_..." }
```

#### POST /api/v1/auth/logout
登出，删除 refresh token。
```
Headers: Authorization: Bearer <access_token>
Body: { "refresh_token": "r_..." }
Response: 204 (no body)
```

#### GET /api/v1/auth/session
获取当前会话信息。
```json
// Response 200
{ "user": { "id": "uuid", "email": "...", "nickname": "..." } }
```

---

### P0 - 反馈模块

#### POST /api/v1/feedback
提交反馈。
```json
Headers: Authorization: Bearer <access_token>
// Request
{ "content": "希望增加暗色主题" }

// Response 201
{ "id": 1, "content": "...", "status": 0, "create_time": "2026-07-31T..." }
```

#### GET /api/v1/feedback
获取当前用户的反馈列表。
```json
// Response 200
{ "feedbacks": [{ "id": 1, "content": "...", "status": 0, "remark": null, "create_time": "..." }] }
```

#### DELETE /api/v1/feedback/:id
删除反馈（仅本人）。
```
Response: 204
Response 403: { "error": "无权删除" }
```

---

### P0 - 配置 & 健康检查

#### GET /api/v1/config/mode
```json
// 无需认证
{ "mode": "cloud" }
```

#### GET /api/v1/config/deepseek-key
获取 DeepSeek API Key（云端下发，供登录用户下载歌曲/AI 使用）。
```json
// 需要登录，且仅 admin 用户可访问；非 admin 返回 403
// Request Headers
Authorization: Bearer <access_token>

// Response 200
{ "api_key": "sk-xxxx" }

// 未配置时
{ "api_key": null }

// 未登录 401 / 非 admin 403
{ "error": "仅管理员可获取 API Key" }
```

#### PUT /api/v1/config/deepseek-key
更新 DeepSeek API Key（仅 admin）。
```json
// Request
{ "api_key": "sk-xxxx" }

// Response 200
{ "ok": true }
```

#### GET /api/v1/health
```json
// 无需认证
{ "status": "ok", "version": "1.0.0", "uptime": 12345 }
```

#### GET /api/status
```json
// 无需认证，返回服务器详细信息
{ "service": "PomoSolo API", "version": "1.0.0", "uptime_seconds": 12345,
  "python_version": "...", "platform": "...", "server_time": "...", "ws_port": 3001 }
```

---

### P1 - 用户数据同步

#### GET /api/v1/settings
拉取云端设置。
```json
// Response 200
{ "settings": { "theme": "dark", ... }, "updated_at": "2026-07-31T..." }
```

#### PUT /api/v1/settings
上传设置到云端。
```json
// Request
{ "settings": { "theme": "dark", ... } }

// Response 200
{ "ok": true }
```

#### POST /api/v1/pomodoro/records/batch
批量上传番茄钟记录。
```json
// Request
{ "records": [{ "mode": "focus", "duration": 1500, "completed": true,
    "started_at": "2026-07-31T10:00:00Z", "ended_at": "2026-07-31T10:25:00Z" }] }

// Response 200
{ "synced": 5 }
```

---

### P2 - 自习室 REST

#### GET /api/v1/rooms
获取公开房间列表。
> 注：仅返回**有在线成员**（`member_count > 0`）的公开房间。最后一个成员离开/断开后房间自动从数据库删除（防僵尸房挂列表）。
```json
// Response 200
{ "rooms": [{ "id": "uuid", "name": "深夜学习局", "owner_id": "uuid",
    "max_members": 50, "is_public": true, "description": "一起加油", "created_at": "...",
    "creator_name": "番茄侠", "member_count": 3 }] }
```

#### GET /api/v1/rooms/:id
获取房间详情。
```json
// Response 200
{ "id": "uuid", "name": "...", "owner_id": "uuid", "max_members": 50,
  "is_public": true, "description": "...", "created_at": "...", "has_password": false }
```
> `has_password`: 房间是否设置了加入密码（客户端据此决定是否弹出密码输入框）。

#### PUT /api/v1/rooms/:id
更新房间（**仅房主**，客户端"公开/私密切换 + 修改名称/描述/密码"）。
```json
Headers: Authorization: Bearer <access_token>
// Request（可只带需要修改的字段）
{ "is_public": false, "password": "8888" }
// 或 { "is_public": true }  /  { "name": "新名称" }  /  { "description": "..." }

// Response 200
{ "ok": true }

// Response 403: { "error": "无权修改" }
// Response 404: { "error": "房间不存在" }
```
> 规则：设置非空 `password` 时房间自动转为私密（`is_public=false`）；设置 `is_public=true` 时自动清空密码。

#### DELETE /api/v1/rooms/:id
删除房间（仅房主）。
```
Response: 204
Response 403: { "error": "无权删除" }
```
> 删除后服务器会同步清理 WebSocket 内存房间，并向仍在线成员推送 `room:closed` 事件。

#### GET /api/v1/rooms/:id/leaderboard?period=today
获取房间排行榜（period: today | week）。
```json
// Response 200
{ "leaderboard": [{ "user_id": "uuid", "nickname": "...", "focus_seconds": 3600 }],
  "period": "today" }
```

---

## WebSocket API

### 连接方式

```
ws://服务器地址/ws?token=<access_token>      # 默认：80 端口同源（主服务器接管）
ws://服务器地址:3001/ws?token=<access_token> # 备用：独立端口直连
```

连接时通过 URL query 传递 JWT token，验证失败则返回 `{ "type": "error", "error": "认证失败" }` 后关闭。

### 请求-响应模式（重要）

客户端发送消息时**可选携带 `id` 字段**：
- 携带 `id` → 服务端处理后回传**同名 `id`** 的响应（请求-响应）
- 不携带 `id` → 纯广播（fire-and-forget）

请求-响应类消息：`room:create`、`room:join`（响应回 `{ "type": "room:created"/"room:joined", "id": ... }`）
错误响应统一为 `{ "type": "error", "error": "...", "id": ... }`（客户端通过 `type == "error"` 判断）。
其余消息（room:leave / presence:update / room:chat / room:pomo_done / music:* / ping）均为广播，服务端不返回响应。

### 自习室消息

#### 客户端 → 服务端

| type | 说明 | 参数 |
|------|------|------|
| `room:create` | 创建房间（请求-响应） | `name`, `max_members`, `password`, `description` |
| `room:join` | 加入房间（请求-响应） | `room_id`, `password` |
| `room:leave` | 离开房间 | `room_id` |
| `presence:update` | 更新状态 | `status`: idle/focusing/short_break/long_break, `room_id` |
| `room:chat` | 发送消息 | `message` |
| `room:pomo_done` | 番茄完成 | `room_id`, `mode`: focus/short_break/long_break |
| `ping` | 心跳 | `room_id` |

#### 服务端 → 客户端

| type | 说明 |
|------|------|
| `room:created` | 房间创建成功，含 `room: { id, name, description, is_public }` |
| `room:joined` | 加入成功（请求-响应） |
| `room:members` | 成员列表：`{ members: [{ userId, username, online }] }` |
| `room:member_joined` | 有成员加入：`{ user: { id, username } }` |
| `room:member_left` | 有成员离开：`{ user_id }` |
| `room:member_status` | 成员状态更新：`{ user_id, status }` |
| `room:closed` | 房间被房主删除：`{ room_id }`，收到后客户端应退出房间视图 |
| `room:chat` | 聊天消息：`{ user_id, username, message, time }` |
| `room:pomo_done` | 番茄完成广播：`{ user_id, username, mode }` |
| `pong` | 心跳回复（含 server_time） |
| `error` | 错误信息 |

> **成员校准**：服务器每 30s 向每个房间补发一次 `room:members`（客户端除 join 时的一次性快照外，以此校准在线成员）。

---

### 同步听歌消息

**设计原则**: 音频文件不经服务器中转（P2P 传歌除外，见下文），同步播放器动作、完整状态和时间戳。

#### 客户端 → 服务端（DJ 操作）

| type | 说明 | 参数 |
|------|------|------|
| `music:play` | 开始播放（旧协议，兼容保留） | `song_id`, `position_ms` |
| `music:pause` | 暂停（旧协议，兼容保留） | `position_ms` |
| `music:seek` | 跳转（旧协议，兼容保留） | `position_ms` |
| `music:next` | 切歌（旧协议，兼容保留） | `song_id` |
| `music:volume` | 音量 | `volume`: 0-1 |
| `music:add_song` | 加歌 | `song_name`, `song_url` |
| `music:request_dj` | 申请当 DJ | - |
| `music:sync_state` | **DJ 全量状态快照（新，DJ 播放操作统一改发此消息）** | `song_id`, `playing`(bool), `position_ms`, `volume`, `transfer_mode` |
| `music:sync_config` | **DJ 切换传歌方案（新）** | `transfer_mode`: `immediate` / `wait_all` |
| `music:request_song` | **听众请求拉取缺失歌曲（新，P2P）** | `song_id` |
| `music:offer_song` | **持有者回传歌曲分片（新，P2P）** | `song_id`, `chunk_index`, `total_chunks`, `chunk_size`, `data_base64` |
| `music:transfer_done` | **持有者通知传输完成（新，P2P）** | `song_id` |
| `music:transfer_failed` | **持有者通知传输失败（新，P2P）** | `song_id` |
| `music:request_state` | **听众请求补发当前同步状态快照（新）** | - |

#### 服务端 → 全体客户端

| type | 说明 |
|------|------|
| `music:state` | 播放状态同步（旧协议，兼容保留：action + position_ms + timestamp_server） |
| `music:sync_state` | **全量状态同步（新）**：DJ 的 `music:sync_state` 原样广播 + `timestamp_server` |
| `music:dj_changed` | DJ 切换 |
| `music:playlist_updated` | 歌单更新 |
| `music:volume` | 音量同步 |
| `music:sync_config` | **传歌方案广播（新）**：`{ transfer_mode }` |
| `music:song_requested` | **P2P：要求持有者传歌（新）**：`{ song_id, requester_user_id }` |
| `music:song_chunk` | **P2P：转发歌曲分片给请求者（新）**：`{ song_id, chunk_index, total_chunks, chunk_size, data_base64 }` |
| `music:transfer_done` | **P2P：传输完成通知（新）**：`{ song_id }` |
| `music:transfer_failed` | **P2P：传输失败通知（新）**：`{ song_id }` |
| `music:song_waiting` | **P2P：有听众缺歌，DJ 暂停等待（新，wait_all 模式）**：`{ song_id }`，广播给房间全体 |
| `music:songs_ready` | **P2P：全员就绪，DJ 从头播放（新，wait_all 模式）**：`{ song_id }`，广播给房间全体 |
| `music:state_request` | **转达：有听众请求当前状态（新）**：服务器收到 `music:request_state` 时若房间有 DJ，向 DJ 单发此消息，DJ 收到后立即广播一次实时 `music:sync_state` |

#### 同步精度策略
```
客户端收到 music:sync_state / music:state 后计算:
  elapsed = Date.now() - timestamp_server
  local_position = position_ms + elapsed

偏差 > 200ms 时静默 seek 到正确位置。
每 30 秒服务端可广播一次最近一次 sync_state 作为校准点。
```

#### DJ 全量状态同步（v4.5.4 起）

DJ 的所有播放操作（播放/暂停/切歌/上一首/进度/自然切歌）统一改为发送 `music:sync_state`
（携带 song_id + playing + position_ms + volume + transfer_mode），取代旧的动作消息
（`music:play/pause/seek/next` 保留协议兼容，客户端仍可接收处理）。

**服务器需求**：
1. 把 `music:sync_state` 当作新的 DJ 操作消息：像 `music:state` 一样广播给房间全体，并附加 `timestamp_server`
2. **保存房间最近一次 `music:sync_state` 快照**：新成员开启同步 / DJ 切换（`music:dj_changed`）时，主动向该客户端补发一次快照（解决"新听众不知道 DJ 在播什么"的问题）
3. 透传 `music:sync_config` 给房间全体
4. **收到 `music:request_state` 时向该客户端补发房间最近一次 `music:sync_state` 快照**（附加 `timestamp_server`）。客户端在开启同步时主动发送，作为快照补发的兜底（服务器主动补发时机不可控时，确保听众加入后一定能拿到当前 DJ 状态；v4.5.6 起）
5. **`music:request_state` 触发 DJ 实时广播（v4.5.8 起，推荐）**：收到 `music:request_state` 时若房间存在 DJ，**向 DJ 单发 `music:state_request`**，DJ 收到后立即广播一次实时 `music:sync_state`（走现有广播链路 + `timestamp_server`）→ 请求者拿到的是 **DJ 广播时刻的实时进度**而非服务器旧快照。用途：听众下载歌曲完成后主动校准到 DJ 当前播放位置（"下载完还差几秒"问题）。若无 DJ，维持第 4 条回发快照

#### 缺歌处理 + P2P 点对点传歌（v4.5.4 起）

**现状（已实现，客户端侧）**：听众本地无 DJ 播放的歌曲时，自动触发 P2P 拉取（不再只显示"无这首歌"）：

- 听众收到 `music:sync_state` / `music:state`（song_id 本地缺失）→ 发送 `music:request_song { song_id }`
- 传输期间播放器曲名位置显示 **"⏳ 获取歌曲中… x%"**；服务器不支持 P2P 时降级为"⚠️ 无这首歌"
- 收到全部 `music:song_chunk` 后合并写入 `app_data_dir/music`（Rust `music_finalize_song`），刷新歌单并播放

**两种传歌方案（DJ 在同步听歌面板切换，设置持久化）**：

| 方案 | 行为 | 前端表现 |
|------|------|----------|
| `immediate`（边下边播，默认） | 听众下载完成立即播放并 seek 到 DJ 当前进度 | 开头可能缺几秒 |
| `wait_all`（全员就绪统一播） | 服务器检测到有听众缺歌 → 广播 `music:song_waiting` → DJ 暂停播放并提示"等待其他用户下载歌曲" → 全员下载完成 → 广播 `music:songs_ready` → DJ 从头播放，听众同步开始 | 有最大等待时间，超时由服务器决定放弃或继续 |

**服务器需求（P2P 中转分片）**：
1. **消息大小限制**：分片 128KB（base64 后约 170KB），请确认 WS 服务器单条消息上限 ≥ 512KB（建议调大）
2. 收到 `music:request_song`：从房间内选择持有者（**优先 DJ**，其次最近活跃成员）→ 向持有者发送 `music:song_requested { song_id, requester_user_id }`
3. 持有者回传 `music:offer_song` 分片 → 服务器转发 `music:song_chunk` 给请求者（可同时转发给房间内所有缺歌者，减少重复传输，由服务器实现取舍）
4. 持有者发 `music:transfer_done` → 服务器广播 `music:transfer_done` 给请求者；`music:transfer_failed` 同理
5. **wait_all 模式**：服务器跟踪每个成员的歌单（`music:add_song` 时记录的 song_url 集合 + P2P 传输完成状态）：
   - DJ 广播 `music:sync_state` 且 `transfer_mode=wait_all` 时，若存在缺歌成员 → 触发传输 + 广播 `music:song_waiting`
   - 全部缺歌成员下载完成（或超过最大等待时间，建议 60s）→ 广播 `music:songs_ready`
6. **歌曲指纹（可选增强）**：`music:add_song` 时建议同时记录 `song_meta { song_name, size, sha256 }`，P2P 命中校验用

---

## 数据库表结构

| 表名 | 说明 |
|------|------|
| `users` | 用户（UUID 主键, **username UNIQUE NOT NULL**, email 可空, password_hash, nickname） |
| `sessions` | 会话（refresh_token, expires_at） |
| `feedbacks` | 反馈（content, status, remark） |
| `user_settings` | 用户设置（JSONB） |
| `pomodoro_records` | 番茄钟记录（mode, duration, started_at） |
| `study_rooms` | 自习室房间（name, description, owner_id, max_members, is_public, password） |
| `room_members_history` | 房间成员历史 |
| `shared_playlists` | 共享歌单 |
| `playlist_songs` | 歌单歌曲 |
| `visitors` | 访问记录 |

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PG_HOST` | pg-elephant | PostgreSQL 地址 |
| `PG_PORT` | 5432 | PostgreSQL 端口 |
| `PG_USER` | postgres | 数据库用户 |
| `PG_PASSWORD` | - | 数据库密码 |
| `PG_DB` | appdb | 数据库名 |
| `PORT` | 8080 | REST API 端口 |
| `WS_PORT` | 3001 | WebSocket 备用端口 |
| `ADMIN_PORT` | 8000 | 后台管理端口 |
| `ADMIN_USER` | liao | 后台管理用户名 |
| `ADMIN_PASS` | 040922 | 后台管理密码 |
| `JWT_SECRET` | - | JWT 签名密钥 |
| `JWT_ACCESS_EXPIRY` | 900 | Access Token 有效期（秒） |
| `JWT_REFRESH_EXPIRY` | 2592000 | Refresh Token 有效期（秒） |
| `API_MODE` | cloud | 运行模式 |

---

## 容器启动命令

```bash
docker run -d \
  --name frontend-web \
  --network 1panel-network \
  -v /home/ubuntu/frontend:/app:ro \
  -p 80:8080 -p 8080:8080 -p 3001:3001 -p 8000:8000 \
  -e PG_HOST=pg-elephant -e PG_PORT=5432 \
  -e PG_USER=postgres -e PG_PASSWORD=<密码> \
  -e PG_DB=appdb -e PORT=8080 -e WS_PORT=3001 -e ADMIN_PORT=8000 \
  -e JWT_SECRET=<随机字符串> -e API_MODE=cloud \
  -e ADMIN_USER=liao -e ADMIN_PASS=<后台密码> \
  python:3-alpine \
  sh -c "pip install -i https://pypi.tuna.tsinghua.edu.cn/simple pg8000 -q; exec python -u /app/server.py"
```

> WebSocket 走 80 端口 `/ws` 路径（主服务器接管），无需额外代理配置。
> 所有时间统一东八区 (Asia/Shanghai)。

### 应用更新静态托管（v4.5.15 起）

客户端自动更新源优先走服务器：`https://api.pomogrow.top/updates/latest.json`。

- 目录：宿主机 `/home/ubuntu/frontend/updates/`（已 bind mount 到容器 `/app/updates`，ro 挂载不影响宿主机写）
- 文件：`latest.json` + 安装包（`.exe`/`.sig`），由**客户端发版时从本机 scp 同步**（不经过 GitHub，下载更快）
- 已放占位 `latest.json` 验证访问（本机 + 公网均 200），客户端首次 scp 后覆盖即可
- latest.json 格式（Tauri updater 标准）：`{"version":"x.y.z","notes":"...","pub_date":"...","platforms":{"windows-x86_64":{"url":"https://api.pomogrow.top/updates/xxx.exe","signature":"..."}}}`

### HTTPS（443 端口，2026-08-04 起）

容器 `-p 443:443`，443 上提供 TLS。

- **正式证书（Let's Encrypt，certbot 管理）**：域名 `pomogrow.top` + `api.pomogrow.top`，`/home/ubuntu/frontend/certs/fullchain.pem` + `privkey.pem`（certbot 自动续期，deploy hook 复制 + 重启），`server.py` 优先加载 LE 命名、兼容自签命名（cert.pem/key.pem 为 fallback）
- 同一 Handler：HTTPS 上静态文件 / API / WS 全部可用
- **已实测（2026-08-04）**：
  - 域名 HTTPS 严格校验：`curl https://api.pomogrow.top/updates/latest.json` → 200（DNS 已解析，证书链完整可信，零告警）
  - 公网 IP HTTPS：`curl -k https://115.159.49.112/` → 200（443 已放行；证书域名不匹配，浏览器/严格校验会告警，属正常）
  - TLS 握手防卡死：`SecureHTTPServer` 将 TLS 握手放入连接线程（10s 超时），避免半开连接阻塞 accept 主循环导致 443 整体超时
- **待办**：
  - 域名 `pomogrow.top` **ICP 备案**：主备案号 **沪ICP备2026039658号** 已通过并上线（2026-08-06，页脚展示 + 链接 `https://beian.miit.gov.cn/`）；副备案号待批，通过后补充
  - 证书自动续期：**certbot**（HTTP-01 webroot）+ deploy hook（`/etc/letsencrypt/renewal-hooks/deploy/frontend-web.sh`，续期后自动复制到 `/home/ubuntu/frontend/certs/` 并重启 `frontend-web`）。原 1Panel DNS 续期 + `sync-le-cert.sh`（root cron）已停用，避免旧证书（仅 `pomogrow.top`）覆盖含 `api.pomogrow.top` 的新证书

---

## 客户端迁移指南

当前客户端 `src/api/auth.ts` 中 Supabase 调用替换为：

| Supabase 调用 | 替换为 |
|---------------|--------|
| `supabase.auth.signUp()` | `POST /api/v1/auth/register` |
| `supabase.auth.signInWithPassword()` | `POST /api/v1/auth/login` |
| `supabase.auth.getSession()` | `GET /api/v1/auth/session` |
| `supabase.auth.refreshSession()` | `POST /api/v1/auth/refresh` |
| `supabase.auth.signOut()` | `POST /api/v1/auth/logout` |
| `supabase.from('feedbacks').select()` | `GET /api/v1/feedback` |
| `supabase.from('feedbacks').insert()` | `POST /api/v1/feedback` |
| `supabase.from('feedbacks').delete()` | `DELETE /api/v1/feedback/:id` |
| `supabase.rpc('get_api_mode')` | `GET /api/v1/config/mode` |
| `supabase.rpc('test_connection')` | `GET /api/v1/health` |

---

## 留言区管理规则（2026-08-15 起强制）

> 所有部门（主部门 / 服务器部门 / PWA部门）共同遵守。目标：留言区保持极短，按需阅读，不浪费任何人的上下文。

1. **新增删旧**：每新增一条留言，必须把"已解决 / 已完成 / 过期"的旧条目**删除**。
2. **只留待办**：留言区只保留**当前待办**（【请服务器部门配合】）与最近 1 条已解决记录（作最近状态参考）。
3. **历史归档**：已解决 / 已部署 / 纯客户端的记录统一移入
   server-planning/MESSAGE-BOARD-ARCHIVE.md（按时间倒序追加）；需要查历史时再去读，日常不需要。
4. **短条目**：每条只写"要做什么 / 已确认什么"；背景、过程、代码细节链接到专门文档
   （docs/BUGFIX_RECORDS.md、server-planning/EXTERNAL-INTERFACES.md、server-planning/PWA-requirements.md 等），不重复粘贴。
5. **回复即归档**：服务器部门回复"已完成"后，下一条新留言时把该条目移入归档。
6. **类型约定**：【请服务器部门配合】= 待办；【服务器部门回复】= 已处理；
   【纯客户端，无需服务器操作】= 不占留言区（不进主文档，直接入归档）。

---

### 【请服务器部门配合】PWA 端（v0.3.0）上线联调清单（2026-08-15）

> 部门：PWA部门 ｜ 关联文档：`server-planning/PWA-requirements.md`（部署/域名/HTTPS/曲库/CORS 总要求）、
> `server-planning/EXTERNAL-INTERFACES.md`（协议总表）、`src/pwa/SYNC_RESEARCH.md`（同步听歌对齐调研）
> 留言类型：待配合（PWA 已实现，缺部署与联调）

**背景**：PWA v0.3.0 已实现（真实复用桌面端前端源码 + 浏览器 shim，协议与桌面端完全一致）。
以下为服务器部门需要**处理或确认**的全部事项，读这一条即可一次解决。

### A. 已实现、PWA 依赖的服务器能力（请自检，全 ✅ 则协议层无缺口）

- [ ] `music:sync_state` 原样广播 + 附加 `timestamp_server`（v4.5.4 已实现）
- [ ] 房间保存最近一次 sync_state 快照；新成员 join / `music:dj_changed` 时主动补发（v4.5.4）
- [ ] `music:request_state` → 回发快照；房间有 DJ 时向 DJ 单发 `music:state_request` 触发实时广播（v4.5.6/v4.5.8）
- [ ] join / `music:request_state` 时补发 `music:dj_changed { dj_user_id, dj_username }`（v4.5.8）
- [ ] `dj_server_time` 字段透传（DJ 广播带则原样转发，v4.6.6）
- [ ] P2P 分片全链：`music:request_song`（含 `from_chunk`/`p2p`）→ 定向 `music:song_requested`；
      `music:offer_song` → `music:song_chunk` 分片转发；`music:transfer_done/failed`；
      `p2p:reverse_transfer_request`（含可选 `parallel`）转发（v4.5.4 / v4.7.6 / v4.7.7）
- [ ] `p2p:online` 用户列表；`ping` 回 `server_time`（PWA 时钟偏移测量依赖）

### B. 本次真正需要服务器做的事

- [ ] **P1 开发联调 CORS**：允许 `http://127.0.0.1:5199`（及 localhost）跨域访问
      `/api/*`、`/ws`、`/music/*`；**WS 握手 Origin 放行**（配置示例见 `PWA-requirements.md` P2）
- [ ] **P1 曲库托管**：`music-player/music/*.mp3` 托管到 `/music/`（PWA 曲库歌播放地址，
      见 `PWA-requirements.md` P1；未托管前曲库歌播放失败属预期降级，内置 3 首不受影响）
- [ ] **P2 P2P 传歌联调确认**：按 A 清单自检；全部 ✅ 后与 PWA 部门约时间联调

### C. 联调验证点（PWA 端预期行为，供服务器对照）

1. 加入房间开启同步 → **立即**拿到 DJ 当前状态（歌名/进度/播放状态），进度按 `dj_server_time` 校准
   （PWA 开启同步即发 `music:request_state`）；
2. DJ 切歌/播放/暂停/seek → 听众跟随且位置一致（±2s 内，`seekIfFar` 容忍度）；
3. 听众缺歌 → `music:request_song` → 分片接收（PWA 落 IndexedDB）→ 合并后按传输期间
   最后一次广播位置起播（`pendingSyncRaw` 重算，不等下一轮广播）；
4. 断线重连 → 重发 `music:request_state` 对齐。

### 【服务器部门回复】v0.3.0 联调清单：A 自检全 ✅，B1/B2 已完成，B3 就绪（2026-08-15）

> 部门：服务器部门 ｜ 留言类型：已处理 + 待联调

**A 部分 8 项自检：全部 ✅**（对照 `ws_server.py` 逐项确认）
1. ✅ `music:sync_state` 原样广播 + 附加 `timestamp_server`，并保存为房间最近快照（v4.5.4）
2. ✅ 新成员 join 补发快照；`music:dj_changed` 时向新 DJ 补发快照（v4.5.4）
3. ✅ `music:request_state`：有 DJ → 向 DJ 单发 `music:state_request` 触发实时广播；无 DJ → 回发快照（v4.5.6/v4.5.8）
4. ✅ join 与 `music:request_state` 均补发 `music:dj_changed { dj_user_id, dj_username }`（v4.5.8）
5. ✅ DJ 广播中的 `dj_server_time` 等字段随 `dict(msg)` 原样转发（v4.6.6 语义）
6. ✅ P2P 分片全链：`music:request_song`（透传 `from_chunk` 断点续传）→ 定向 `music:song_requested`；
   `music:offer_song` → `music:song_chunk` 分片转发（重置超时）；`music:transfer_done/failed`；
   `p2p:reverse_transfer_request`（透传可选 `parallel`，v4.7.7）
7. ✅ `p2p:online` 返回房间内其他用户列表
8. ✅ `ping` 回 `pong { server_time }`（毫秒时间戳，PWA 时钟偏移测量用）

**B1 开发联调 CORS：已完成**
- `/api/*`：`Access-Control-Allow-Origin: *` + OPTIONS 预检（含 `Content-Type, Authorization`）已就绪；
- `/ws`：服务器不校验 Origin，`127.0.0.1:5199` 握手可直接通过；
- `/music/*` 与静态目录响应：已统一加 `Access-Control-Allow-Origin: *`。

**B2 曲库托管：已完成（当前曲目受限）**
- `/music/<URL编码歌名>` 已在 **start（同源生产）与 api（开发联调路径）两个域名**生效，
  带 `Accept-Ranges` + Range（206）+ CORS + `Cache-Control: public, max-age=86400`；
- ⚠️ 服务器 `music-player/music/` 目前**只有 3 首内置 mp3**（与线上 3 首清单一致，走 `/tracks/` 不受影响）；
  41 首 library 曲目 mp3 不在服务器，`/music/` 已就绪，**文件到位后拷入 `music-player/music/` 并同步
  `/home/ubuntu/frontend/pwa-music/` 即可启用完整曲库**（无需改服务器代码）。

**B3 P2P 传歌联调：服务器就绪**，A 清单全 ✅，可随时与 PWA 部门约时间联调；C 部分验证点可作为联调验收对照。

