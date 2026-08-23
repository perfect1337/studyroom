-- 0004_contact_fields.up.sql
-- Добавление полей контактов для мессенджеров в users_ref
-- Все мессенджеры резолвятся по phone number из users_ref

ALTER TABLE users_ref ADD COLUMN telegram_id VARCHAR(50) DEFAULT NULL;
ALTER TABLE users_ref ADD COLUMN phone VARCHAR(20) DEFAULT NULL;
ALTER TABLE users_ref ADD COLUMN whatsapp_id VARCHAR(50) DEFAULT NULL;
