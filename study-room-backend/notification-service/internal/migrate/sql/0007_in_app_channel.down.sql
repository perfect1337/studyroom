-- 0007_in_app_channel.down.sql
-- PostgreSQL не поддерживает ALTER TYPE ... DROP VALUE, поэтому откат
-- пересоздаёт enum без 'in_app' (тот же приём, что в 0006).
--
-- ВНИМАНИЕ: если к моменту отката в таблице notifications уже есть строки
-- со значением 'in_app', этот блок упадёт на приведении типов (что и
-- должно происходить — тихая потеря данных хуже). Перед откатом нужно
-- вручную решить, что делать с такими строками (удалить и т.п.).

ALTER TABLE notifications ALTER COLUMN channel DROP DEFAULT;

CREATE TYPE notification_channel_old AS ENUM ('email', 'sms', 'messenger', 'telegram', 'whatsapp', 'max');

ALTER TABLE notifications
    ALTER COLUMN channel TYPE notification_channel_old
    USING channel::text::notification_channel_old;

DROP TYPE notification_channel;
ALTER TYPE notification_channel_old RENAME TO notification_channel;

ALTER TABLE notifications ALTER COLUMN channel SET DEFAULT 'email';
