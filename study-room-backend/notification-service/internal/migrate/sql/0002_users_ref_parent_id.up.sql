-- 0002_users_ref_parent_id.up.sql
-- Добавляет parent_id в users_ref, чтобы Notification Service мог сам
-- резолвить student_id -> parent_id при attendance.marked_absent, не дёргая
-- User Service синхронно. Наполняется полем parent_id из user.created/
-- user.updated (см. event-schema.md, "Правила на будущее" и раздел
-- attendance.marked_absent).
ALTER TABLE users_ref ADD COLUMN parent_id INTEGER;
