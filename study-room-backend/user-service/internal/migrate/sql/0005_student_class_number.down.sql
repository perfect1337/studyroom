-- 0005_student_class_number.down.sql
ALTER TABLE student_profiles DROP CONSTRAINT IF EXISTS class_info_is_grade_number;
ALTER TABLE student_profiles DROP COLUMN IF EXISTS last_promoted_year;
