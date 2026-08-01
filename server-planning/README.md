# PomoSolo 服务端需求规格说明

> **状态**: 草案  
> **目标**: 从 Supabase 迁移到自建公网服务器，支撑现有功能 + 未来同步听歌/自习室等实时功能  
> **服务器 IP/域名**: `___________`（备案未完成，先留空）

---

## 1. 概述

### 1.1 当前 Supabase 使用情况
| 功能 | Supabase 服务 | 需迁移到 |
|------|-------------|---------|
| 用户注册/登录 | Supabase Auth (GoTrue) | 自建 JWT 认证 |
| Session 管理 | Supabase Auth | 自建 token 刷新 |
| 反馈提交/查询 | Supabase REST (PostgREST) | 自建 REST API |
| 模式切换（API/本地） | 通过 API 开关控制 | 自建配置接口 |
| 连接测试 | Supabase health check | 自建 health 端点 |

### 1.2 推荐技术栈
```
语言:     Go (高性能, 单二进制部署) 或 Node.js (生态丰富, 与前端同语言)
数据库:   PostgreSQL 16
缓存:     Redis 7 (session / 在线状态 / 实时消息)
实时通信: WebSocket (gorilla/websocket 或 socket.io)
反向代理: Nginx (HTTPS 终结)
容器化:   Docker Compose 一键部署
```

---

## 2. 端口规划

### 2.1 对外端口（Nginx 监听）
| 端口 | 协议 | 用途 |
|------|------|------|
| 80 | HTTP | 所有 HTTP 请求入口（Nginx 反向代理） |
| 443 | HTTPS | HTTPS 入口（等备案+SSL 证书下来后启用） |

### 2.2 内部端口（仅 localhost / Docker 内网）
| 端口 | 协议 | 服务 | 说明 |
|------|------|------|------|
| 3000 | HTTP | API Server | REST API 主服务 |
| 3001 | WebSocket | WS Server | 实时通信（自习室、同步听歌、心跳） |
| 5432 | TCP | PostgreSQL | 数据库（不对外暴露） |
| 6379 | TCP | Redis | 缓存&消息（不对外暴露） |

### 2.3 Nginx 路由规则
```
                     ┌─ /api/* ──────────► localhost:3000 (REST API)
    :80/:443 ─── nginx ─┼─ /ws ──────────────► localhost:3001 (WebSocket)
                     ├─ /health ──────────► localhost:3000/health
                     └─ /update/* ────────► 静态文件（latest.json, exe）
```

**服务器防火墙只需开放 80 和 443 端口。**

---

## 3. 数据库设计

### 3.1 核心表

```sql
-- 用户表（替代 Supabase Auth）
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username      VARCHAR(100) UNIQUE NOT NULL,   -- 登录标识（客户端用用户名登录）
    email         VARCHAR(255) UNIQUE,            -- 可选，未来找回密码用
    password_hash VARCHAR(255) NOT NULL,          -- bcrypt（迁移脚本按 Supabase 的 PBKDF2-SHA512 格式导入）
    nickname      VARCHAR(100),
    avatar_url    TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 会话表（JWT refresh token）
CREATE TABLE sessions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES users(id) ON DELETE CASCADE,
    refresh_token TEXT UNIQUE NOT NULL,
    expires_at    TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 反馈表（替代 Supabase feedback 表）
CREATE TABLE feedbacks (
    id              SERIAL PRIMARY KEY,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    feedback_content TEXT NOT NULL,
    feedback_status SMALLINT DEFAULT 0,           -- 0=待处理, 1=处理中, 2=已采纳, 3=已拒绝
    remark          TEXT,                          -- 管理员回复/拒绝理由
    create_time     TIMESTAMPTZ DEFAULT NOW(),
    update_time     TIMESTAMPTZ DEFAULT NOW()
);

-- 用户设置表（云端同步）
CREATE TABLE user_settings (
    user_id   UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settings  JSONB NOT NULL DEFAULT '{}',        -- 完整 settings 对象
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 番茄钟记录（云端备份）
CREATE TABLE pomodoro_records (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    mode        VARCHAR(20) NOT NULL,              -- focus/short_break/long_break
    duration    INT NOT NULL,                      -- 实际计时秒数
    completed   BOOLEAN DEFAULT TRUE,
    started_at  TIMESTAMPTZ NOT NULL,
    ended_at    TIMESTAMPTZ
);
CREATE INDEX idx_pomodoro_user ON pomodoro_records(user_id, started_at DESC);
```

### 3.2 未来扩展表

