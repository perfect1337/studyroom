-- 0006_refresh_token_grace.down.sql
ALTER TABLE refresh_tokens
    DROP COLUMN IF EXISTS revoked_at;
