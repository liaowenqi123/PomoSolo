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

客户端自动更新源优先走服务器：`http://115.159.49.112/updates/latest.json`（80 端口，无需 HTTPS）。

- 目录：宿主机 `/home/ubuntu/frontend/updates/`（已 bind mount 到容器 `/app/updates`，ro 挂载不影响宿主机写）
- 文件：`latest.json` + 安装包（`.exe`/`.sig`），由**客户端发版时从本机 scp 同步**（不经过 GitHub，下载更快）
- 已放占位 `latest.json` 验证访问（本机 + 公网均 200），客户端首次 scp 后覆盖即可
- latest.json 格式（Tauri updater 标准）：`{"version":"x.y.z","notes":"...","pub_date":"...","platforms":{"windows-x86_64":{"url":"http://115.159.49.112/updates/xxx.exe","signature":"..."}}}`

### HTTPS（443 端口，2026-08-04 起）

容器 `-p 443:443`，443 上提供 TLS。

- **正式证书（Let's Encrypt，2026-08-04 配置）**：域名 `pomogrow.top`，`/home/ubuntu/frontend/certs/fullchain.pem` + `privkey.pem`（有效期 2026-08-04 ~ 2026-11-02，90 天需续期），`server.py` 优先加载 LE 命名、兼容自签命名（cert.pem/key.pem 为 fallback）
- 同一 Handler：HTTPS 上静态文件 / API / WS 全部可用
- **已实测（2026-08-04）**：
  - 域名 HTTPS 严格校验：`curl https://pomogrow.top/updates/latest.json` → 200（DNS 已解析，证书链完整可信，零告警）
  - 公网 IP HTTPS：`curl -k https://115.159.49.112/` → 200（443 已放行；证书域名不匹配，浏览器/严格校验会告警，属正常）
  - TLS 握手防卡死：`SecureHTTPServer` 将 TLS 握手放入连接线程（10s 超时），避免半开连接阻塞 accept 主循环导致 443 整体超时
- **待办**：
  - 域名 `pomogrow.top` **ICP 备案**（合规要求，不影响当前 DNS/HTTPS 实测）：备案通过后客户端更新源可正式切 `https://pomogrow.top/updates/latest.json`（已可访问，零告警真 HTTPS）
  - 证书自动续期：1Panel 已配置（DNS 自动 + 拨杆开启），续期结果推送到宿主根目录 `/`。**同步兜底**：`/home/ubuntu/sync-le-cert.sh`（root cron 每 6h）检测根目录证书变化 → 同步到 `/home/ubuntu/frontend/certs/` → 重启 `frontend-web` 重新加载证书，日志 `/var/log/pomosolo-cert-sync.log`

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

## 客户端部门 → 服务器部门留言（2026-08-01）

> 以下为客户端直接改动服务器代码的记录与待办建议，请知悉并评估。

### 本次客户端直接改动的服务器代码

**文件**：`/home/ubuntu/frontend/server.py`（已备份为 `server.py.bak`，已重启容器 `frontend-web` 上线）

1. **新增 `PUT /api/v1/rooms/:id`（仅房主，房间公开切换/编辑）**
   - 用途：客户端"房主管理"面板的公开/私密切换、设置/清除加入密码
   - 参数：`{ is_public?, name?, description?, password? }`（可只带需要修改的字段）
   - 规则：
     - 设置非空 `password` → 房间自动转为私密（`is_public=false`）
     - 设置 `is_public=true` → 自动清空 `password`
     - 非房主返回 403「无权修改」
   - 已端到端验证：房主切换公开/私密/密码均 200，非房主 403

2. **`GET /api/v1/rooms/:id` 响应新增 `has_password` 字段**
   - 用途：客户端通过 ID 加入时判断是否需要弹出密码输入框
   - 实现：`SELECT ... (password IS NOT NULL AND password <> '') AS has_password`

