ALTER TABLE user_refs ADD COLUMN IF NOT EXISTS branch_ids BIGINT[] NOT NULL DEFAULT ARRAY[]::BIGINT[];
UPDATE user_refs SET branch_ids = CASE WHEN branch_id IS NULL THEN ARRAY[]::BIGINT[] ELSE ARRAY[branch_id::bigint] END WHERE branch_ids = ARRAY[]::BIGINT[];
