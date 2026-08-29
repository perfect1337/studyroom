import { useEffect, useState } from "react";
import { fetchNotificationSettings } from "../api/notifications.js";
import { useTelegramStatus } from "./useTelegramStatus.js";

// useTelegramConnectPrompt — должен ли показаться плавающий баннер
// "Подключите Telegram для уведомлений" (см.
// components/notifications/TelegramConnectBanner.jsx). Условие то же, что
// изначально было в ParentOverview: человек включил Telegram-канал в
// настройках уведомлений (см. SettingsPage.jsx — доступно всем ролям,
// кроме ученика), но ещё не привязал аккаунт к боту.
//
// Для страниц, у которых уже есть собственное состояние notif/tgStatus
// (например ParentOverview — там ниже на странице ещё и переключатели
// каналов уведомлений), этот хук не нужен: они передают в
// TelegramConnectBanner уже посчитанное условие напрямую из своих
// существующих fetchNotificationSettings/useTelegramStatus, не делая
// лишний повторный запрос.
export function useTelegramConnectPrompt() {
  const { status: tgStatus } = useTelegramStatus();
  const [telegramEnabled, setTelegramEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchNotificationSettings()
      .then((s) => {
        if (!cancelled) setTelegramEnabled(!!s?.telegram_enabled);
      })
      .catch(() => {
        if (!cancelled) setTelegramEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return telegramEnabled && !!tgStatus && !tgStatus.connected;
}
