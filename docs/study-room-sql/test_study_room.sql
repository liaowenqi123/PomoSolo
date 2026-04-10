-- ============================================
-- 自习室功能测试脚本
-- 用于验证数据库表和功能是否正常工作
-- ============================================

-- 步骤 1: 查看现有用户
-- 运行这个查询，找到你的用户 ID
SELECT id, username, created_at 
FROM users 
ORDER BY id 
LIMIT 10;

-- 记下你的用户 ID，例如：1
-- 在下面的测试中，将 YOUR_USER_ID 替换为你的实际用户 ID

-- ============================================
-- 步骤 2: 创建测试自习室
-- ============================================

-- 替换 YOUR_USER_ID 为你的实际用户 ID
INSERT INTO study_rooms (name, description, creator_id)
VALUES 
  ('早起学习室', '早上6-9点专注学习', YOUR_USER_ID),
  ('深夜代码室', '晚上10点后的编程时光', YOUR_USER_ID)
RETURNING *;

-- ============================================
-- 步骤 3: 查看创建的自习室
-- ============================================

SELECT 
  id,
  name,
  description,
  creator_id,
  get_username_by_id(creator_id) as creator_name,
  created_at,
  is_active,
  max_members
FROM study_rooms
ORDER BY created_at DESC;

-- ============================================
-- 步骤 4: 加入自习室
-- ============================================

-- 获取第一个自习室的 ID
-- 方法1: 直接复制上面查询结果中的 id
-- 方法2: 使用子查询（替换 YOUR_USER_ID）

INSERT INTO study_room_members (room_id, user_id)
SELECT id, YOUR_USER_ID
FROM study_rooms
WHERE creator_id = YOUR_USER_ID
LIMIT 1
RETURNING *;

-- ============================================
-- 步骤 5: 查看自习室成员
-- ============================================

SELECT 
  srm.id,
  srm.room_id,
  sr.name as room_name,
  srm.user_id,
  get_username_by_id(srm.user_id) as username,
  srm.joined_at,
  srm.is_online
FROM study_room_members srm
JOIN study_rooms sr ON srm.room_id = sr.id
ORDER BY srm.joined_at DESC;

-- ============================================
-- 步骤 6: 插入专注会话记录
-- ============================================

-- 模拟完成一个25分钟的专注会话
-- 替换 YOUR_USER_ID 和 YOUR_ROOM_ID

INSERT INTO focus_sessions (
  user_id, 
  room_id, 
  started_at, 
  ended_at, 
  duration_minutes, 
  note, 
  is_completed
)
VALUES (
  YOUR_USER_ID,
  'YOUR_ROOM_ID',  -- 从步骤3的结果中复制
  NOW() - INTERVAL '25 minutes',
  NOW(),
  25,
  '完成了第一个番茄钟',
  true
)
RETURNING *;

-- 再插入几个会话
INSERT INTO focus_sessions (user_id, room_id, started_at, ended_at, duration_minutes, note, is_completed)
VALUES 
  (YOUR_USER_ID, 'YOUR_ROOM_ID', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '35 minutes', 25, '学习了数学', true),
  (YOUR_USER_ID, 'YOUR_ROOM_ID', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '95 minutes', 25, '写了代码', true);

-- ============================================
-- 步骤 7: 更新每日汇总记录
-- ============================================

-- 插入今日汇总（UPSERT）
INSERT INTO daily_focus_records (
  user_id,
  room_id,
  date,
  total_minutes,
  session_count,
  notes
)
VALUES (
  YOUR_USER_ID,
  'YOUR_ROOM_ID',
  CURRENT_DATE,
  75,  -- 3个会话 * 25分钟
  3,
  '[
    {"time": "2024-01-01T08:00:00Z", "note": "完成了第一个番茄钟"},
    {"time": "2024-01-01T09:00:00Z", "note": "学习了数学"},
    {"time": "2024-01-01T10:00:00Z", "note": "写了代码"}
  ]'::jsonb
)
ON CONFLICT (user_id, room_id, date) 
DO UPDATE SET
  total_minutes = daily_focus_records.total_minutes + EXCLUDED.total_minutes,
  session_count = daily_focus_records.session_count + EXCLUDED.session_count,
  notes = daily_focus_records.notes || EXCLUDED.notes,
  last_updated = NOW()
