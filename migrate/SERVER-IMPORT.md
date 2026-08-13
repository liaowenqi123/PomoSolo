# 服务器部门：从 Supabase 拉取并导入数据

> **状态**: ✅ 已完成（2026-08-01）
>
> ⚠️ **凭据已移除**：本文件原包含 Supabase 项目 URL 和 API Key，因本项目即将公开到 GitHub，
> 且迁移已全部完成，故凭据已从仓库中删除。Supabase 项目建议尽快关停（数据已全部迁移，
> 继续保留存在数据泄露风险）。如需复跑迁移流程，请向管理员索取新的凭据后替换下方占位符。

---

## 1. Supabase 凭据（已移除）

| 项 | 值 |
|----|----|
| 项目 URL | `<SUPABASE_URL>` |
| API Key（anon/publishable） | `<ANON_KEY>` |
| REST 基地址 | `<SUPABASE_URL>/rest/v1` |

> anon key 是 Supabase 设计为公开的（权限由数据库 RLS 控制），
> 但本项目 users / feedback / study_rooms 表 RLS 均放行（`USING (true)`），
> 任何拿到 key 的人可读全部数据。迁移完成后关停/删除 Supabase 项目是最安全的做法。

## 2. 拉取方式（curl 示例）

所有请求带两个 header：

```bash
H_AUTH=(
  -H "apikey: <ANON_KEY>"
  -H "Authorization: Bearer <ANON_KEY>"
)

curl -s "${H_AUTH[@]}" \
  "<SUPABASE_URL>/rest/v1/users?select=*" -o users.json

curl -s "${H_AUTH[@]}" \
  "<SUPABASE_URL>/rest/v1/feedback?select=*" -o feedbacks.json

curl -s "${H_AUTH[@]}" \
  "<SUPABASE_URL>/rest/v1/study_rooms?select=*" -o study_rooms.json
```

如数据量大（>1000 行），加分页：`?select=*&offset=0&limit=1000` 循环拉取。

## 3. Supabase 表字段（客户端实际使用到的）

### users（用户）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | integer | 旧主键（迁移时需映射为服务器的新 UUID） |
| `username` | text | **登录标识，UNIQUE**（必迁） |
| `password_hash` | text | PBKDF2-SHA512 哈希 hex（128 字符） |
| `salt` | text | 16 字节随机 hex（32 字符），与 password_hash 配套 |
| `email` | text | 可选 |
| `nickname` | text | 可选 |
| `admin` | boolean | 是否管理员 |
| `api_key` | text | 用户自有 API Key（可迁可不迁） |
| `created_at` | timestamptz | 注册时间 |
| 其他（`is_online`、`last_main_login_heartbeat`、`client_id` 等） | - | 心跳/在线状态，**无需迁移** |

### feedback（反馈）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | integer | 旧主键 |
| `user_id` | integer | 用户旧 id（迁移时映射到新 UUID） |
| `feedback_content` | text | 反馈内容 |
| `feedback_status` | integer | 处理状态 |
| `remark` | text | 备注，可空 |
| `create_time` | timestamptz | 提交时间 |

### study_rooms（自习室）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | uuid | 房间 id |
| `name` | varchar(100) | 房间名 |
| `description` | text | 描述 |
| `creator_id` | integer | 创建者旧 id（映射到新 UUID） |
| `is_public` | boolean | 是否公开 |
| `is_active` | boolean | 是否有效 |
| `max_members` | integer | 容量 |
| `created_at` | timestamptz | 创建时间 |

> study_room_members / daily_focus_records / focus_sessions 为历史会话/排名数据，
> 旧排名不保留，**可不迁移**；新服务器从零累计排名。

## 4. 导入到自建服务器 PostgreSQL

### 4.1 密码哈希（关键）

Supabase 存的密码是 **PBKDF2-SHA512、100000 次迭代、输出 64 字节 hex**，
`password_hash` 与 `salt` 分开存。服务器 `users.password_hash` 字段需组装为：

```
pbkdf2$100000$<salt>$<password_hash>
```

即：`"pbkdf2$100000$" + salt + "$" + password_hash`（两段都是 hex，中间用 `$` 拼接）。

服务器登录校验时按 `pbkdf2$100000$<salt>$<hash_hex>` 解析并重算比对（已实现，见 `server-planning/API-implementation.md`）。老用户无需改密码。

### 4.2 users 导入

```sql
-- 伪代码：逐条插入，id 生成新 UUID，username 保持原样
INSERT INTO users (id, username, email, password_hash, nickname, admin, created_at)
VALUES (
  gen_random_uuid(),                          -- 新 UUID
  '<username>',
  '<email>',                                  -- 可空
  'pbkdf2$100000$<salt>$<password_hash>',     -- 按 4.1 组装
  '<nickname>',                               -- 可空
  <admin>,
  '<created_at>'
)
ON CONFLICT (username) DO NOTHING;
```

同时建立 **旧 id → 新 UUID 映射表**（供 feedback / study_rooms 关联转换）。

### 4.3 feedback 导入

```sql
INSERT INTO feedbacks (user_id, feedback_content, feedback_status, remark, create_time)
SELECT f.id,
       m.new_id,                 -- 旧 user_id → 新 UUID
       f.feedback_content,
       f.feedback_status,
       f.remark,
       f.create_time
FROM <拉取的 feedbacks 数据> f
JOIN id_map m ON m.old_id = f.user_id;
```

### 4.4 study_rooms 导入（仅迁移 is_active 房间）

```sql
INSERT INTO study_rooms (id, name, description, owner_id, max_members, is_public, created_at)
SELECT r.id, r.name, r.description, m.new_id, r.max_members, r.is_public, r.created_at
FROM <拉取的 study_rooms 数据> r
JOIN id_map m ON m.old_id = r.creator_id;
```

> 若房间 id 与服务器现有 UUID 无冲突，直接沿用旧 uuid；否则可重新 `gen_random_uuid()`。

## 5. 验证（迁移时已通过）

```bash
# 用老账号登录新服务器（密码不变）
curl -X POST https://api.pomogrow.top/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "<老用户名>", "password": "<老密码>"}'

# 应返回 200 + access_token / refresh_token
```

## 6. 迁移结果（2026-08-01 已执行）

- ✅ 32 个老用户导入（username 无冲突，admin 标记保留）
- ✅ 老账号实测登录通过（无需改密码）
- ✅ 10 条反馈导入，user_id 正确映射到新 UUID
- ✅ 5 个有效自习室导入（7 个无效测试房跳过）
- ✅ 服务器容器内迁移数据已清理
