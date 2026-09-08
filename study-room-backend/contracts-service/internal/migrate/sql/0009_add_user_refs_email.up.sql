-- 0009_add_user_refs_email.up.sql
-- Добавляем email в user_refs для возможности указывать контакт
-- владельца филиала в уведомлениях (payment reminder).

ALTER TABLE user_refs ADD COLUMN email VARCHAR(255) NOT NULL DEFAULT '';
