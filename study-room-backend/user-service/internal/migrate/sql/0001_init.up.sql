-- 0001_init.up.sql
-- User Service schema. Матчится с service-1-users.mermaid из ERD.

CREATE TYPE user_role AS ENUM ('owner', 'branch_owner', 'tutor', 'parent', 'student');
CREATE TYPE tutor_status AS ENUM ('active', 'vacation', 'sick_leave', 'inactive');

CREATE TABLE branches (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(255) NOT NULL,
    city          VARCHAR(255) NOT NULL,
    address       VARCHAR(500),
    phone         VARCHAR(50),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id             SERIAL PRIMARY KEY,
    email          VARCHAR(255) UNIQUE NOT NULL,
    phone          VARCHAR(50) UNIQUE,
    password_hash  VARCHAR(255) NOT NULL,
    role           user_role NOT NULL,
    last_name      VARCHAR(255) NOT NULL,
    first_name     VARCHAR(255) NOT NULL,
    patronymic     VARCHAR(255),
    avatar_url     TEXT,
    branch_id      INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    is_active      BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_branch_id ON users(branch_id);

-- Profile-таблицы 1-к-1 с users, как в ERD (STUDENT_PROFILES / TUTOR_PROFILES)
CREATE TABLE student_profiles (
    user_id         INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    class_info      VARCHAR(255),
    school          VARCHAR(255),
    avg_grade       NUMERIC(3,2),
    attendance_pct  NUMERIC(5,2)
);

CREATE TABLE tutor_profiles (
    user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    specialization     VARCHAR(255),
    experience_years   INTEGER,
    rating             NUMERIC(3,2),
    status             tutor_status NOT NULL DEFAULT 'active'
);

CREATE TABLE parent_student (
    parent_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    student_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (parent_id, student_id)
);

-- Не было явно в ERD, но нужно технически: хранение refresh-токенов,
-- чтобы можно было отозвать сессию (logout / компрометация токена).
CREATE TABLE refresh_tokens (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(255) NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
