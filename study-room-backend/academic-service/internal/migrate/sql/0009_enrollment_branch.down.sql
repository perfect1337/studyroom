-- 0009_enrollment_branch.down.sql
DROP INDEX IF EXISTS idx_enrollments_branch_id;
ALTER TABLE enrollments DROP COLUMN IF EXISTS branch_id;