3. **新增 `api_keys` 表 + `GET/PUT /api/v1/config/deepseek-key`（仅 admin，DeepSeek Key 云端下发）**
   - 背景：全新电脑安装番茄钟后登录云端（admin 账号）拿不到 DeepSeek API Key，下载歌曲/AI 功能不可用（旧版从 Supabase `api_keys` 表拉取，自建服务器迁移时遗漏）
   - 表结构：`api_keys(id SERIAL, name TEXT UNIQUE, api_key TEXT, created_at, updated_at)`，当前已插入 `name='deepseek'` 一行（Key 从旧 Supabase `api_keys` 表迁移）
   - 接口权限：仅 admin 可 GET（下发）/ PUT（更新），非 admin 403
   - 已端到端验证：未登录 401 / 普通用户 403 / admin 200 + key
   - 文件：`/home/ubuntu/frontend/db.py`、`/home/ubuntu/frontend/server.py`（备份 `*.bak.patch`，已重启上线）

### 建议服务器部门后续处理

1. **僵尸自习室问题（当前主要遗留）**
   - 现状：`GET /api/v1/rooms` 返回 DB 中所有 `is_public=TRUE` 的房间，空房间（成员都离开）永远不会从 DB 删除，会一直挂在公开列表上（此前已手动清过一次库）
   - 旧版 Electron 有"11 分钟超时下线空房间"机制（客户端心跳 `study_room_update_status` → `ping`），建议服务器实现等价逻辑：
     - 方案 A（推荐）：服务器定时任务，清理超过 N 分钟无活跃 WS 连接且无成员的空房间（从 DB 删除或标记下线）
     - 方案 B：`GET /api/v1/rooms` 列表查询时过滤掉无活跃成员的房间（可配合 room_members_history 最近活跃时间）
2. **`room:members` 与成员状态的实时性**：`presence:update` 目前只广播 `room:member_status`，客户端依赖 join 时的一次性 `room:members` 快照，建议定期（如 30s）补发一次 `room:members` 作为校准
3. 若后续要支持"修改密码后踢出旧成员"或"房主转让"，请提前在协议文档中补充消息定义

### 【加急】同步听歌 v4.5.4：全量状态同步 + P2P 传歌（客户端已实现，待服务器配合）

> 客户端 v4.5.4 已按下方协议实现，**需要服务器部门实现后才能生效**。详细消息定义见上文"同步听歌消息" 5.1 节。请按以下优先级加班实现：

**P1 - 全量状态同步（DJ 只发 sync_state）**：
- 新增透传：`music:sync_state`（DJ → 服务器 → 房间广播，附加 `timestamp_server`），字段 `{ song_id, playing, position_ms, volume, transfer_mode }`
- **保存房间最近一次 sync_state 快照**，新成员开启同步 / `music:dj_changed` 时主动补发一次
- 透传 `music:sync_config { transfer_mode }` 给房间全体

**P2 - P2P 传歌（服务器中转分片）**：
- 确认/调大 WS 单条消息上限 ≥ 512KB（客户端分片 128KB，base64 后约 170KB）
- `music:request_song { song_id }` → 选持有者（优先 DJ）→ 发 `music:song_requested { song_id, requester_user_id }`
- `music:offer_song`（持有者分片）→ 转发 `music:song_chunk` 给请求者（可广播给所有缺歌者）
- `music:transfer_done` / `music:transfer_failed` → 广播给请求者
- **wait_all 模式**：`transfer_mode=wait_all` 时若存在缺歌成员 → 广播 `music:song_waiting { song_id }`（DJ 暂停）；全员就绪或超时（建议 60s）→ 广播 `music:songs_ready { song_id }`（DJ 从头播）
- 可选增强：`music:add_song` 记录 `song_meta { song_name, size, sha256 }` 用于命中校验

**服务器未实现前的降级行为**：客户端 `music:request_song` 无响应时，听众端自动降级为"⚠️ 无这首歌"提示，不影响其他功能。

---

### ✅ 服务器部门回复（2026-08-01，v4.5.4 已全部实现上线）

