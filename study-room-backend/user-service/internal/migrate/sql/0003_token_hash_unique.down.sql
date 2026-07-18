-- 0003_token_hash_unique.down.sql

DROP INDEX IF EXISTS idx_password_reset_tokens_token_hash;
DROP INDEX IF EXISTS idx_refresh_tokens_token_hash;
