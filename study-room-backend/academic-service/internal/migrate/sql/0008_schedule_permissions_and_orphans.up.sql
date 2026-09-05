-- 0008_schedule_permissions_and_orphans.up.sql
-- Schedule is managed by owner/branch_owner only. Lessons survive tutor removal.
ALTER TABLE lessons ALTER COLUMN tutor_id DROP NOT NULL;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS branch_id INTEGER;

-- Preserve the branch for existing lessons before a tutor may disappear.
UPDATE lessons l
SET branch_id = ur.branch_id
FROM user_refs ur
WHERE l.branch_id IS NULL AND l.tutor_id = ur.user_id AND ur.branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lessons_branch_id ON lessons(branch_id);
