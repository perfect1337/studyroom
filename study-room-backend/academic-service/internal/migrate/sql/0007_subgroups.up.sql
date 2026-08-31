-- 0007_subgroups.up.sql
-- Подгруппы: именованный набор учеников на конкретном курсе, который тьютор
-- заводит один раз и потом переиспользует при создании занятий (см.
-- lesson_handler.go createLessonRequest.SubgroupID), не выбирая участников
-- заново каждый раз вручную. Имеет смысл только на курсах с form
-- format='group' — это не проверяется на уровне БД (courses.format может
-- поменяться позже), но проверяется в SubgroupHandler.Create на момент
-- создания подгруппы.

CREATE TABLE subgroups (
    id         BIGSERIAL PRIMARY KEY,
    course_id  BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    tutor_id   BIGINT NOT NULL,
    name       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subgroups_course_id ON subgroups(course_id);
CREATE INDEX idx_subgroups_tutor_id ON subgroups(tutor_id);

-- subgroup_members — состав подгруппы. student_id намеренно без FK на
-- какую-либо локальную таблицу пользователей (её тут нет, users живут в
-- User Service, см. user_refs — облегчённый кэш) — так же, как это уже
-- сделано для lesson_participants.student_id в 0001_init.up.sql.
CREATE TABLE subgroup_members (
    subgroup_id BIGINT NOT NULL REFERENCES subgroups(id) ON DELETE CASCADE,
    student_id  BIGINT NOT NULL,
    PRIMARY KEY (subgroup_id, student_id)
);
