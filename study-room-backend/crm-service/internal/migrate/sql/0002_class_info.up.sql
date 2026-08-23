-- 0002_class_info.up.sql
-- Класс ученика (для отображения прямо в заявке на запись на курс, без
-- похода в User Service) — реплицируется в user_refs по событиям
-- user.created/user.updated (см. internal/events/subscriber.go) и
-- снимком копируется в саму заявку в момент её создания (applications.class_info),
-- чтобы дальнейшее изменение класса ученика (в т.ч. автоматическое
-- повышение 1 сентября, см. user-service/internal/promotion) не меняло
-- задним числом уже поданные заявки — заявка должна показывать класс НА
-- МОМЕНТ подачи, а не текущий.

ALTER TABLE user_refs ADD COLUMN class_info VARCHAR(16);

ALTER TABLE applications ADD COLUMN class_info VARCHAR(16);
