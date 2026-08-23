-- 0003_messenger_channels.down.sql
-- Откат миграции: возвращаем sms_enabled, убираем мессенджеры

ALTER TABLE notification_settings
    DROP COLUMN IF EXISTS max_enabled,
    DROP COLUMN IF EXISTS telegram_enabled,
    DROP COLUMN IF EXISTS whatsapp_enabled,
    DROP COLUMN IF EXISTS preferred_messenger;

-- Возвращаем sms_enabled для обратной совместимости
ALTER TABLE notification_settings
    ADD COLUMN sms_enabled BOOLEAN NOT NULL DEFAULT false;

-- Удаляем constraint если он был
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'chk_preferred_messenger'
        AND table_name = 'notification_settings'
    ) THEN
        ALTER TABLE notification_settings DROP CONSTRAINT chk_preferred_messenger;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;
