-- 0004_branch_soft_delete.up.sql
-- Мягкое удаление филиалов: при удалении филиал больше физически не
-- стирается из таблицы branches, а лишь помечается deleted_at. Это нужно,
-- чтобы в разделе "Филиалы" (вкладка "Удалённые") owner мог открыть такой
-- филиал и посмотреть, какие преподаватели и ученики в нём были —
-- students/tutors по-прежнему хранят branch_id, но раньше он "терялся"
-- вместе с самой строкой филиала (FK ON DELETE SET NULL срабатывал только
-- для пользователей, потому что строка branches реально исчезала).
--
-- deleted_at IS NULL  -> филиал активен (обычный список /branches)
-- deleted_at NOT NULL -> филиал в "корзине" (/branches/deleted)

ALTER TABLE branches ADD COLUMN deleted_at TIMESTAMPTZ;

-- Частичный индекс — быстрый фильтр активных/удалённых филиалов.
CREATE INDEX idx_branches_deleted_at ON branches(deleted_at);
