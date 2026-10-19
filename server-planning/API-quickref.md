# API 速查卡

> **状态**：当前（只作快速查表）。
> 权威索引是 [`EXTERNAL-INTERFACES.md`](./EXTERNAL-INTERFACES.md)；
> 实现记录与留言见 [`API-implementation.md`](./API-implementation.md)。

## Base URL

```
REST:   https://api.pomogrow.top/api/v1
健康:   https://api.pomogrow.top/api/health      # 注意：不在 /api/v1 下
状态:   https://api.pomogrow.top/api/status
WS:     wss://api.pomogrow.top/ws?token=<access_token>
```

> ⚠️ `/api/v1/health` **不存在**（返回 404）。客户端连接测试的顺序是
> `/api/status` → `/api/v1/health`，成功命中前者即可。

## 认证

```
Authorization: Bearer <access_token>
```

Access Token 15 分钟；过期后用 refresh token 换新（30 天滚动）。
客户端用 **username**（不是 email）登录；`/auth/login` 同时接受 username 或 email。

## 常用端点

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| POST | `/api/v1/auth/register` | 否 | 注册（username + password） |
| POST | `/api/v1/auth/login` | 否 | 登录 |
| POST | `/api/v1/auth/refresh` | 否 | 刷新 token |
| POST | `/api/v1/auth/logout` | 是 | 登出 |
| GET | `/api/v1/auth/session` | 是 | 当前会话 |
| GET | `/api/health` | 否 | `{"status":"ok","version","uptime"}` |
| GET | `/api/status` | 否 | 服务名/版本/python/平台/ws_port |
| GET | `/api/v1/settings` | 是 | 拉取云端设置 |
| PUT | `/api/v1/settings` | 是 | 上传设置 |
| POST | `/api/v1/pomodoro/records/batch` | 是 | 批量上传番茄钟记录 |
| GET | `/api/v1/feedback` | 是 | 我的反馈 |
| POST | `/api/v1/feedback` | 是 | 提交反馈 |
| GET | `/api/v1/rooms` | 是 | 公开房间 |
| GET | `/api/v1/rooms/:id` | 是 | 房间详情 |
| GET | `/api/v1/rooms/:id/leaderboard` | 是 | 房间排行 |

完整端点、WS 消息、P2P 信令、更新源见 `EXTERNAL-INTERFACES.md`。

## 端口（线上）

```
对外: 443 (HTTPS)
内部: 8080 (REST + 静态 + /ws upgrade) / 3001 (WS 备用) / 5432 (PostgreSQL)
```

无 Nginx、无 Redis。旧草案里的 3000/6379 已不适用。
