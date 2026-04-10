-- 清理测试自习室，只保留一个
-- 请在 Supabase SQL Editor 中运行此脚本

-- 1. 查看所有自习室
SELECT id, name, description, creator_id, created_at 
FROM study_rooms 
ORDER BY created_at DESC;

-- 2. 删除多余的测试自习室（保留最新的一个）
-- 请先运行上面的查询，确认要保留哪个自习室的 ID
-- 然后将下面的 'ROOM_ID_TO_KEEP' 替换为你要保留的自习室 ID

-- 删除其他自习室的成员记录
DELETE FROM study_room_members 
WHERE room_id IN (
  SELECT id FROM study_rooms 
  WHERE id != 'ROOM_ID_TO_KEEP'  -- 替换为要保留的自习室 ID
);

-- 删除其他自习室的每日记录
DELETE FROM daily_focus_records 
WHERE room_id IN (
  SELECT id FROM study_rooms 
  WHERE id != 'ROOM_ID_TO_KEEP'  -- 替换为要保留的自习室 ID
);

-- 删除其他自习室的会话记录
DELETE FROM focus_sessions 
WHERE room_id IN (
  SELECT id FROM study_rooms 
  WHERE id != 'ROOM_ID_TO_KEEP'  -- 替换为要保留的自习室 ID
);

-- 删除其他自习室
DELETE FROM study_rooms 
WHERE id != 'ROOM_ID_TO_KEEP';  -- 替换为要保留的自习室 ID

-- 3. 验证结果
SELECT id, name, description, creator_id, created_at 
FROM study_rooms;
