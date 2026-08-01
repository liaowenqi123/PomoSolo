# 数据迁移：Supabase → 自建服务器

> **状态**: ✅ 已完成（2026-08-01）
>
> 迁移由服务器部门执行完毕：32 个用户、10 条反馈、5 个有效自习室已导入自建服务器，
> 老账号实测登录通过（无需改密码）。详细结果见 `SERVER-IMPORT.md` 第 6 节。
>
> ⚠️ **凭据清理**：因项目将公开到 GitHub，Supabase 项目 URL 与 API Key 已从仓库移除，
> 请尽快关停 Supabase 项目（RLS 全放行，数据已全部迁移）。

> 本目录存放从 Supabase 导出/拉取的用户、反馈、自习室数据说明，以及给服务器部门的导入说明。

## 迁移方式（二选一）

| 方式 | 执行方 | 说明 |
|------|--------|------|
| **A. 服务器直接拉取（推荐）** | 服务器部门 | 用 Supabase 凭据从 REST API 拉取后导入，见 **`SERVER-IMPORT.md`** |
| B. 客户端导出 JSON | 客户端（需 Supabase URL + anon key） | 运行 `scripts/migrate-supabase.mjs` 生成 JSON，服务器按下方说明导入 |

> 方式 A 更直接：凭据、表字段、curl 命令、SQL 导入模板、密码哈希组装都已写在 `SERVER-IMPORT.md`，
> 服务器部门只需照做即可。

---

## 导出（客户端执行，方式 B）

```bash
# 在项目根目录
SUPABASE_URL=https://xxx.supabase.co \
SUPABASE_ANON_KEY=your-anon-key \
node scripts/migrate-supabase.mjs
```

可选参数：
- `--reset-passwords`：导出时清空密码哈希（用户需重新设置密码）

生成文件：
| 文件 | 内容 |
|------|------|
| `users.json` | 用户列表（old_id, new_id=UUID, username, password_hash, salt, admin） |
| `feedbacks.json` | 反馈列表（user_id 已映射到新 UUID） |
| `study_rooms.json` | 自习室（供参考） |
| `idMap.json` | 旧 id → 新 UUID 映射 |

## 导入（服务器部门执行）

1. 将 `migrate/` 目录放到服务器 `/opt/pomosolo-server/migrate/`
2. 参考 `server-planning/README.md` 的 `users` 表结构建表（**username UNIQUE NOT NULL**）
3. 导入 users：

```sql
-- users.json 逐条插入（伪代码）
INSERT INTO users (id, username, email, password_hash, nickname, created_at)
VALUES ('<new_id>', '<username>', '<email>', '<password_hash>', '<nickname>', '<created_at>');
```

> ⚠️ **密码兼容说明**（已与服务器实现对齐，见 `server-planning/API-implementation.md`）：
> 旧 Supabase 的密码哈希为 **PBKDF2-SHA512（100000 次迭代）**，导出时拆分为
> `password_hash` + `salt` 两个字段。服务器导入时需组装为支持的格式之一：
> - 本服务格式：`pbkdf2_sha512$100000$<salt>$<hash_hex>`
> - Supabase 迁移格式：`pbkdf2$100000$<salt_hex>$<hash_hex>`（校验时自动兼容）
> 服务器登录校验已支持上述双格式，老用户无需改密码即可登录。

4. 导入反馈：

```sql
INSERT INTO feedbacks (id, user_id, feedback_content, feedback_status, remark, create_time)
VALUES ('<old_id>', '<new_user_id>', '<content>', '<status>', '<remark>', '<create_time>');
```

5. 若密码格式无法兼容，可让用户走"忘记密码"流程重置。

## 迁移完成后的验证

```bash
# 用老账号登录新服务器
curl -X POST http://<服务器>/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "<老用户名>", "password": "<老密码>"}'
```
