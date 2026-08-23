-- 0005_seed_owner.down.sql

DELETE FROM users WHERE email = 'owner@test.local' AND role = 'owner';
