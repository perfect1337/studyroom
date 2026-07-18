package models

import "time"

type Channel string

const (
	ChannelEmail     Channel = "email"
	ChannelSMS       Channel = "sms"
	ChannelMessenger Channel = "messenger"
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
	UserID           int64 `json:"-"`
	EmailEnabled     bool  `json:"email_enabled"`
	SMSEnabled       bool  `json:"sms_enabled"`
	MessengerEnabled bool  `json:"messenger_enabled"`
}

// UserRef — облегчённая копия пользователя (users_ref), нужна только
// чтобы знать, на какой email слать письма.
type UserRef struct {
	ID        int64  `json:"id"`
	Email     string `json:"email"`
	FirstName string `json:"first_name,omitempty"`
	LastName  string `json:"last_name,omitempty"`
}
