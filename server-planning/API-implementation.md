# PomoSolo API 实现文档

> **状态**: 已实现并部署  
> **技术栈**: Python 3 + ThreadingHTTPServer + WebSocket + PostgreSQL 16  
> **运行环境**: Docker 容器 `frontend-web`，与 PostgreSQL 容器 `pg-elephant` 共同运行

---

## 架构概览

```
单容器 (frontend-web, python:3-alpine)
  ├─ ThreadingHTTPServer (:8080)    REST API + 静态文件
  └─ WebSocket Server (:3001)       自习室 + 同步听歌（后台线程 + asyncio）

Docker 网络: 1panel-network
  ├─ frontend-web  ←→  pg-elephant (PostgreSQL 16)
  ├─ 公网端口: 80 → 8080, 8080 → 8080, 3001 → 3001
  └─ 内部端口: 5432 (仅 127.0.0.1)
```

### 文件结构

```
/home/ubuntu/frontend/
  ├─ server.py          # REST API 主服务器（ThreadingHTTPServer）
  ├─ db.py              # PostgreSQL 连接 + 建表
  ├─ auth.py            # PBKDF2 密码哈希 + JWT 签发/验证
  ├─ ws_server.py       # WebSocket 服务器（自习室 + 同步听歌）
  ├─ index.html         # Vue 3 前端门面页面
  ├─ requirements.txt   # Python 依赖（pg8000, websockets）
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
- 密码哈希: PBKDF2-SHA512，100000 次迭代

---

## REST API 接口清单

### P0 - 认证模块

#### POST /api/v1/auth/register
注册新用户。
```json
// Request
{ "email": "user@example.com", "password": "******", "nickname": "番茄侠" }

// Response 201
{ "user": { "id": "uuid", "email": "...", "nickname": "..." },
  "access_token": "eyJ...", "refresh_token": "r_..." }

// Response 409: { "error": "邮箱已注册" }
```

#### POST /api/v1/auth/login
登录。
```json
// Request
{ "email": "user@example.com", "password": "******" }

// Response 200
{ "user": { "id": "uuid", "email": "...", "nickname": "..." },
  "access_token": "eyJ...", "refresh_token": "r_..." }
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
    "max_members": 50, "is_public": true, "created_at": "..." }] }
```

#### GET /api/v1/rooms/:id
获取房间详情。
```json
// Response 200
{ "id": "uuid", "name": "...", "owner_id": "uuid", "max_members": 50, ... }
```

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
ws://服务器地址:3001?token=<access_token>
```

连接时通过 URL query 传递 JWT token，验证失败则关闭连接。

### 自习室消息

#### 客户端 → 服务端

| type | 说明 | 参数 |
|------|------|------|
| `room:create` | 创建房间 | `name`, `max_members`, `password` |
| `room:join` | 加入房间 | `room_id`, `password` |
| `room:leave` | 离开房间 | - |
| `presence:update` | 更新状态 | `status`: idle/focusing/short_break/long_break |
| `room:chat` | 发送消息 | `message` |
| `room:pomo_done` | 番茄完成 | `mode`: focus/short_break/long_break |
| `ping` | 心跳 | - |

#### 服务端 → 客户端

| type | 说明 |
|------|------|
| `room:created` | 房间创建成功 |
| `room:members` | 成员列表（含状态） |
| `room:member_joined` | 有成员加入 |
| `room:member_left` | 有成员离开 |
| `room:member_status` | 成员状态更新 |
| `room:chat` | 聊天消息 |
| `room:pomo_done` | 番茄完成广播 |
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

---

## 数据库表结构

| 表名 | 说明 |
|------|------|
| `users` | 用户（UUID 主键, email, password_hash, nickname） |
| `sessions` | 会话（refresh_token, expires_at） |
| `feedbacks` | 反馈（content, status, remark） |
| `user_settings` | 用户设置（JSONB） |
| `pomodoro_records` | 番茄钟记录（mode, duration, started_at） |
| `study_rooms` | 自习室房间 |
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
| `WS_PORT` | 3001 | WebSocket 端口 |
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
  -p 80:8080 -p 8080:8080 -p 3001:3001 \
  -e PG_HOST=pg-elephant -e PG_PORT=5432 \
  -e PG_USER=postgres -e PG_PASSWORD=<密码> \
  -e PG_DB=appdb -e PORT=8080 -e WS_PORT=3001 \
  -e JWT_SECRET=<随机字符串> -e API_MODE=cloud \
  python:3-alpine \
  sh -c "pip install -i https://pypi.tuna.tsinghua.edu.cn/simple pg8000 websockets -q; exec python -u /app/server.py"
```

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