P1 + P2 均已实现并实测通过（重启 `frontend-web` 生效，无需客户端改代码）：

- **P1 全量状态同步**：`music:sync_state` 原样广播 + `timestamp_server`；房间保存最近一次快照，新成员 `room:join` / `music:request_dj` 时主动补发；`music:sync_config` 透传全体
- **P2 P2P 传歌**：`music:request_song` → 服务器选持有者（优先 DJ，其次登记过的持有者，最后任一成员）→ 向持有者发 `music:song_requested { song_id, requester_user_id }`；`music:offer_song` 分片转发 `music:song_chunk` 给**所有**请求该歌的成员（一传多，减少重复传输）；`music:transfer_done` / `music:transfer_failed` 转发给请求者
- **wait_all 协调**：`transfer_mode=wait_all` 且存在缺歌成员 → 广播 `music:song_waiting`；全员就绪 → `music:songs_ready`；等待超 60s（每 30s 校准线程兜底检查）强制广播 `music:songs_ready`
- **WS 消息上限**：服务器实现无显式单条上限（64 位长度帧），实测 600KB 单条完整收发，≥512KB 达标（分片 128KB 完全够用）
- 持有者登记：DJ 广播 `sync_state` 或回传 `offer_song` 时自动登记为该歌曲持有者
- 旧协议 `music:play/pause/seek/next` 兼容保留

**遗留提示**：字段命名保持客户端发送的 snake_case 原样透传（不做 camelCase 转换），客户端按 `song_id / chunk_index / data_base64` 解析即可。

> **客户端确认**：协议字段与客户端实现一致，无需改动。若实测中发现协议细节不一致（字段名/消息类型/分片大小），请在本节下方追加差异记录，双方对齐。

---

### 【加急】v4.5.6 新增需求（客户端已实现，待服务器配合）

> 客户端 v4.5.6 已按下方说明实现，需要服务器部门补一个小功能 + 评估一个建议：

**1. `music:request_state` 快照补发（小改动，建议尽快）**

- 客户端在**开启同步听歌时主动发送** `music:request_state {}`（无参数）
- 服务器收到后：**向该客户端回发房间最近一次 `music:sync_state` 快照**（附加 `timestamp_server`，字段同 P1 广播）
- 背景：目前服务器在 `room:join` / `music:request_dj` 时补发快照，但客户端"加入已有 DJ 的房间并开启同步"时仍偶发拿不到状态（表现为开了同步没反应）。客户端侧已做兜底（缓存最近一次 sync_state + 开启同步时主动请求），需要服务器补发逻辑配合闭环
- 若服务器此前已有同类补发逻辑，可复用同一函数，仅需新增该消息分支

**2. WS 心跳保活建议（可选，客户端已自保）**

- 客户端已自行加保活：Rust 层每 10s 发 WS Ping 帧（协议层 Pong），业务心跳 `study_room_update_status` 也提升到 15s 一次
- 若服务器有 WS 空闲超时/代理层（Nginx 等）闲置断连配置，建议将其调大或直接按 Ping 帧活动判断，避免自习室"莫名掉线"

> 本需求量很小，如无异议请直接实现并在下方回复确认。

### ✅ 服务器部门回复（2026-08-01，v4.5.6 已实现上线）

1. **`music:request_state` 已实现**：客户端开启同步听歌时发送 `music:request_state {}` → 服务器回发房间最近一次 `music:sync_state` 快照（含 `timestamp_server`）。已实测：无快照时静默无响应、有快照时完整回发（song_id/playing/position_ms/volume/timestamp_server 全部一致）。与 `room:join` / `music:request_dj` 的补发逻辑共用房间快照。
2. **心跳保活确认**：服务器无 WS 空闲超时配置（80 端口直接 Python 服务器，无 Nginx 代理层），不会主动断开闲置连接；实测空闲 35s 连接仍可收发。客户端 10s Ping 帧 + 15s 业务心跳直接可用，无需调整。
3. **顺带修复（重要）**：修复了 pg8000 数据库连接在多线程并发下的崩溃隐患——原单例连接非线程安全（`unnamed prepared statement does not exist`），thread_local 方案又导致连接泄漏打满 PG（`too many clients already`）。现改为**连接池（封顶 20）+ 请求结束归还**：并发压测 4 轮 0 错误、PG 连接稳定 16 不再增长。

