-- ============================================
-- 自习室功能数据库表创建脚本 V2
-- 兼容 users 表有 uuid 和 integer 两种 id 的情况
-- ============================================

-- 首先检查 users 表的主键类型
DO $$
DECLARE
  id_type text;
BEGIN
  SELECT data_type INTO id_type
  FROM information_schema.columns
  WHERE table_name = 'users' 
    AND column_name = 'id'
  LIMIT 1;
  
  RAISE NOTICE '检测到 users.id 类型: %', id_type;
END $$;

-- ============================================
-- 方案：使用 INTEGER 类型（根据你的 cloudAuth.js）
-- 如果你的应用使用的是 integer 类型的 id，使用这个版本
-- ============================================

-- 1. 创建自习室表
CREATE TABLE IF NOT EXISTS study_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  creator_id INTEGER NOT NULL,  -- 使用 INTEGER，不设置外键约束（更灵活）
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  max_members INTEGER DEFAULT 50,
  description TEXT
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_study_rooms_creator ON study_rooms(creator_id);
CREATE INDEX IF NOT EXISTS idx_study_rooms_active ON study_rooms(is_active);

COMMENT ON TABLE study_rooms IS '自习室表';
COMMENT ON COLUMN study_rooms.creator_id IS '创建者用户ID (integer)';

-- ============================================

