-- 0001_init.up.sql
-- Contracts Service schema. Своя БД: study_room_contracts (см.
-- microservices-plan.md, п.1). student_id/parent_id/course_id/branch_id —
-- ссылки на записи из User Service/Academic Service, БЕЗ настоящего
-- FK-констрейнта (разные базы, разные процессы).

CREATE TYPE contract_status AS ENUM ('active', 'completed', 'terminated');
CREATE TYPE payment_status AS ENUM ('unpaid', 'paid');

-- Облегчённая копия пользователей, наполняется событиями
-- user.created/user.updated — см. internal/events. Используется для мягкой
-- валидации при создании договора (см. README.md), не для авторизации.
CREATE TABLE user_refs (
    user_id     INTEGER PRIMARY KEY,
    full_name   VARCHAR(255) NOT NULL DEFAULT '',
    role        VARCHAR(32)  NOT NULL DEFAULT '',
    branch_id   INTEGER,
    synced_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contracts (
    id               SERIAL PRIMARY KEY,
    contract_number  VARCHAR(32) NOT NULL UNIQUE,
    student_id       INTEGER NOT NULL,
    parent_id        INTEGER NOT NULL,
    course_id        INTEGER NOT NULL,
    branch_id        INTEGER NOT NULL,
    amount           NUMERIC(12,2) NOT NULL,
    payment_status   payment_status NOT NULL DEFAULT 'unpaid',
    status           contract_status NOT NULL DEFAULT 'active',
    start_date       DATE NOT NULL,
    end_date         DATE NOT NULL,
    expiry_notified_at TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_contracts_branch_id ON contracts(branch_id);
CREATE INDEX idx_contracts_student_id ON contracts(student_id);
CREATE INDEX idx_contracts_parent_id ON contracts(parent_id);
CREATE INDEX idx_contracts_status ON contracts(status);
CREATE INDEX idx_contracts_end_date ON contracts(end_date);