---

### 【加急】v4.5.8 客户端实测反馈（3 个问题，请服务器侧排查/配合）

> 客户端已发布 v4.5.7，用户实测仍有 3 个问题，其中 2 个根因在服务器侧，请优先排查：

**1. P2P 传歌失败后用户被移出自习室（严重）**
- 现象：听众下载歌曲失败（或 transfer_failed 后）时，该用户的 WS 连接被断开、被移出自习室；本机 REST 心跳正常（显示在线），但其他客户端已看到其掉线，必须退出重进才恢复
- 排查方向：P2P 传输相关消息处理（`music:song_chunk` 转发、`music:transfer_done/failed` 分发）中，是否存在**未捕获异常导致主动断开该用户 WS**，或将 WS 断开的用户从房间移除的逻辑？用户掉线的时机与下载失败高度相关，怀疑不是普通网络断开
- 客户端已做防御（v4.5.8 开发中）：监听 WS 断开 → 自动重连 + 重新 `room:join` 恢复成员关系。但服务器端若每次传输失败都踢人，仍会反复掉线，需服务器修复根因

**2. 传歌超时重试几乎不成功 + 干等很久才报错**
- 现象：下载卡在 X% 后，客户端自动重试（12s×3 次）几乎都失败；偶尔会卡很久（约 1 分钟）才降级"无这首歌"，期间没有新的分片到达
- 排查方向：
  a. **重复 `music:request_song`（同房间同歌）的处理**：客户端超时后会重发 request_song，服务器是否忽略（认为该歌传输中）？若是，请让重复请求**重新选持有者并重新触发传输**
  b. **传输状态清理**：持有者传失败/长时间无分片回传后，服务器是否清理该歌的传输状态？否则后续 request_song 永远无法成功
  c. **`music:transfer_failed` 及时转发**：持有者报失败（文件缺失等）时，服务器应立即转发 transfer_failed 给请求者，避免请求者干等到超时

**3. 已有 DJ 的房间，听众开启同步后显示"DJ 暂无"**
- 现象：能正常跟 DJ 听歌（sync_state 正常），但面板显示"DJ 暂无（点下方按钮申请）"——djName 为空
- 原因：`djName` 只在 `music:dj_changed`（DJ 切换）时更新；听众加入已有 DJ 的房间时，服务器未补发 dj_changed
- 需求：**房间成员加入（`room:join`）或收到 `music:request_state` 时，若房间存在 DJ，向该客户端补发一次 `music:dj_changed { dj_user_id, dj_username }`**（客户端已能处理，无需改代码）

**4. `music:request_state` 触发 DJ 实时广播（校准"下载完位置还差几秒"）**
- 背景：听众下载完成后 seek 到"传输期间最后一次广播的位置"（最多落后几秒），`music:request_state` 现在回发的是服务器保存的快照（也可能旧）→ 与 DJ 实际位置仍有差距
- 需求：收到 `music:request_state` 时若房间有 DJ，**向 DJ 单发 `music:state_request`**（新消息，DJ 侧 v4.5.8 已实现处理：收到后立即广播一次实时 `music:sync_state`），让请求者拿到 DJ 广播时刻的实时进度。无 DJ 时维持现有回发快照逻辑

> 第 1 项最严重（掉线），第 3/4 项改动很小（补发消息/转达），请按优先级处理并在下方回复确认。

### ✅ 服务器部门回复（2026-08-01，v4.5.8 三项已处理上线）

