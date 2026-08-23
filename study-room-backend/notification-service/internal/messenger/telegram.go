package messenger

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

// TelegramProvider — отправка через Telegram Bot API.
// https://core.telegram.org/bots/api#sending-messages
type TelegramProvider struct {
	botToken string
	client   *http.Client
}

type telegramRequest struct {
	ChatID    interface{} `json:"chat_id"` // int64 или string (username/chat_id)
	Text      string      `json:"text"`
	ParseMode string      `json:"parse_mode,omitempty"`
}

type telegramResponse struct {
	Ok          bool   `json:"ok"`
	Description string `json:"description,omitempty"`
}

// NewTelegramProvider создаёт провайдер для Telegram.
// botToken — токен бота, полученный от @BotFather.
func NewTelegramProvider(botToken string) *TelegramProvider {
	return &TelegramProvider{
		botToken: botToken,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// Send отправляет сообщение через Telegram Bot API.
// to — это telegram_chat_id (цифры или @username из users_ref.telegram_id)
func (p *TelegramProvider) Send(userID int64, to, subject, body string) error {
	var chatID interface{}
	// Если to — это цифры, отправляем как int64 (стандартный chat_id)
	// Иначе — как строку (@username или другой формат)
	if _, err := strconv.ParseInt(to, 10, 64); err == nil {
		chatID, _ = strconv.ParseInt(to, 10, 64)
	} else {
		chatID = to
	}

	req := telegramRequest{
		ChatID:    chatID,
		Text:      formatMessage(subject, body),
		ParseMode: "HTML",
	}

	payload, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("telegram marshal: %w", err)
	}

	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", p.botToken)

	resp, err := p.client.Post(url, "application/json", bytes.NewBuffer(payload))
	if err != nil {
		return fmt.Errorf("telegram request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("telegram api error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
	}

	var tgResp telegramResponse
	if err := json.NewDecoder(resp.Body).Decode(&tgResp); err != nil {
		return fmt.Errorf("telegram decode response: %w", err)
	}

	if !tgResp.Ok {
		return fmt.Errorf("telegram api not ok: %s", tgResp.Description)
	}

	return nil
}
