-- 0004_tests_course.down.sql
DROP INDEX IF EXISTS idx_tests_course_id;
ALTER TABLE tests DROP COLUMN IF EXISTS course_id;
