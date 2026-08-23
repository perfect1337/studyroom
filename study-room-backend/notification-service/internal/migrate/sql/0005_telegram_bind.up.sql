-- 0005_telegram_bind.up.sql
-- Связь Telegram chat_id с user_id для привязки уведомлений

CREATE TABLE IF NOT EXISTS telegram_users (
    id BIGSERIAL PRIMARY KEY,
    telegram_chat_id BIGINT NOT NULL UNIQUE,
    telegram_username VARCHAR(100) DEFAULT NULL,
    user_id BIGINT NOT NULL REFERENCES users_ref(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telegram_users_user_id ON telegram_users(user_id);