```sql
-- 同步听歌：歌单表
CREATE TABLE shared_playlists (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(200) NOT NULL,
    is_public   BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 同步听歌：歌单歌曲
CREATE TABLE playlist_songs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    playlist_id UUID REFERENCES shared_playlists(id) ON DELETE CASCADE,
    song_name   VARCHAR(300) NOT NULL,
    song_url    TEXT,                              -- 外链或服务器存储 URL
    duration    INT,                               -- 秒
    sort_order  INT DEFAULT 0
);

-- 自习室：房间表
CREATE TABLE study_rooms (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(200) NOT NULL,
    owner_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    max_members INT DEFAULT 50,
    is_public   BOOLEAN DEFAULT TRUE,
    password    VARCHAR(100),                      -- 可选房间密码
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 自习室：成员记录（历史统计用）
CREATE TABLE room_members_history (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id     UUID REFERENCES study_rooms(id) ON DELETE CASCADE,
    user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
    joined_at   TIMESTAMPTZ DEFAULT NOW(),
    left_at     TIMESTAMPTZ
);
```

---

## 4. API 接口清单

### 基础约定
- **Base URL**: `http://___________/api/v1`
- **Content-Type**: `application/json`
- **认证方式**: `Authorization: Bearer <access_token>`
- **Access Token 有效期**: 15 分钟
- **Refresh Token 有效期**: 30 天

---

### 4.1 认证模块

#### `POST /api/v1/auth/register`
注册新用户
```
Request:
{
  "username": "番茄侠",            // ← 登录标识，必填（客户端登录框是用户名）
  "email": "user@example.com",     // 可选（未来找回密码用）
  "password": "********"
}

Response 201:
{
  "user": { "id": "uuid", "username": "...", "email": "...", "nickname": "..." },
  "access_token": "eyJ...",
  "refresh_token": "r_..."
}

Response 409: { "error": "用户名已注册" }
```

> **⚠️ 重要说明（对服务器部门）**：客户端登录表单是**用户名 + 密码**，不是邮箱。
> 请保证：
> 1. `users` 表必须支持 `username` 字段作为唯一登录标识（当前表结构是 `email` 主登录，需新增 `username VARCHAR UNIQUE`）。
> 2. `POST /auth/login` 同时接受 `username` 或 `email` 字段（兼容两端）。
> 3. 返回的 `user` 对象里必须有 `username` 字段（客户端 Session 依赖）。
> 4. 老数据迁移脚本会按 Supabase 的 `users` 表（id, username, password_hash, salt）导入。

#### `POST /api/v1/auth/login`
登录
```
Request:
{
  "username": "番茄侠",           // 或 "email"
  "password": "********"
}

Response 200:
{
  "user": { "id": "uuid", "username": "...", "email": "...", "nickname": "..." },
  "access_token": "eyJ...",
  "refresh_token": "r_..."
}

Response 401: { "error": "用户名或密码错误" }
```

#### `POST /api/v1/auth/refresh`
刷新 access token
```
Request:
{
  "refresh_token": "r_..."
}

Response 200:
{
  "access_token": "eyJ...",
  "refresh_token": "r_..."   // 同时下发新的 refresh token (滚动刷新)
}

Response 401: { "error": "refresh token 无效或已过期" }
```

#### `POST /api/v1/auth/logout`
登出（使 refresh token 失效）
```
Headers: Authorization: Bearer <access_token>

Response 204: (no body)
```

#### `GET /api/v1/auth/session`
获取当前会话信息（替代 Supabase `cloudGetSession`）
```
Headers: Authorization: Bearer <access_token>

Response 200:
{
  "user": { "id": "uuid", "email": "...", "nickname": "..." }
}

Response 401: { "error": "未登录" }
```

---

### 4.2 反馈模块（替代 Supabase feedback 表）

#### `POST /api/v1/feedback`
提交反馈
```
Headers: Authorization: Bearer <access_token>

Request:
{
  "content": "希望增加暗色主题"   // 最长 500 字
}

Response 201:
{
  "id": 1,
  "content": "希望增加暗色主题",
  "status": 0,
  "create_time": "2026-07-31T..."
}

Response 400: { "error": "内容不能为空 / 超过 500 字" }
```

#### `GET /api/v1/feedback`
获取当前用户的反馈列表
```
Headers: Authorization: Bearer <access_token>

Response 200:
{
  "feedbacks": [
    {
      "id": 1,
      "feedback_content": "...",
      "feedback_status": 0,
      "remark": null,
      "create_time": "..."
    }
  ]
}
```

#### `DELETE /api/v1/feedback/:id`
删除反馈
```
Headers: Authorization: Bearer <access_token>

Response 204

Response 403: { "error": "无权删除" }
Response 404: { "error": "反馈不存在" }
```