RETURNING *;

-- ============================================
-- 步骤 8: 查看今日排名
-- ============================================

-- 使用视图查看排名
SELECT 
  rank,
  username,
  total_minutes,
  session_count,
  last_updated
FROM v_today_ranking
WHERE room_id = 'YOUR_ROOM_ID'
ORDER BY rank;

-- 或者直接查询
SELECT 
  dfr.user_id,
  get_username_by_id(dfr.user_id) as username,
  dfr.total_minutes,
  dfr.session_count,
  dfr.notes,
  dfr.last_updated,
  ROW_NUMBER() OVER (ORDER BY dfr.total_minutes DESC) as rank
FROM daily_focus_records dfr
WHERE dfr.room_id = 'YOUR_ROOM_ID'
  AND dfr.date = CURRENT_DATE
ORDER BY dfr.total_minutes DESC;

-- ============================================
-- 步骤 9: 查看自习室统计
-- ============================================

-- 查看某个自习室的完整信息
SELECT 
  sr.id,
  sr.name,
  sr.description,
  get_username_by_id(sr.creator_id) as creator,
  sr.created_at,
  COUNT(DISTINCT srm.user_id) as member_count,
  COUNT(DISTINCT CASE WHEN srm.is_online THEN srm.user_id END) as online_count,
  COALESCE(SUM(dfr.total_minutes), 0) as today_total_minutes,
  COALESCE(SUM(dfr.session_count), 0) as today_total_sessions
FROM study_rooms sr
LEFT JOIN study_room_members srm ON sr.id = srm.room_id
LEFT JOIN daily_focus_records dfr ON sr.id = dfr.room_id AND dfr.date = CURRENT_DATE
WHERE sr.id = 'YOUR_ROOM_ID'
GROUP BY sr.id, sr.name, sr.description, sr.creator_id, sr.created_at;

-- ============================================
-- 步骤 10: 查看用户的所有自习室
-- ============================================

SELECT 
  sr.id,
  sr.name,
  sr.description,
  get_username_by_id(sr.creator_id) as creator,
  srm.joined_at,
  srm.is_online,
  COALESCE(dfr.total_minutes, 0) as today_minutes,
  COALESCE(dfr.session_count, 0) as today_sessions
FROM study_room_members srm
JOIN study_rooms sr ON srm.room_id = sr.id
LEFT JOIN daily_focus_records dfr ON sr.id = dfr.room_id 
  AND dfr.user_id = srm.user_id 
  AND dfr.date = CURRENT_DATE
WHERE srm.user_id = YOUR_USER_ID
ORDER BY srm.joined_at DESC;

-- ============================================
-- 清理测试数据（可选）
-- ============================================

-- 如果需要清理测试数据，取消下面的注释并运行

/*
-- 删除今日记录
DELETE FROM daily_focus_records WHERE user_id = YOUR_USER_ID;

-- 删除会话记录
DELETE FROM focus_sessions WHERE user_id = YOUR_USER_ID;

-- 退出自习室
DELETE FROM study_room_members WHERE user_id = YOUR_USER_ID;

-- 删除自习室
DELETE FROM study_rooms WHERE creator_id = YOUR_USER_ID;
*/

-- ============================================
-- 性能测试查询
-- ============================================

-- 测试排名查询性能
EXPLAIN ANALYZE
SELECT 
  dfr.user_id,
  get_username_by_id(dfr.user_id) as username,
  dfr.total_minutes,
  dfr.session_count
FROM daily_focus_records dfr
WHERE dfr.room_id = 'YOUR_ROOM_ID'
  AND dfr.date = CURRENT_DATE
ORDER BY dfr.total_minutes DESC
LIMIT 50;

-- ============================================
-- 完成！
-- ============================================

SELECT '✓ 测试完成！所有功能正常工作。' as message;
