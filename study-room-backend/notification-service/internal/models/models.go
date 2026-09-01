package models

import "time"

type Channel string

const (
	ChannelEmail    Channel = "email"
	ChannelMax      Channel = "max"
	ChannelTelegram Channel = "telegram"
	ChannelWhatsApp Channel = "whatsapp"
	// ChannelInApp — "виртуальный" канал: не доставляет ничего никуда,
	// это ровно то, что показывает колокольчик в вебе (GET /notifications).
	// См. Notifier.Send и NotificationRepository.ListByUser.
	ChannelInApp Channel = "in_app"
)

type Status string

const (
	StatusPending Status = "pending"
	StatusSent    Status = "sent"
	StatusFailed  Status = "failed"
)

// Notification — соответствует таблице notifications.
type Notification struct {
	ID        int64     `json:"id"`
	UserID    int64     `json:"user_id"`
	Type      string    `json:"type"`
	Channel   Channel   `json:"channel"`
	Message   string    `json:"message"`
	Status    Status    `json:"status"`
	IsRead    bool      `json:"is_read"`
	Error     *string   `json:"error,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// Settings — соответствует таблице notification_settings.
type Settings struct {
	UserID             int64  `json:"-"`
	EmailEnabled       bool   `json:"email_enabled"`
	MaxEnabled         bool   `json:"max_enabled"`
	TelegramEnabled    bool   `json:"telegram_enabled"`
	WhatsAppEnabled    bool   `json:"whatsapp_enabled"`
	PreferredMessenger string `json:"preferred_messenger"`
}

// UserRef — облегчённая копия пользователя (users_ref), нужна для
// резолва контактов (email, phone, telegram, whatsapp) при отправке
// уведомлений через разные каналы.
type UserRef struct {
	ID         int64  `json:"id"`
	Email      string `json:"email"`
	FirstName  string `json:"first_name,omitempty"`
	LastName   string `json:"last_name,omitempty"`
	Phone      string `json:"phone,omitempty"`
	TelegramID string `json:"telegram_id,omitempty"`
	MaxID      string `json:"max_id,omitempty"`
	WhatsAppID string `json:"whatsapp_id,omitempty"`
	// ParentID — id родителя, если этот UserRef — ученик (из user.created.parent_id).
	// Нужен, чтобы резолвить получателя attendance.marked_absent локально.
	ParentID *int64 `json:"parent_id,omitempty"`
}

// TelegramUser — связка Telegram chat_id с user_id в системе.
type TelegramUser struct {
	ID               int64     `json:"id"`
	TelegramChatID   int64     `json:"telegram_chat_id"`
	TelegramUsername string    `json:"telegram_username,omitempty"`
	UserID           int64     `json:"user_id"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// MaxUser — связка MAX user_id с user_id в системе (аналог TelegramUser
// для мессенджера MAX). max_user_id — ID пользователя в MAX, приходит в
// событиях bot_started / message_created webhook'а MAX Bot API.
type MaxUser struct {
	ID          int64     `json:"id"`
	MaxUserID   int64     `json:"max_user_id"`
	MaxUsername string    `json:"max_username,omitempty"`
	UserID      int64     `json:"user_id"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
