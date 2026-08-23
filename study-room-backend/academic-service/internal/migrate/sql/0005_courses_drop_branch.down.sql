-- 0005_courses_drop_branch.down.sql
ALTER TABLE courses ADD COLUMN branch_id INTEGER;
CREATE INDEX idx_courses_branch_id ON courses(branch_id);
