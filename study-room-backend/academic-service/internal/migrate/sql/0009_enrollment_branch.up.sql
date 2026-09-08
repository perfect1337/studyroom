-- 0009_enrollment_branch.up.sql
-- enrollments.branch_id — филиал ОКАЗАНИЯ УСЛУГИ по конкретной записи
-- зачисления (унаследован от Contract.BranchID в момент создания через
-- contract.created, см. academic-service/internal/events/subscriber.go),
-- а не домашний филиал ученика (тот остаётся в User Service, user_refs
-- как локальный кэш).
--
-- До этой миграции филиал зачисления вычислялся JOIN'ом на user_refs по
-- student_id, то есть фактически был домашним филиалом ученика. Это
-- ломало сценарий "ученик из филиала А занимается предметом, которого у
-- него нет дома, в филиале Б": владелец Б не мог управлять зачислением
-- (например, назначить своего репетитора), потому что формально запись
-- принадлежала филиалу А, хотя договор на неё выдал именно Б.
--
-- Без FK на branch — у нас database-per-service, branches живёт в
-- User Service.
ALTER TABLE enrollments ADD COLUMN branch_id BIGINT;

-- Бэкфилл существующих записей: лучшее доступное приближение — домашний
-- филиал ученика на момент миграции (для новых enrollments, создаваемых
-- после миграции, branch_id будет браться из Contract.BranchID, что
-- точнее, см. CreateFromContract).
UPDATE enrollments e
SET branch_id = ur.branch_id
FROM user_refs ur
WHERE e.branch_id IS NULL AND ur.user_id = e.student_id AND ur.branch_id IS NOT NULL;

-- Для записей, у которых даже домашний филиал ученика не определился
-- (student ещё не синхронизирован в user_refs) — используем 0 как явный
-- "неизвестный филиал", чтобы не блокировать NOT NULL ниже. Такие записи
-- не должны попадать ни под один branch_owner-фильтр, что и происходит
-- при branch_id=0 (реальные филиалы нумеруются с 1).
UPDATE enrollments SET branch_id = 0 WHERE branch_id IS NULL;

ALTER TABLE enrollments ALTER COLUMN branch_id SET NOT NULL;

CREATE INDEX idx_enrollments_branch_id ON enrollments(branch_id);
