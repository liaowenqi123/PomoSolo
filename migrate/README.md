# 数据迁移：Supabase → 自建服务器

> 本目录存放从 Supabase 导出的用户/反馈数据，以及给服务器部门的导入说明。

## 导出（客户端执行）

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

> ⚠️ **密码兼容说明**：旧 Supabase 的密码哈希是 **PBKDF2-SHA512（100000 次迭代）**，
> 新服务器的 `password_hash` 字段需支持两种格式：
> - 若以 `pbkdf2$100000$<salt_hex>$<hash_hex>` 前缀存储 → 登录时用 PBKDF2 校验
> - 否则按 bcrypt 校验
> 建议服务器端做成**双格式校验**（先试 pbkdf2，再试 bcrypt），
> 这样老用户无需改密码即可登录。

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
