-- 0008_max_bind.up.sql
-- Связь MAX user_id с user_id в системе для привязки уведомлений.
-- Полный аналог 0005_telegram_bind.up.sql, но для мессенджера MAX:
-- ключом является max_user_id — ID пользователя в MAX, который приходит
-- в событиях bot_started / message_created webhook'а MAX Bot API.

CREATE TABLE IF NOT EXISTS max_users (
    id BIGSERIAL PRIMARY KEY,
    max_user_id BIGINT NOT NULL UNIQUE,
    max_username VARCHAR(100) DEFAULT NULL,
    user_id BIGINT NOT NULL REFERENCES users_ref(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_max_users_user_id ON max_users(user_id);

-- Кэш max_user_id для Notifier (аналог telegram_id в users_ref).
ALTER TABLE users_ref ADD COLUMN IF NOT EXISTS max_id VARCHAR(50) DEFAULT NULL;