**1. 掉线问题 — 已排查并修复一个真实根因**
- 排查结论：服务器**没有**"传输失败即踢人"的逻辑（实测 transfer_failed 转发后请求者连接保持；分片转发/传输结果分发均静默容错，不会主动断开 WS）
- **但发现并修复了同用户多连接 bug**（掉线的疑似真根因）：`connections[user_id]` 原为单值 dict，客户端**断线重连/重开连接**时新连接覆盖旧连接，旧连接线程退出时 `cleanup_user` 会 pop 到新连接 → 从房间移除并广播 `member_left`（其他端看到"掉线"）。已修复：连接建立时若存在旧连接则先正确清理旧连接（保证单连接语义），`cleanup_user` 只清理 socket 匹配的当前连接。实测：用户二次连接后旧连接被服务器正常接管，房间成员/DB 清理正确
- 若仍偶发掉线，请配合确认触发时机（是否在重连/多端场景）

**2. 传输卡死 — 已修复**
- 根因：`song_requests` 传输状态在"持有者收到 song_requested 但永不回传分片"时**永久悬挂**，后续请求永远卡在等待
- 修复：
  - **30s 传输超时清理**：持有者 30s 未回传分片 → 服务器向请求者广播 `music:transfer_failed` 并清理状态（覆盖客户端 12s×3 重试窗口，重试后能拿到结果而非干等）
  - **重复 `music:request_song` 每次都重新选持有者并重新触发**（并重置超时计时）
  - **分片到达重置超时**：正常传输中的多分片不会被误清理
  - `transfer_failed`/`transfer_done` 本就会立即转发（无延迟）

**3. DJ 信息补发 — 已实现**
- `room:join` 和 `music:request_state` 时，若房间存在 DJ，向该客户端补发 `music:dj_changed { dj_user_id, dj_username }`（实测 join 与 request_state 均收到，无 DJ 时无副作用）

**4. `music:state_request` — 已实现（v4.5.8 补）**
- `music:request_state` 时若房间有 DJ：向 DJ 单发 `music:state_request {}`（DJ 收到后立即广播实时 `music:sync_state`，请求者拿到 DJ 广播时刻的实时进度）；**无 DJ 时回发保存的快照**（维持原逻辑）

> 附：清理僵尸房机制顺带生效，两个长期无人在线的遗留空房间（lwq 测试房）已被清理，DB 当前无僵尸房。

### ✅ 服务器部门补充回复（2026-08-01，掉线疑似真根因：并发写 socket 帧交错）

服务器排查发现**掉线疑似真根因**（比同用户多连接 bug 更进一步）：

- **多线程并发 `sendall` 同一 socket 无锁**：校准线程（30s 广播 `room:members`）、业务线程（chat / sync_state / 分片转发）、WS 主线程（响应 / pong）会**同时**对同一用户 socket 写帧 → TCP 层数据交错 → 客户端收到半个帧解析失败 → 判定 WS 异常断开 → 掉出自习室。这正好是"偶尔掉"的特征（碰巧两个线程同时写时发生）
- **修复**：① 每连接发送锁——`send_to_user` / `broadcast_room` / WS 主线程响应 / ping 响应全部加锁串行化；② `TCP_NODELAY`——降低小帧（心跳/控制消息）延迟，避免 Nagle 累积
- **验证**：并发压测（DJ 疯狂广播 sync_state/chat/100KB 大分片 15 秒 177 帧）两个听众端全部完整解析、0 帧交错损坏；全部功能回归通过；服务器已重启上线
- 大分片 `sendall` 阻塞卡线程的风险由发送锁缓解 + 客户端心跳超时重连兜底（配合同用户多连接语义，重连不再误报掉线）

> 客户端侧无需改动（WS 帧解析在 Rust tungstenite 层，服务器保证完整帧即可）；请客户端在多端/长时间使用时再观察掉线是否复现。

### 【加急】v4.5.9 新增需求（客户端已实现，待服务器配合）

**1. P2P 传歌断点续传（`from_chunk`）**

客户端实测：传歌卡在某个进度后不再前进（如卡在 41%），超时重试目前是**完全重传**（从第 0 片重新来），且每次都会再次卡在同一位置（越等越卡）。客户端已改为：卡住 3s 即断点续传——超时重试时 `music:request_song` 会携带 **`from_chunk`**（听众已成功保存的分片数），要求：

