-- 为 study_rooms 表添加 is_public 字段
-- 请在 Supabase SQL Editor 中运行此脚本

-- 1. 添加 is_public 字段（默认为 true，即公开）
ALTER TABLE study_rooms 
ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT true;

-- 2. 为 is_public 字段添加索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_study_rooms_public 
ON study_rooms(is_public);

-- 3. 将现有的所有自习室设置为公开
UPDATE study_rooms 
SET is_public = true 
WHERE is_public IS NULL;

-- 4. 验证结果
SELECT id, name, is_public, created_at 
FROM study_rooms 
ORDER BY created_at DESC;