-- 2. 创建自习室成员表
CREATE TABLE IF NOT EXISTS study_room_members (
  id SERIAL PRIMARY KEY,
  room_id UUID NOT NULL,
  user_id INTEGER NOT NULL,  -- 使用 INTEGER
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_active TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_online BOOLEAN DEFAULT true,
  CONSTRAINT fk_room FOREIGN KEY (room_id) REFERENCES study_rooms(id) ON DELETE CASCADE,
  UNIQUE(room_id, user_id)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_members_room ON study_room_members(room_id);
CREATE INDEX IF NOT EXISTS idx_members_user ON study_room_members(user_id);
CREATE INDEX IF NOT EXISTS idx_members_online ON study_room_members(is_online);
CREATE INDEX IF NOT EXISTS idx_members_room_user ON study_room_members(room_id, user_id);

COMMENT ON TABLE study_room_members IS '自习室成员表';

-- ============================================

-- 3. 创建每日专注记录表
CREATE TABLE IF NOT EXISTS daily_focus_records (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,  -- 使用 INTEGER
  room_id UUID NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_minutes INTEGER DEFAULT 0,
  session_count INTEGER DEFAULT 0,
  notes JSONB DEFAULT '[]'::jsonb,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT fk_room_daily FOREIGN KEY (room_id) REFERENCES study_rooms(id) ON DELETE CASCADE,
  UNIQUE(user_id, room_id, date)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_focus_user_date ON daily_focus_records(user_id, date);
CREATE INDEX IF NOT EXISTS idx_focus_room_date ON daily_focus_records(room_id, date);
CREATE INDEX IF NOT EXISTS idx_focus_minutes ON daily_focus_records(total_minutes DESC);
CREATE INDEX IF NOT EXISTS idx_focus_room_date_minutes ON daily_focus_records(room_id, date, total_minutes DESC);

COMMENT ON TABLE daily_focus_records IS '每日专注记录表（用于排名）';
COMMENT ON COLUMN daily_focus_records.notes IS '备注列表 JSON 格式: [{"time": "2024-01-01T10:00:00Z", "note": "完成了任务"}]';

-- ============================================

-- 4. 创建专注会话表
CREATE TABLE IF NOT EXISTS focus_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,  -- 使用 INTEGER
  room_id UUID NOT NULL,
  started_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ended_at TIMESTAMP WITH TIME ZONE,
  duration_minutes INTEGER,
  note TEXT,
  is_completed BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT fk_room_session FOREIGN KEY (room_id) REFERENCES study_rooms(id) ON DELETE CASCADE
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_sessions_user ON focus_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_room ON focus_sessions(room_id);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON focus_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_room_date ON focus_sessions(room_id, started_at);

COMMENT ON TABLE focus_sessions IS '专注会话表（详细记录）';

-- ============================================
-- 启用 Row Level Security (RLS)
-- ============================================

ALTER TABLE study_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_focus_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE focus_sessions ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 创建 RLS 策略（简化版本，允许所有操作）
-- ============================================

-- study_rooms 表策略
DROP POLICY IF EXISTS "Allow all on study_rooms" ON study_rooms;
CREATE POLICY "Allow all on study_rooms"
  ON study_rooms
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- study_room_members 表策略
DROP POLICY IF EXISTS "Allow all on study_room_members" ON study_room_members;
CREATE POLICY "Allow all on study_room_members"
  ON study_room_members
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- daily_focus_records 表策略
DROP POLICY IF EXISTS "Allow all on daily_focus_records" ON daily_focus_records;
CREATE POLICY "Allow all on daily_focus_records"
  ON daily_focus_records
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- focus_sessions 表策略
DROP POLICY IF EXISTS "Allow all on focus_sessions" ON focus_sessions;
CREATE POLICY "Allow all on focus_sessions"
  ON focus_sessions
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================
-- 创建辅助函数：获取用户名
-- ============================================

CREATE OR REPLACE FUNCTION get_username_by_id(p_user_id INTEGER)
RETURNS TEXT AS $$
DECLARE
  v_username TEXT;
BEGIN
  SELECT username INTO v_username
  FROM users
  WHERE id = p_user_id;
  
  RETURN COALESCE(v_username, '未知用户');
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION get_username_by_id IS '根据用户ID获取用户名';

-- ============================================
-- 创建视图：今日排名视图（方便查询）
-- ============================================

CREATE OR REPLACE VIEW v_today_ranking AS
SELECT 
  dfr.id,
  dfr.user_id,
  get_username_by_id(dfr.user_id) as username,
  dfr.room_id,
  dfr.total_minutes,
  dfr.session_count,
  dfr.notes,
  dfr.last_updated,
  ROW_NUMBER() OVER (PARTITION BY dfr.room_id ORDER BY dfr.total_minutes DESC) as rank
FROM daily_focus_records dfr
WHERE dfr.date = CURRENT_DATE
ORDER BY dfr.room_id, dfr.total_minutes DESC;

COMMENT ON VIEW v_today_ranking IS '今日排名视图';

-- ============================================
-- 插入测试数据（可选）
-- ============================================

-- 取消下面的注释来插入测试数据
/*
-- 假设你有一个 user_id = 1 的用户
INSERT INTO study_rooms (name, description, creator_id)
VALUES 
  ('早起学习室', '早上6-9点专注学习', 1),
  ('深夜代码室', '晚上10点后的编程时光', 1)
ON CONFLICT DO NOTHING;

-- 获取刚创建的自习室ID
DO $$
DECLARE
  room1_id UUID;
  room2_id UUID;
BEGIN
  SELECT id INTO room1_id FROM study_rooms WHERE name = '早起学习室' LIMIT 1;
  SELECT id INTO room2_id FROM study_rooms WHERE name = '深夜代码室' LIMIT 1;
  
  -- 加入自习室
  INSERT INTO study_room_members (room_id, user_id)
  VALUES 
    (room1_id, 1),
    (room2_id, 1)
  ON CONFLICT DO NOTHING;
  
  -- 插入今日记录
  INSERT INTO daily_focus_records (user_id, room_id, total_minutes, session_count, notes)
  VALUES 
    (1, room1_id, 50, 2, '[{"time": "2024-01-01T08:00:00Z", "note": "完成了数学作业"}]'::jsonb),
    (1, room2_id, 75, 3, '[{"time": "2024-01-01T22:00:00Z", "note": "写了100行代码"}]'::jsonb)
  ON CONFLICT (user_id, room_id, date) DO NOTHING;
END $$;
*/

-- ============================================
-- 验证安装
-- ============================================

-- 检查表是否创建成功
SELECT 
  t.table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count,
  (SELECT COUNT(*) FROM information_schema.table_constraints 
   WHERE table_name = t.table_name AND constraint_type = 'PRIMARY KEY') as has_pk,
  (SELECT COUNT(*) FROM pg_policies WHERE tablename = t.table_name) as policy_count
FROM information_schema.tables t
WHERE t.table_schema = 'public' 
  AND t.table_name IN ('study_rooms', 'study_room_members', 'daily_focus_records', 'focus_sessions')
ORDER BY t.table_name;

-- 检查索引
SELECT 
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename LIKE '%study%' OR tablename LIKE '%focus%'
ORDER BY tablename, indexname;

-- 显示成功消息
DO $$
BEGIN
  RAISE NOTICE '========================================';
  RAISE NOTICE '✓ 自习室数据库表创建完成！';
  RAISE NOTICE '========================================';
  RAISE NOTICE '已创建的表：';
  RAISE NOTICE '  1. study_rooms (自习室表)';
  RAISE NOTICE '  2. study_room_members (成员表)';
  RAISE NOTICE '  3. daily_focus_records (每日记录表)';
  RAISE NOTICE '  4. focus_sessions (会话表)';
  RAISE NOTICE '';
  RAISE NOTICE '已创建的视图：';
  RAISE NOTICE '  - v_today_ranking (今日排名视图)';
  RAISE NOTICE '';
  RAISE NOTICE '已创建的函数：';
  RAISE NOTICE '  - get_username_by_id() (获取用户名)';
  RAISE NOTICE '';
  RAISE NOTICE '下一步：在应用中集成自习室功能';
  RAISE NOTICE '========================================';
END $$;

-- 测试查询示例
-- SELECT * FROM v_today_ranking WHERE room_id = 'YOUR_ROOM_ID';
-- SELECT * FROM study_rooms WHERE is_active = true;
