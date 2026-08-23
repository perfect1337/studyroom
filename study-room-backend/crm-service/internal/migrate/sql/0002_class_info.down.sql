-- 0002_class_info.down.sql
ALTER TABLE applications DROP COLUMN IF EXISTS class_info;
ALTER TABLE user_refs DROP COLUMN IF EXISTS class_info;
