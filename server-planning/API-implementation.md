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
  "is_public": true, "description": "...", "created_at": "...",
  "has_password": false }
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
| `room:chat` | 聊天消息：`{ user_id, username, message, time }` |
| `room:pomo_done` | 番茄完成广播：`{ user_id, username, mode }` |
| `pong` | 心跳回复（含 server_time） |
| `error` | 错误信息 |

---

### 同步听歌消息

**设计原则**: 音频文件不经服务器中转，仅同步播放器动作和时间戳。

#### 客户端 → 服务端（DJ 操作）

| type | 说明 | 参数 |
|------|------|------|
| `music:play` | 开始播放 | `song_id`, `position_ms` |
| `music:pause` | 暂停 | `position_ms` |
| `music:seek` | 跳转 | `position_ms` |
| `music:next` | 切歌 | `song_id` |
| `music:volume` | 音量 | `volume`: 0-1 |
| `music:add_song` | 加歌 | `song_name`, `song_url` |
| `music:request_dj` | 申请当 DJ | - |

#### 服务端 → 全体客户端

| type | 说明 |
|------|------|
| `music:state` | 播放状态同步（action + position_ms + timestamp_server） |
| `music:dj_changed` | DJ 切换 |
| `music:playlist_updated` | 歌单更新 |
| `music:volume` | 音量同步 |

#### 同步精度策略
```
客户端收到 music:state 后计算:
  elapsed = Date.now() - timestamp_server
  local_position = position_ms + elapsed

偏差 > 200ms 时静默 seek 到正确位置。
每 30 秒服务端可广播一次当前状态作为校准点。
```

#### 缺歌处理（听众端本地无 DJ 播放的歌曲）

**现状（v4.5+ 已实现）**：音频文件不中转，听众本地没有 DJ 的歌时无法播放。

- 客户端 `stores/music.ts`：
  - 收到 `music:state`（action=play）时，若本地歌单已加载且不含 `song_id` → 停止播放并设置 `missingSongName`，播放器曲名位置显示 **"⚠️ 无这首歌：《歌名》"**
  - `playSong` 播放失败（`song_missing`）时同样兜底设置
  - 歌单刷新（`music:playlist_updated` → `music-playlist`）后若该歌已出现则自动清除提示
- 局限：听众只能看到提示，无法获取音频文件本身。

**规划（待实施）— P2P 点对点传歌**：
> 用户需求：未来搭建 P2P 传输，让客户端把歌直接传给对方，替代"无这首歌"提示。

- 目标：听众本地无歌时，向 DJ（或任一持有该文件的在线成员）发起拉取，传输完成后本地播放并缓存到 `app_data_dir/music`（复用 `merge_music_dir` 的存储区）
- 候选方案：
  1. **服务器中转**（简单优先）：`music:request_song { song_id }` → 持有者 `music:offer_song { song_id, chunk_index, data_base64 }` 分片上传服务器 → 服务器 `music:song_chunk` 转发给请求者 → 请求者拼接写入本地。受服务器带宽/ws 消息大小限制，需分片（如 256KB/片）。
  2. **WebRTC 直连**（更优）：客户端间通过 WS 信令（`signal` 交换 SDP/ICE）建立 DataChannel 直接传文件，服务器只做信令协调。Tauri 2 可用 `simple-peer` 或原生 WebRTC；注意 Tauri WebView（WebView2/Safari/WebKitGTK）对 DataChannel 的支持差异。
  3. **文件指纹校验**：传输前用 `sha256(file_name)` 或大小+名称比对，避免重复传输。
- 协议预留：建议在 `music:add_song` 时同时广播 `song_meta { song_name, size, sha256 }`，为 P2P 命中校验做准备。
- 风险：WS 单条消息大小限制（服务器端需确认）、大文件分片序号/乱序处理、离线成员持有的歌不可用时的降级提示。

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
