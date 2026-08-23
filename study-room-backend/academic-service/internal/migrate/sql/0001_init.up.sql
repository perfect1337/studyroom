-- 0001_init.up.sql
-- Academic Service schema. Матчится с service-2-academic.mermaid из ERD.
-- Своя БД: study_room_academic. student_id/tutor_id/created_by/branch_id —
-- это ССЫЛКИ на записи из User Service, БЕЗ настоящего FK-констрейнта
-- (разные базы, разные процессы). Локальная консистентность обеспечивается
-- через user_refs — облегчённую копию нужных полей пользователя,
-- обновляемую по событиям user.created/user.updated (см. internal/events).

CREATE TYPE course_format AS ENUM ('individual', 'group');
CREATE TYPE enrollment_status AS ENUM ('active', 'completed', 'paused');
CREATE TYPE location_type AS ENUM ('onsite', 'remote');
CREATE TYPE group_type AS ENUM ('individual', 'group');
CREATE TYPE lesson_status AS ENUM ('scheduled', 'completed', 'cancelled');
CREATE TYPE attendance_status AS ENUM ('present', 'absent');
CREATE TYPE homework_status AS ENUM ('assigned', 'viewed');

-- Облегчённая копия пользователей, наполняется событиями
-- user.created/user.updated из брокера (NATS) — см. internal/events.
-- role/branch_id нужны, чтобы проверять матрицу прав (2.6 microservices-plan.md)
-- локально, не дёргая User Service синхронно на каждый запрос.
CREATE TABLE user_refs (
    user_id     INTEGER PRIMARY KEY,
    full_name   VARCHAR(255) NOT NULL DEFAULT '',
    role        VARCHAR(32)  NOT NULL DEFAULT '',
    branch_id   INTEGER,
    synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE courses (
    id          SERIAL PRIMARY KEY,
    title       VARCHAR(255) NOT NULL,
    subject     VARCHAR(255) NOT NULL,
    format      course_format NOT NULL DEFAULT 'individual',
    description TEXT,
    branch_id   INTEGER NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_courses_branch_id ON courses(branch_id);

-- ENROLLMENTS создаётся преимущественно АВТОМАТИЧЕСКИ по событию
-- contract.created из Contracts Service (см. internal/events) — прямой
-- POST /enrollments тоже есть, но только для ручных случаев без договора
-- (например, пробное занятие).
CREATE TABLE enrollments (
    id            SERIAL PRIMARY KEY,
    student_id    INTEGER NOT NULL,
    course_id     INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    tutor_id      INTEGER,
    progress_pct  INTEGER NOT NULL DEFAULT 0,
    status        enrollment_status NOT NULL DEFAULT 'active',
    start_date    DATE,
    end_date      DATE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_enrollments_student_id ON enrollments(student_id);
CREATE INDEX idx_enrollments_tutor_id ON enrollments(tutor_id);
CREATE INDEX idx_enrollments_course_id ON enrollments(course_id);

CREATE TABLE lessons (
    id             SERIAL PRIMARY KEY,
    course_id      INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    tutor_id       INTEGER NOT NULL,
    created_by     INTEGER NOT NULL,
    topic          VARCHAR(500) NOT NULL,
    lesson_date    DATE NOT NULL,
    -- Хранится строкой "HH:MM", а не Postgres TIME — контракт (api-contracts.md
    -- 2.7/2.8) и так оперирует строками, лишнее преобразование не нужно.
    start_time     VARCHAR(5) NOT NULL,
    end_time       VARCHAR(5) NOT NULL,
    location_type  location_type NOT NULL DEFAULT 'remote',
    group_type     group_type NOT NULL DEFAULT 'individual',
    status         lesson_status NOT NULL DEFAULT 'scheduled',
    comment        TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_lessons_tutor_id ON lessons(tutor_id);
CREATE INDEX idx_lessons_course_id ON lessons(course_id);
CREATE INDEX idx_lessons_lesson_date ON lessons(lesson_date);

-- Участники занятия — нужно для группового формата (несколько учеников
-- на одном занятии) и для фильтрации "занятия моего ребёнка" у parent/student.
CREATE TABLE lesson_participants (
    lesson_id   INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    student_id  INTEGER NOT NULL,
    PRIMARY KEY (lesson_id, student_id)
);
CREATE INDEX idx_lesson_participants_student_id ON lesson_participants(student_id);

CREATE TABLE attendance (
    id              SERIAL PRIMARY KEY,
    lesson_id       INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    student_id      INTEGER NOT NULL,
    status          attendance_status NOT NULL DEFAULT 'present',
    absence_reason  TEXT,
    UNIQUE (lesson_id, student_id)
);
CREATE INDEX idx_attendance_student_id ON attendance(student_id);

CREATE TABLE homework (
    id          SERIAL PRIMARY KEY,
    student_id  INTEGER NOT NULL,
    created_by  INTEGER NOT NULL,
    link_url    TEXT NOT NULL,
    status      homework_status NOT NULL DEFAULT 'assigned',
    viewed_at   TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_homework_student_id ON homework(student_id);
CREATE INDEX idx_homework_created_by ON homework(created_by);
