-- 0003_messenger_channels.up.sql
-- Заменяем sms_enabled на три мессенджера + preferred_messenger
-- Все три канала работают независимо — пользователь может включить несколько
-- preferred_messenger указывает основной канал (для UI и fallback логики)

ALTER TABLE notification_settings
    DROP COLUMN IF EXISTS sms_enabled,
    ADD COLUMN max_enabled         BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN telegram_enabled    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN whatsapp_enabled    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN preferred_messenger VARCHAR(20) DEFAULT NULL;

-- Ограничение: preferred_messenger может быть null или одним из значений
DO $$
BEGIN
    ALTER TABLE notification_settings
        ADD CONSTRAINT chk_preferred_messenger CHECK (
            preferred_messenger IS NULL OR
            preferred_messenger IN ('email', 'max', 'telegram', 'whatsapp')
        );
EXCEPTION WHEN OTHERS THEN
    -- Constraint может уже существовать, игнорируем
    NULL;
END $$;
