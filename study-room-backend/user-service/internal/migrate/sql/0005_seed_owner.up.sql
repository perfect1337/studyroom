-- 0005_seed_owner.up.sql
-- Сидинг первого owner-а. По api-contracts.md owner нельзя завести через
-- POST /auth/register (там разрешены только tutor/parent/student), поэтому
-- без этой миграции в свежей БД просто некому будет войти и создать
-- филиалы/branch_owner-ов — вход в систему был бы физически невозможен.
--
-- ON CONFLICT (email) DO NOTHING — идемпотентно, безопасно для повторного
-- прогона и для окружений, где owner уже создан вручную/сидером.
--
-- Пароль по умолчанию: qwerty228 (bcrypt, cost=12) — сменить после первого
-- входа в проде.

INSERT INTO users (email, phone, password_hash, role, last_name, first_name, patronymic, branch_id, is_active)
VALUES (
    'owner@test.local',
    '+70000000001',
    '$2b$12$xEZmtduakPFnfNzzwDWVWuM.Y6AqKaix/dZSRSCRMGAN881LDk3i2',
    'owner',
    'Владимиров',
    'Олег',
    'Игоревич',
    NULL,
    true
)
ON CONFLICT (email) DO NOTHING;
