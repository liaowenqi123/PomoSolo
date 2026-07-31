# API 速查卡

> 给服务器开发者：这是 PomoSolo 客户端会调用的所有接口，请严格按此规范实现。

## Base URL
`___________/api/v1`（域名备案后填写）

## 认证方式
```
Authorization: Bearer <access_token>
```
Access Token 有效期 15 分钟，过期后用 refresh token 换新的。

---

## 接口清单（按优先级）

### P0 - 必须实现（当前 Supabase 在用）

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | `/auth/register` | 否 | 注册：email + password → user + tokens |
| POST | `/auth/login` | 否 | 登录：email + password → user + tokens |
| POST | `/auth/refresh` | 否 | 刷新：refresh_token → 新 tokens |
| POST | `/auth/logout` | 是 | 登出：删除 refresh token |
| GET  | `/auth/session` | 是 | 当前会话信息 |
| GET  | `/config/mode` | 否 | 返回 `{"mode":"cloud"}` |
| GET  | `/health` | 否 | 返回 `{"status":"ok"}` |
| POST | `/feedback` | 是 | 提交反馈 { content } |
| GET  | `/feedback` | 是 | 获取我的反馈列表 |
| DELETE | `/feedback/:id` | 是 | 删除我的反馈 |

### P1 - 近期需要（数据同步）

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET  | `/settings` | 是 | 拉取云端设置 |
| PUT  | `/settings` | 是 | 上传设置 |
| POST | `/pomodoro/records/batch` | 是 | 批量上传番茄钟记录 |

### P2 - 未来功能（自习室 + 同步听歌）

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET  | `/rooms` | 是 | 公开房间列表 |
| GET  | `/rooms/:id` | 是 | 房间详情 |
| DELETE | `/rooms/:id` | 是 | 删除房间（房主） |
| GET  | `/rooms/:id/leaderboard` | 是 | 排行榜 |

WebSocket: `ws://___________/ws?token=<access_token>`

---

## 端口总结

```
对外: 80 (HTTP) + 443 (HTTPS, 备案后)
内部: 3000 (API) + 3001 (WebSocket) + 5432 (PG) + 6379 (Redis)
```
