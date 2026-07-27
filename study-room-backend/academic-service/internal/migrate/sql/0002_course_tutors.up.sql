-- 0002_course_tutors.up.sql
-- Явная связь "какой преподаватель ведёт какой курс" (many-to-many:
-- курс может вести несколько преподавателей — например, разные группы
-- одного курса; преподаватель может вести несколько курсов).
--
-- До этой миграции такой связи в БД не было вообще: enrollments.tutor_id
-- назначался вручную ПОШТУЧНО на каждого ученика, а "мои ученики" у
-- tutor в User Service считались просто "все ученики моего филиала"
-- (см. api-contracts.md, старое примечание к GET /users). Из-за этого
-- список учеников преподавателя не был связан с тем, какие курсы он
-- реально ведёт.
--
-- Новая логика (см. course_repository.go, enrollment_repository.go):
--   "мои ученики" tutor'а = ученики с активной enrollment на курс,
--   который есть в course_tutors для этого tutor_id, И этот курс
--   принадлежит тому же филиалу, что и сам tutor.
CREATE TABLE course_tutors (
    course_id   INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    tutor_id    INTEGER NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (course_id, tutor_id)
);
CREATE INDEX idx_course_tutors_tutor_id ON course_tutors(tutor_id);

-- Бэкофилл: если на энкоймент уже был назначен tutor_id вручную (старый
-- способ), считаем, что этот преподаватель уже ведёт данный курс —
-- иначе после апгрейда все существующие преподаватели разом потеряют
-- своих текущих учеников.
INSERT INTO course_tutors (course_id, tutor_id)
SELECT DISTINCT course_id, tutor_id
FROM enrollments
WHERE tutor_id IS NOT NULL
ON CONFLICT DO NOTHING;
