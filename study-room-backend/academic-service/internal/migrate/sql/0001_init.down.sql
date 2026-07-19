-- 0001_init.down.sql
DROP TABLE IF EXISTS homework;
DROP TABLE IF EXISTS attendance;
DROP TABLE IF EXISTS lesson_participants;
DROP TABLE IF EXISTS lessons;
DROP TABLE IF EXISTS enrollments;
DROP TABLE IF EXISTS courses;
DROP TABLE IF EXISTS user_refs;

DROP TYPE IF EXISTS homework_status;
DROP TYPE IF EXISTS attendance_status;
DROP TYPE IF EXISTS lesson_status;
DROP TYPE IF EXISTS group_type;
DROP TYPE IF EXISTS location_type;
DROP TYPE IF EXISTS enrollment_status;
DROP TYPE IF EXISTS course_format;
