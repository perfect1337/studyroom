package messenger

import "fmt"

// Provider — интерфейс для отправки уведомлений через мессенджер.
// Аналог mailer.Sender, но для мессенджеров.
type Provider interface {
	Send(userID int64, to, subject, body string) error
}

// Factory — создаёт провайдер по имени мессенджера.
type Factory struct {
	config Config
}

// Config — конфигурация для всех мессенджеров.
type Config struct {
	TelegramBotToken   string
	MaxAPIURL          string
	MaxAppToken        string
	WhatsAppPhoneID    string
	WhatsAppAccessToken string
}

// NewFactory создаёт Factory с заданной конфигурацией.
func NewFactory(config Config) *Factory {
	return &Factory{config: config}
}

// Get возвращает провайдер для указанного мессенджера.
func (f *Factory) Get(messenger string) (Provider, error) {
	switch messenger {
	case "max":
		return NewMaxProvider(f.config.MaxAPIURL, f.config.MaxAppToken), nil
	case "telegram":
		return NewTelegramProvider(f.config.TelegramBotToken), nil
	case "whatsapp":
		return NewWhatsAppProvider(f.config.WhatsAppPhoneID, f.config.WhatsAppAccessToken), nil
	default:
		return nil, fmt.Errorf("unknown messenger: %s", messenger)
	}
}
