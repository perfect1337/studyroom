DROP INDEX IF EXISTS idx_contracts_deleted_at;
ALTER TABLE contracts
    DROP COLUMN IF EXISTS deleted_by,
    DROP COLUMN IF EXISTS deleted_at;
