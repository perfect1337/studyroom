-- 0006_notification_channel_messengers.up.sql
-- Синхронизация enum notification_channel с models.Channel (internal/models).
-- В 0001_init.up.sql тип создавался как ('email', 'sms', 'messenger'), но
-- код (models.ChannelTelegram/ChannelWhatsApp/ChannelMax) и 0003_messenger_channels
-- уже давно оперируют значениями 'telegram', 'whatsapp', 'max' — из-за этого
-- INSERT INTO notifications (..., channel, ...) VALUES (..., 'telegram', ...)
-- падал с ERROR: invalid input value for enum notification_channel: "telegram"
-- (SQLSTATE 22P02). Эта миграция добавляет недостающие значения в тип.
--
-- ВАЖНО: ALTER TYPE ... ADD VALUE нельзя использовать в одной транзакции
-- с последующим использованием этого значения, поэтому миграция состоит
-- только из ADD VALUE и не содержит INSERT/UPDATE. Раннер (internal/migrate/migrate.go)
-- выполняет каждый *.up.sql в своей собственной транзакции, так что это безопасно.

ALTER TYPE notification_channel ADD VALUE IF NOT EXISTS 'telegram';
ALTER TYPE notification_channel ADD VALUE IF NOT EXISTS 'whatsapp';
ALTER TYPE notification_channel ADD VALUE IF NOT EXISTS 'max';
