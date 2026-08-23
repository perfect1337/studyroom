-- 0001_init.up.sql
-- Notification Service schema. Матчится с service-5-notifications.mermaid из ERD.
-- Своя БД: study_room_notifications. Не хранит ничего чужого, кроме
-- облегчённой копии пользователей (users_ref) — нужна, чтобы знать, на какой
-- email слать письма, не дёргая User Service синхронно на каждую отправку.

CREATE TYPE notification_channel AS ENUM ('email', 'sms', 'messenger');
CREATE TYPE notification_status AS ENUM ('pending', 'sent', 'failed');

-- Облегчённая копия пользователей, наполняется событиями user.created/user.updated
-- из брокера (NATS) — см. internal/events. Пока подписчик не запущен постоянно,
-- запись также может быть создана вручную через POST /internal/users/sync.
CREATE TABLE users_ref (
    id          INTEGER PRIMARY KEY,
    email       VARCHAR(255) NOT NULL,
    first_name  VARCHAR(255),
    last_name   VARCHAR(255),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_settings (
    user_id            INTEGER PRIMARY KEY,
    email_enabled      BOOLEAN NOT NULL DEFAULT true,
    sms_enabled        BOOLEAN NOT NULL DEFAULT false,
    messenger_enabled  BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE notifications (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    type        VARCHAR(100) NOT NULL,
    channel     notification_channel NOT NULL DEFAULT 'email',
    message     TEXT NOT NULL,
    status      notification_status NOT NULL DEFAULT 'pending',
    is_read     BOOLEAN NOT NULL DEFAULT false,
    error       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_status ON notifications(status);
