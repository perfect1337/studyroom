-- 0004_contact_fields.down.sql
-- Откат миграции: убираем поля контактов

ALTER TABLE users_ref DROP COLUMN IF EXISTS telegram_id;
ALTER TABLE users_ref DROP COLUMN IF EXISTS phone;
ALTER TABLE users_ref DROP COLUMN IF EXISTS whatsapp_id;
