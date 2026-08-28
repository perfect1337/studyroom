-- 0006_enrollment_terminated_status.down.sql
-- Postgres не поддерживает DROP VALUE для enum напрямую — тип пересоздаётся.
-- Любые уже существующие 'terminated' записи переводятся в 'paused' как
-- ближайший по смыслу статус ("не активна, но не бесследно"), это lossy-
-- откат, поскольку сам факт "договор был расторгнут" в статусе enrollment
-- больше не отличим от обычной паузы после увольнения тьютора.
ALTER TYPE enrollment_status RENAME TO enrollment_status_old;
CREATE TYPE enrollment_status AS ENUM ('active', 'completed', 'paused');

UPDATE enrollments SET status = 'paused' WHERE status::text = 'terminated';

ALTER TABLE enrollments
    ALTER COLUMN status DROP DEFAULT,
    ALTER COLUMN status TYPE enrollment_status USING status::text::enrollment_status,
    ALTER COLUMN status SET DEFAULT 'active';

DROP TYPE enrollment_status_old;