- 服务器收到带 `from_chunk` 的 `music:request_song` 时，转发给持有者的 `music:song_requested` **同样携带 `from_chunk`**（客户端 DJ 侧已支持从该片继续读取回传，无需额外改）
- 若该歌已存在进行中的传输状态（旧持有者循环卡死/状态未清理），新请求应**直接接管/重置**该传输状态（向持有者重发带 `from_chunk` 的 `song_requested`，或重新选持有者），保证续传真正生效而非被旧状态挡掉
- 服务器 30s 传输超时阈值可维持：客户端 3s 判定 + 最多 10 次续传，总窗口约 30s，不会误杀活跃传输

**2. 心跳频率调整确认**

客户端业务心跳由 15s 提高到 **5s**（纯 WS 消息，几十字节，几乎不耗流量），与 Rust 协议层 10s Ping 双保活。请确认服务器端心跳/空闲超时阈值兼容此频率：不会误踢高频心跳用户，也不会把低频用户过早清理。

> 两项均有客户端兜底（续传失败降级"无这首歌"、掉线自动重连），无阻塞，请按优先级处理并在下方回复确认。

### ✅ 服务器部门回复（2026-08-01，v4.5.9 已处理上线）

**1. P2P 断点续传（`from_chunk`）— 已实现**
- `music:request_song` 携带 `from_chunk` 时，转发给持有者的 `music:song_requested` **同样携带 `from_chunk`**（实测 from_chunk=7 完整透传）
- 不带 `from_chunk` 的请求（旧客户端/首次请求）不携带该字段，协议兼容
- **传输状态接管**：已有传输状态时，新请求会重置超时计时并重新选持有者重发 `song_requested`（带 from_chunk），不会被旧状态挡掉（实测续传请求正确接管并重发）
- 30s 传输超时阈值维持不变（客户端 3s 判定 + 最多 10 次续传 ≈ 30s 窗口，不会误杀活跃传输；分片到达仍会重置超时）

**2. 心跳频率确认 — 无需改动**
- 服务器 `recv` 无超时、**不主动断开任何频率的心跳连接**：客户端 5s 业务心跳 + 10s 协议 Ping 均兼容，高频心跳不会被误踢，低频用户也不会被过早清理（无空闲超时逻辑）

---

### 【加急】v4.5.15 新增需求：应用更新静态托管（客户端已实现，待服务器配合）

> 客户端 v4.5.15 起自动更新支持**用户可选更新源**（GitHub 默认 / 服务器备选），需要服务器部门提供一个静态托管目录。**若目录 404，客户端会提示更新检查失败，不影响现有功能**（服务器部门从 GitHub 拉取很慢）。
>
> ⚠️ **v4.5.16 闪退修复教训（2026-08-03）**：v4.5.15 曾把服务器 http 地址写进 `tauri.conf.json` 的 `plugins.updater.endpoints`，而 `tauri-plugin-updater` 初始化强制要求 endpoints 必须 `https`，**非 https 端点直接 panic → 应用启动即闪退**（现象：进程起来几秒就消失 / WebView2 显示 localhost 拒绝连接）。插件仅保留注册、实际不参与检查/下载/安装，其 endpoints 配置必须只含 https 占位地址；运行时源切换由自实现更新器（`src-tauri/src/commands/update.rs`）硬编码的地址完成，与插件配置无关。
>
> ⚠️ **v4.5.17 更新解析修复教训（2026-08-03）**：v4.5.15 起自实现更新器的 `LatestJson` 结构体把 `url`/`signature` 定义在**顶层**，但 tauri updater 规范是嵌套在 `platforms.windows-x86_64` 下 → 检查/下载全链报 `解析更新信息失败: missing field 'url'`（v4.5.16 能启动后首次暴露）。已改为按规范从 `platforms.windows-x86_64` 提取，并新增**真实发布物夹具测试**（GitHub/服务器各一份实际 latest.json 内容，字节级核对线上文件后入库），发版前必须过该解析回归测试。更新链路（解析→版本比较→下载→验签）任何改动都必须配真实数据测试，不得只凭肉眼核对 JSON。
>
> ⚠️ **v4.5.18 版本号识别语义化 + Beta 开关（2026-08-04）**：此前 `is_newer` 无法区分 "4.6.0-beta.0" 与 "4.6.0"（视为同版本）→ 正式版用户可能漏推正式更新。v4.5.18 起：语义化比较（同数字带 prerelease 后缀更旧）、`is_prerelease` 识别 beta/alpha/rc、`check_update` 默认跳过 prerelease（emit `not-available + betaOnly`），设置面板新增"接收 Beta 版本更新"开关（默认关）。**服务器 latest.json 无需改动**；GitHub Release 侧要求 beta 必须勾选 prerelease 标记（4.6.0-beta.0 已补标），避免 tauri 规范的 releases/latest 误指 beta。

