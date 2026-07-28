-- 0003_tests.up.sql
-- Тесты — отдельная от homework сущность, которую тьютор выдаёт ученику
-- (см. api-contracts.md 2.15-2.18). В отличие от homework, у теста есть
-- жизненный цикл "сдан/не сдан" и оценка, которую выставляет тьютор после
-- сдачи. Оценка используется в разделе "Успеваемость": средняя
-- арифметическая по всем оценённым тестам ученика считается на лету в
-- репозитории/хендлере, отдельной таблицей/колонкой не хранится.
CREATE TYPE test_status AS ENUM ('assigned', 'submitted');

CREATE TABLE tests (
    id           SERIAL PRIMARY KEY,
    student_id   INTEGER NOT NULL,
    created_by   INTEGER NOT NULL,
    title        VARCHAR(255) NOT NULL,
    link_url     TEXT NOT NULL,
    status       test_status NOT NULL DEFAULT 'assigned',
    grade        SMALLINT,
    submitted_at TIMESTAMPTZ,
    graded_at    TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT tests_grade_range CHECK (grade IS NULL OR (grade BETWEEN 1 AND 5))
);
CREATE INDEX idx_tests_student_id ON tests(student_id);
CREATE INDEX idx_tests_created_by ON tests(created_by);