---

### 4.3 配置模块

#### `GET /api/v1/config/mode`
获取当前模式（替代 Supabase `getApiMode`）
```
无需认证

Response 200:
{
  "mode": "cloud"    // "cloud" | "local"
}
```

#### `GET /api/v1/health`
健康检查
```
无需认证

Response 200:
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 123456
}
```

---

### 4.4 用户数据同步

#### `GET /api/v1/settings`
拉取云端设置
```
Headers: Authorization: Bearer <access_token>

Response 200:
{
  "settings": { "theme": "dark", ... },
  "updated_at": "2026-07-31T..."
}
```

#### `PUT /api/v1/settings`
上传设置到云端
```
Headers: Authorization: Bearer <access_token>

Request:
{
  "settings": { "theme": "dark", ... }
}

Response 200: { "ok": true }
```

#### `POST /api/v1/pomodoro/records/batch`
批量上传番茄钟记录
```
Headers: Authorization: Bearer <access_token>

Request:
{
  "records": [
    { "mode": "focus", "duration": 1500, "completed": true, "started_at": "...", "ended_at": "..." }
  ]
}

Response 200: { "synced": 5 }
```

---

### 4.5 自动更新

前端仍使用 GitHub Releases，本服务器仅作为国内 CDN 加速：

#### `GET /update/latest.json`
返回最新版本信息（静态文件，由 CI 自动更新）
```
Response 200:
{
  "version": "4.2.4",
  "notes": "...",
  "pub_date": "...",
  "platforms": {
    "windows-x86_64": {
      "url": "https://服务器IP或域名/update/PomoSolo_4.2.4_x64-setup.exe",
      "signature": "..."
    }
  }
}
```

#### `GET /update/PomoSolo_x.x.x_x64-setup.exe`
安装包下载（静态文件）

---

## 5. 未来功能设计

### 5.1 同步听歌

#### 核心思路
- 房间内一名"DJ"控制播放（播放/暂停/切歌/进度）
- 其他"听众"同步 DJ 的播放状态
- 音乐文件不通过服务器中转，客户端各自本地播放，仅通过 WebSocket 同步**控制指令 + 时间戳**

#### 消息协议（WebSocket）

```
连接: ws://___________/ws?token=<access_token>&room=<room_id>

客户端 → 服务端:
─────────────────

# DJ 操作事件
{ "type": "music:play",      "song_id": "uuid", "position_ms": 0 }      // 开始播放
{ "type": "music:pause",     "position_ms": 12500 }                      // 暂停
{ "type": "music:seek",      "position_ms": 30000 }                      // 跳转
{ "type": "music:next",      "song_id": "uuid" }                         // 切歌
{ "type": "music:volume",    "volume": 0.8 }                             // 音量（广播用）
{ "type": "music:add_song",  "song_name": "...", "song_url": "..." }     // 加歌

# 非 DJ 角色
{ "type": "music:request_dj" }                                           // 申请当 DJ


服务端 → 全体客户端:
─────────────────

{ "type": "music:state",     "action": "play",  "song_id": "...",
  "position_ms": 0, "timestamp_server": 1712240000000 }

{ "type": "music:state",     "action": "pause", "position_ms": 12500,
  "timestamp_server": 1712240005000 }

{ "type": "music:state",     "action": "seek",  "position_ms": 30000,
  "timestamp_server": 1712240010000 }

{ "type": "music:dj_changed", "dj_user_id": "uuid", "dj_nickname": "..." }

{ "type": "music:playlist_updated", "songs": [...] }
```

#### 同步精度策略
```
客户端收到 music:state 后计算:
  elapsed = Date.now() - timestamp_server
  local_position = position_ms + elapsed

如果 local_position 与当前播放偏差 > 200ms → 静默 seek 到正确位置
每 30 秒服务端广播一次当前状态作为校准点
```

---

### 5.2 自习室

#### 核心思路
- 创建/加入房间（可设密码）
- 实时显示在线成员及其番茄钟状态（专注中/休息中/空闲）
- 轻量聊天（可选）
- 房间内番茄钟排行榜（今日/本周）

#### WebSocket 消息协议

