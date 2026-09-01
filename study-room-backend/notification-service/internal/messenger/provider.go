package messenger

import (
	"fmt"
	"sync"
)

// Provider — интерфейс для отправки уведомлений через мессенджер.
// Аналог mailer.Sender, но для мессенджеров.
type Provider interface {
	Send(userID int64, to, subject, body string) error
}

// Factory — создаёт и кэширует провайдеры по имени мессенджера.
//
// Провайдеры должны быть долгоживущими: именно внутри них хранится общий
// rate limiter на конкретного бота. Раньше Get() создавал новый provider на
// каждый вызов, из-за чего состояние троттлинга MAX/Telegram фактически
// сбрасывалось между сообщениями.
type Factory struct {
	config Config

	mu              sync.Mutex
	providers       map[string]Provider
	telegramLimiter *RateLimiter
	maxLimiter      *RateLimiter
}

const (
	providerGlobalRate = 30

	// Telegram: не более ~1 сообщения/сек в один чат.
	telegramPerChatRate = 1

	// MAX: не более 2 сообщений/сек в один диалог.
	maxPerDialogRate = 2
)

// NewFactory создаёт Factory с заданной конфигурацией.
func NewFactory(config Config) *Factory {
	return &Factory{
		config:          config,
		providers:       make(map[string]Provider),
		telegramLimiter: NewRateLimiter(providerGlobalRate, telegramPerChatRate),
		maxLimiter:      NewRateLimiter(providerGlobalRate, maxPerDialogRate),
	}
}

// Get возвращает один долгоживущий provider на канал/бота.
func (f *Factory) Get(messenger string) (Provider, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if provider, ok := f.providers[messenger]; ok {
		return provider, nil
	}

	var provider Provider
	switch messenger {
	case "max":
		provider = NewMaxProviderWithLimiter(f.config.MaxAccessToken, f.maxLimiter)
	case "telegram":
		provider = NewTelegramProviderWithLimiter(f.config.TelegramBotToken, f.telegramLimiter)
	case "whatsapp":
		provider = NewWhatsAppProvider(f.config.WhatsAppPhoneID, f.config.WhatsAppAccessToken)
	default:
		return nil, fmt.Errorf("unknown messenger: %s", messenger)
	}

	f.providers[messenger] = provider
	return provider, nil
}

func (f *Factory) TelegramRateLimiter() *RateLimiter {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.telegramLimiter
}

func (f *Factory) MaxProvider() (*MaxProvider, error) {
	provider, err := f.Get("max")
	if err != nil {
		return nil, err
	}
	p, ok := provider.(*MaxProvider)
	if !ok {
		return nil, fmt.Errorf("max provider has unexpected type %T", provider)
	}
	return p, nil
}
