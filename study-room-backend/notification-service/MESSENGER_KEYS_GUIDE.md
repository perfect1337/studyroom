# Инструкция по получению API-ключей для мессенджеров

## 1. Telegram Bot

### Что нужно:
- Бот-токен для отправки сообщений от имени бота

### Как получить:

1. Откройте Telegram и найдите [@BotFather](https://t.me/BotFather)
2. Отправьте команду `/newbot`
3. Следуйте инструкциям:
   - Придумайте имя бота (например, `Study Room Notifications`)
   - Придумайте username бота (например, `studyroom_bot`)
4. BotFather выдаст вам токен вида: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`
5. Скопируйте этот токен и установите переменную окружения:
   ```bash
   TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
   ```

### Важные моменты:
- После создания бота, отправьте ему любое сообщение (например, `/start`), чтобы бот мог писать первым
- Telegram Bot API бесплатный
- Ограничение: 30 сообщений/сек для одного бота
- Chat ID получателя можно узнать, отправив запрос:
  ```
  https://api.telegram.org/bot{TOKEN}/getUpdates
  ```

---

## 2. WhatsApp Cloud API (Meta)

### Что нужно:
- ID номера телефона из WhatsApp Business API
- Access token из Meta Developer Console

### Как получить:

#### Шаг 1: Создайте Meta Developer аккаунт
1. Зайдите на [developers.facebook.com](https://developers.facebook.com/)
2. Создайте Developer аккаунт (нужен обычный Facebook аккаунт)

#### Шаг 2: Создайте приложение
1. В [Dashboard](https://developers.facebook.com/apps/) нажмите "Create App"
2. Выберите тип: "Business"
3. Заполните название приложения и business account
4. Добавьте продукт "WhatsApp"

#### Шаг 3: Получите Access Token
1. В настройках приложения → "WhatsApp" → "Configuration"
2. Скопируйте **Temporary Access Token** (или создайте Permanent Token)
3. Установите переменную окружения:
   ```bash
   WHATSAPP_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

#### Шаг 4: Получите Phone Number ID
1. В WhatsApp Configuration → "Phone Number ID"
2. Скопируйте ID номера телефона (длинная строка цифр)
3. Установите переменную окружения:
   ```bash
   WHATSAPP_PHONE_NUMBER_ID=1234567890
   ```

### Важно:
- WhatsApp Cloud API бесплатный до 1000 диалогов в месяц
- Затем — платно по тарифам Meta
- Первые сообщения можно отправлять только в рамках 24-часового окна
- Для новых диалогов нужно использовать Message Templates (шаблоны)

---

## 3. MAX (MaxCore Solutions)

### Что нужно:
- URL MAX API
- App Token для авторизации

### Как получить:

MAX — корпоративный мессенджер, API доступ предоставляется при:
1. Подключении к платформе MAX от MaxCore Solutions
2. Создании приложения/бота в админ-панели MAX
3. Получении API ключей от администратора вашей системы MAX

### Если у вас корпоративный MAX:
- Обратитесь к системному администратору, который развёртывает MAX
- Запросите: `API URL`, `Application Token`, `API documentation`
- Обычно документация по API доступна в админ-панели MAX

### Если MAX не настроен:
- MAX API зависит от версии и конфигурации
- Типичный endpoint: `https://max.company.com/api/v1/messages/send`
- Требуется регистрация приложения в системе MAX

---

## Переменные окружения (для docker-compose.yml)

```yaml
environment:
  # Telegram
  TELEGRAM_BOT_TOKEN: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
  
  # MAX
  MAX_API_URL: "https://max.company.com/api/v1"
  MAX_APP_TOKEN: "your_max_app_token"
  
  # WhatsApp
  WHATSAPP_PHONE_NUMBER_ID: "1234567890"
  WHATSAPP_ACCESS_TOKEN: "EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
  
  # SMTP (существующие)
  SMTP_HOST: "smtp.yandex.ru"
  SMTP_PORT: "465"
  SMTP_USER: "no-reply@yourdomain.ru"
  SMTP_PASSWORD: "your_app_password"
  SMTP_FROM: "Study Room <no-reply@yourdomain.ru>"
```

---

## Тестирование после настройки

### Telegram:
```bash
curl -X POST http://localhost:8085/api/v1/internal/notifications/send \
  -H "X-Service-Token: your_service_token" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": 1,
    "type": "welcome",
    "message": "Test message from Telegram"
  }'
```

### WhatsApp:
```bash
curl -X POST http://localhost:8085/api/v1/internal/notifications/send \
  -H "X-Service-Token: your_service_token" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": 1,
    "type": "welcome",
    "message": "Test message from WhatsApp"
  }'
```

### Проверить настройки пользователя:
```bash
curl -X GET http://localhost:8085/api/v1/notifications/settings \
  -H "Authorization: Bearer your_jwt_token"
```

### Обновить настройки (включить мессенджеры):
```bash
curl -X PATCH http://localhost:8085/api/v1/notifications/settings \
  -H "Authorization: Bearer your_jwt_token" \
  -H "Content-Type: application/json" \
  -d '{
    "email_enabled": true,
    "max_enabled": false,
    "telegram_enabled": true,
    "whatsapp_enabled": true,
    "preferred_messenger": "telegram"
  }'
```
