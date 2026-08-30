-- 0006_notification_channel_messengers.down.sql
-- PostgreSQL не поддерживает ALTER TYPE ... DROP VALUE, поэтому откат
-- пересоздаёт enum без 'telegram'/'whatsapp'/'max'.
--
-- ВНИМАНИЕ: если к моменту отката в таблице notifications уже есть строки
-- со значением 'telegram', 'whatsapp' или 'max', этот блок упадёт на
-- приведении типов (что и должно происходить — тихая потеря данных хуже).
-- В таком случае перед откатом нужно вручную решить, что делать с этими
-- строками (удалить/перевести в 'messenger' и т.п.).

ALTER TABLE notifications ALTER COLUMN channel DROP DEFAULT;

CREATE TYPE notification_channel_old AS ENUM ('email', 'sms', 'messenger');

ALTER TABLE notifications
    ALTER COLUMN channel TYPE notification_channel_old
    USING channel::text::notification_channel_old;

DROP TYPE notification_channel;
ALTER TYPE notification_channel_old RENAME TO notification_channel;

ALTER TABLE notifications ALTER COLUMN channel SET DEFAULT 'email';
