-- 0006_enrollment_terminated_status.up.sql
-- Расторжение договора (contract.terminated, см. internal/events/subscriber.go,
-- handleContractTerminated) переводит enrollment в отдельный статус
-- 'terminated', а не переиспользует существующий 'paused'. Переиспользовать
-- 'paused' было бы неверно: ResumeOrphanedForCourse (см.
-- EnrollmentRepository) автоматически снимает с паузы ЛЮБУЮ запись со
-- status='paused' AND tutor_id IS NULL, как только на курс назначают
-- преподавателя — расторгнутая запись случайно "ожила" бы обратно в active
-- вместе с легитимно осиротевшими (после увольнения тьютора) записями.
ALTER TYPE enrollment_status ADD VALUE IF NOT EXISTS 'terminated';