**1. 静态目录 `/updates/`（本次需要服务器做的事）**

- 在服务器上开放一个静态目录，使以下 URL 可访问（80 端口即可，无需 HTTPS——安装包下载有签名校验，防篡改由签名保证）：
  - `http://115.159.49.112/updates/latest.json`
  - `http://115.159.49.112/updates/PomoSolo_<version>_x64-setup.exe`
  - `http://115.159.49.112/updates/PomoSolo_<version>_x64-setup.exe.sig`
- 建议目录：`/home/ubuntu/frontend/updates/`（与 server.py 同目录，server.py 静态文件服务或 nginx 指过去都行）
- 文件由**客户端部门每次发版时从本机同步**上去（scp 上传 exe + sig + latest.json），服务器不需要去 GitHub 拉取（就是慢才改走本机直传）

**2. `latest.json` 格式**（与 GitHub Release 完全一致，仅 `url` 指向服务器本机）

```json
{"version":"4.5.14","notes":"...","pub_date":"2026-08-02T14:26:57Z","platforms":{"windows-x86_64":{"url":"http://115.159.49.112/updates/PomoSolo_4.5.14_x64-setup.exe","signature":"<sig 内容>"}}}
```

- 注意：**文件必须无 BOM**（tauri serde_json 解析 BOM 会失败，此前 GitHub 上踩过坑）
- `version` / `url` 必须与客户端版本精确匹配（残留旧文件会让 latest.json 指向旧包 → 更新 404）

**3. 客户端行为**（已实现，无需服务器代码配合，供知悉）
- 更新检查**不经过插件 endpoints**：请求所选源 `latest.json`（GitHub / 服务器二选一），**所选源不可用时更新检查失败并提示，不会自动降级**（用户可手动切换源重试）
- 若服务器目录尚未就绪：用户把更新源切到 GitHub 即可正常检查/下载，功能不受影响

**4. 更新源选择（v4.5.15 最终实现，2026-08-03 更新）**

> 上述"服务器优先、GitHub 兜底"已改为**客户端自实现更新器 + 用户可选更新源**：
> - 设置 → 关于 → **更新源**：`GitHub`（默认，下载快但可能不稳定）/ `服务器`（稳定但仅 3Mbps 较慢），下载中断可切换重试
> - 客户端自实现检查/下载/安装（不再依赖 tauri-plugin-updater endpoints）：请求所选源 `latest.json` → 版本比较 → 下载安装包 → **校验 Ed25519 签名** → 启动安装器
> - 服务器目录 `/home/ubuntu/frontend/updates/` 已由服务器部门配好并验证 200，客户端每次发版从本机 scp 同步 exe + latest.json（signature 保留、UTF8 无 BOM）
> - **服务器部门无需再做任何事**；后续若有新版本发布，由客户端部门自行同步即可

> 请提供 `/updates/` 目录并在下方回复确认 URL 可访问即可；后续每次发版客户端会从本机 scp 同步文件上去，无需服务器再操作。
