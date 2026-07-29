-- 0004_tests_course.up.sql
-- Привязываем тест к курсу, чтобы можно было показать ученику/родителю/
-- тьютору/админу не только название теста, но и курс и предмет, по
-- которому он выдан (см. StudentTests/TutorTests/ParentOverview и др.).
-- Nullable + ON DELETE SET NULL: тест не должен исчезать, если курс
-- впоследствии удалили, — просто перестанет показываться курс/предмет.
ALTER TABLE tests ADD COLUMN course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL;
CREATE INDEX idx_tests_course_id ON tests(course_id);
