-- 0007_branch_owner_is_tutor.down.sql
ALTER TABLE users
    DROP COLUMN IF EXISTS is_tutor;
