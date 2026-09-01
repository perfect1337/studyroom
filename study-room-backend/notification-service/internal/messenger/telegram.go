package messenger

import (
	"bytes"
	"context"
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
	limiter  *RateLimiter
}

type telegramRequest struct {
	ChatID    interface{} `json:"chat_id"`
	Text      string      `json:"text"`
	ParseMode string      `json:"parse_mode,omitempty"`
}

type telegramResponse struct {
	Ok          bool   `json:"ok"`
	Description string `json:"description,omitempty"`
	Parameters  struct {
		RetryAfter int `json:"retry_after,omitempty"`
	} `json:"parameters,omitempty"`
}

func NewTelegramProvider(botToken string) *TelegramProvider {
	return NewTelegramProviderWithLimiter(botToken, NewRateLimiter(providerGlobalRate, telegramPerChatRate))
}

func NewTelegramProviderWithLimiter(botToken string, limiter *RateLimiter) *TelegramProvider {
	if limiter == nil {
		limiter = NewRateLimiter(providerGlobalRate, telegramPerChatRate)
	}
	return &TelegramProvider{
		botToken: botToken,
		limiter:  limiter,
		client:   &http.Client{Timeout: 10 * time.Second},
	}
}

// Send отправляет сообщение через Telegram Bot API.
// Для массовой рассылки соблюдается общий лимит ~30 msg/sec, а также
// отдельный лимит на один чат. При неожиданном 429 учитывается retry_after
// и запрос повторяется, а не превращается сразу в failed.
func (p *TelegramProvider) Send(_ int64, to, subject, body string) error {
	var chatID interface{}
	if parsed, err := strconv.ParseInt(to, 10, 64); err == nil {
		chatID = parsed
	} else {
		chatID = to
	}

	reqPayload := telegramRequest{
		ChatID:    chatID,
		Text:      formatMessage(subject, body),
		ParseMode: "HTML",
	}

	payload, err := json.Marshal(reqPayload)
	if err != nil {
		return fmt.Errorf("telegram marshal: %w", err)
	}

	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", p.botToken)

	attempt := 0
	for {
		attempt++
		if err := p.limiter.Wait(context.Background(), to); err != nil {
			return fmt.Errorf("telegram rate limiter: %w", err)
		}

		resp, err := p.client.Post(url, "application/json", bytes.NewBuffer(payload))
		if err != nil {
			return fmt.Errorf("telegram request: %w", err)
		}

		bodyBytes, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode == http.StatusOK {
			var tgResp telegramResponse
			if err := json.Unmarshal(bodyBytes, &tgResp); err != nil {
				return fmt.Errorf("telegram decode response: %w", err)
			}
			if !tgResp.Ok {
				return fmt.Errorf("telegram api not ok: %s", tgResp.Description)
			}
			return nil
		}

		if resp.StatusCode == http.StatusTooManyRequests {
			var tgResp telegramResponse
			_ = json.Unmarshal(bodyBytes, &tgResp)
			retryAfter := tgResp.Parameters.RetryAfter
			if retryAfter <= 0 {
				retryAfter = minInt(attempt, 30)
			}
			time.Sleep(time.Duration(retryAfter) * time.Second)
			continue
		}

		if readErr != nil {
			return fmt.Errorf("telegram api error: status=%d, body read failed: %w", resp.StatusCode, readErr)
		}
		return fmt.Errorf("telegram api error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
	}

	return fmt.Errorf("telegram api rate limit: retry attempts exhausted")
}
