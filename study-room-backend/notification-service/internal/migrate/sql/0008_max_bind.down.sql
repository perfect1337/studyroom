-- 0008_max_bind.down.sql

DROP TABLE IF EXISTS max_users;

ALTER TABLE users_ref DROP COLUMN IF EXISTS max_id;