```
连接: ws://___________/ws?token=<access_token>

客户端 → 服务端:
─────────────────

# 房间操作
{ "type": "room:create",     "name": "深夜学习局", "max_members": 50, "password": "" }
{ "type": "room:join",       "room_id": "uuid", "password": "" }
{ "type": "room:leave" }

# 状态上报（每 10 秒心跳自动携带）
{ "type": "presence:update", "status": "focusing" }
// status: "idle" | "focusing" | "short_break" | "long_break"

# 可选聊天
{ "type": "room:chat",       "message": "加油！" }


服务端 → 客户端:
─────────────────

# 房间事件
{ "type": "room:created",    "room": { "id": "uuid", "name": "...", "owner": {...} } }
{ "type": "room:members",    "members": [
    { "user_id": "uuid", "nickname": "...", "status": "focusing", "joined_at": "..." }
  ]}

# 成员变动
{ "type": "room:member_joined",  "user": { "id": "uuid", "nickname": "..." } }
{ "type": "room:member_left",    "user_id": "uuid" }
{ "type": "room:member_status",  "user_id": "uuid", "status": "focusing" }

# 聊天
{ "type": "room:chat",       "user_id": "uuid", "nickname": "...", "message": "加油！", "time": "..." }

# 番茄完成广播
{ "type": "room:pomo_done",  "user_id": "uuid", "nickname": "...", "mode": "focus" }
```

#### REST API 补充

```
GET    /api/v1/rooms              → 公开房间列表（分页 + 搜索）
GET    /api/v1/rooms/:id          → 房间详情
DELETE /api/v1/rooms/:id          → 删除房间（仅房主）
GET    /api/v1/rooms/:id/leaderboard?period=today → 排行榜
```

---

### 5.3 心跳 & 在线状态

#### 设计
```
客户端每 10 秒发送:
{ "type": "ping" }

服务端回复:
{ "type": "pong", "server_time": 1712240000000 }

超过 30 秒未收到 ping → 服务端将用户标记为 offline 并广播给相关房间
```

#### Redis 存储
```
在线用户:    HSET online_users <user_id> { "status": "focusing", "room_id": "...", "last_seen": 1712240000 }
房间成员:    SADD room:<room_id>:members <user_id>
用户所在房间: SET user:<user_id>:room <room_id>
```

---

## 6. 部署说明

### 6.1 Docker Compose 一键部署

```yaml
# docker-compose.yml
version: "3.9"

services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./update-files:/usr/share/nginx/html/update
    depends_on:
      - api

  api:
    build: ./api
    ports:
      - "127.0.0.1:3000:3000"    # 仅本机暴露
    environment:
      DATABASE_URL: postgres://pomo:pomo_pass@db:5432/pomosolo
      REDIS_URL: redis://redis:6379
      JWT_SECRET: <生成一个随机字符串>
    depends_on:
      - db
      - redis
    restart: always

  ws:
    build: ./ws
    ports:
      - "127.0.0.1:3001:3001"
    environment:
      REDIS_URL: redis://redis:6379
      JWT_SECRET: <同上>
    depends_on:
      - redis
    restart: always

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: pomo
      POSTGRES_PASSWORD: <强密码>
      POSTGRES_DB: pomosolo
    volumes:
      - pgdata:/var/lib/postgresql/data
    restart: always

  redis:
    image: redis:7-alpine
    volumes:
      - redisdata:/data
    restart: always

volumes:
  pgdata:
  redisdata:
```

### 6.2 启动步骤

```bash
# 1. 把代码放到服务器
git clone <你的仓库> /opt/pomosolo-server

# 2. 修改环境变量（JWT_SECRET、数据库密码等）
cp .env.example .env
vim .env

# 3. 启动
docker compose up -d

# 4. 初始化数据库
docker compose exec api ./migrate up
```

### 6.3 客户端需要改的地方

当前客户端 `src/api/auth.ts` 中调用 Supabase SDK 的地方需要改为调用自建 API：

| 当前 Supabase 调用 | 替换为 |
|-------------------|--------|
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

### 6.4 安全注意事项

```
- JWT_SECRET 必须 256 位以上随机值
- PostgreSQL 密码必须强密码
- Redis 建议设置密码 (requirepass)
- Nginx 配置 rate limiting
- 所有密码放 .env 文件，不要提交到 Git
- 建议用 fail2ban 防止暴力破解
```

---

## 7. 环境变量清单

```bash
# .env 文件 —— 发给服务器管理员

# 数据库
DATABASE_URL=postgres://pomo:替换为强密码@db:5432/pomosolo?sslmode=disable

# Redis
REDIS_URL=redis://:替换为redis密码@redis:6379

# JWT
JWT_SECRET=替换为至少32位随机字符串
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=720h   # 30天

# 服务端口
API_PORT=3000
WS_PORT=3001

# 服务器配置
API_MODE=cloud             # cloud 表示开放云端功能
SERVER_DOMAIN=___________   # 域名（备案后填写）
```
