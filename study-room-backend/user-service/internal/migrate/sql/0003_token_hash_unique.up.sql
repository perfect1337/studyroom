-- 0003_token_hash_unique.up.sql
-- Уникальность хешей токенов: lookup однозначный, защита от дублей.

CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash ON password_reset_tokens(token_hash);
