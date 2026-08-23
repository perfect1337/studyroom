-- 0005_courses_drop_branch.up.sql
-- Курсы больше не привязаны к филиалу: каталог курсов общий для всей сети,
-- а не "один курс = один филиал". branch_id раньше был NOT NULL и заставлял
-- заводить отдельную запись курса на каждый филиал.
DROP INDEX IF EXISTS idx_courses_branch_id;
ALTER TABLE courses DROP COLUMN IF EXISTS branch_id;
