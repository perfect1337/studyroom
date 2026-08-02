-- 0004_branch_soft_delete.down.sql

DROP INDEX IF EXISTS idx_branches_deleted_at;
ALTER TABLE branches DROP COLUMN IF EXISTS deleted_at;
