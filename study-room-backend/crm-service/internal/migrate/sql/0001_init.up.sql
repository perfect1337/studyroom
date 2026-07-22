-- 0001_init.up.sql
-- CRM Service schema. Своя БД: study_room_crm (см. microservices-plan.md, п.1).
-- student_id/branch_id/handled_by — ССЫЛКИ на записи из User Service, БЕЗ
-- настоящего FK-констрейнта (разные базы, разные процессы). Локальная
-- консистентность для резолва получателя уведомления обеспечивается через
-- user_refs — облегчённую копию нужных полей пользователя, обновляемую по
-- событиям user.created/user.updated (см. internal/events).

CREATE TYPE application_source AS ENUM ('tilda', 'internal');
CREATE TYPE application_status AS ENUM ('new', 'in_progress', 'converted', 'rejected');

-- Облегчённая копия пользователей, наполняется событиями
-- user.created/user.updated из брокера (NATS) — см. internal/events.
-- role/branch_id нужны, чтобы резолвить владельца/владельца филиала,
-- которому отправить application.received, локально, без похода в
-- User Service на каждую заявку.
CREATE TABLE user_refs (
    user_id     INTEGER PRIMARY KEY,
    full_name   VARCHAR(255) NOT NULL DEFAULT '',
    role        VARCHAR(32)  NOT NULL DEFAULT '',
    branch_id   INTEGER,
    synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_refs_role_branch ON user_refs(role, branch_id);

-- Заявки — и с сайта (source=tilda, через вебхук), и внутренние
-- (source=internal, форма "Записаться на новый курс" в ЛК родителя).
-- См. api-contracts.md, раздел 4.
CREATE TABLE applications (
    id                SERIAL PRIMARY KEY,
    source            application_source NOT NULL,
    status            application_status NOT NULL DEFAULT 'new',
    name              VARCHAR(255) NOT NULL,
    age               INTEGER,
    phone             VARCHAR(32),
    subject_interest  VARCHAR(255),
    parent_name       VARCHAR(255),
    student_id        INTEGER,
    format            VARCHAR(20),
    branch_id         INTEGER,
    handled_by        INTEGER,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_applications_branch_id ON applications(branch_id);
CREATE INDEX idx_applications_student_id ON applications(student_id);
