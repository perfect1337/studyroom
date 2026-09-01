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

// MaxProvider — отправка через MAX Bot API.
// Документация: https://dev.max.ru/docs-api/methods/POST/messages
type MaxProvider struct {
	accessToken string
	client      *http.Client
	limiter     *RateLimiter
}

type maxMessageRequest struct {
	Text   string `json:"text"`
	Format string `json:"format,omitempty"`
}

type maxResponse struct {
	Code    int    `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

// NewMaxProvider создаёт provider с общим лимитом 30 API-запросов/сек и
// лимитом 2 сообщения/сек в один диалог.
func NewMaxProvider(accessToken string) *MaxProvider {
	return NewMaxProviderWithLimiter(
		accessToken,
		NewRateLimiter(providerGlobalRate, maxPerDialogRate),
	)
}

func NewMaxProviderWithLimiter(accessToken string, limiter *RateLimiter) *MaxProvider {
	if limiter == nil {
		limiter = NewRateLimiter(providerGlobalRate, maxPerDialogRate)
	}
	return &MaxProvider{
		accessToken: accessToken,
		limiter:     limiter,
		client:      &http.Client{Timeout: 10 * time.Second},
	}
}

// Send отправляет сообщение пользователю MAX. Если API неожиданно отвечает
// 429, provider выдерживает retry-after/экспоненциальную паузу и повторяет
// запрос, оставляя notification в очереди до успешной отправки.
func (p *MaxProvider) Send(_ int64, to, subject, body string) error {
	maxUserID, err := strconv.ParseInt(to, 10, 64)
	if err != nil {
		return fmt.Errorf("max: invalid user id %q (must be numeric MAX user_id): %w", to, err)
	}

	reqPayload := maxMessageRequest{
		Text:   formatMessage(subject, body),
		Format: "html",
	}
	payload, err := json.Marshal(reqPayload)
	if err != nil {
		return fmt.Errorf("max marshal: %w", err)
	}

	url := fmt.Sprintf("https://platform-api2.max.ru/messages?user_id=%d", maxUserID)

	attempt := 0
	for {
		attempt++
		if err := p.limiter.Wait(context.Background(), to); err != nil {
			return fmt.Errorf("max rate limiter: %w", err)
		}

		httpReq, err := http.NewRequest(http.MethodPost, url, bytes.NewBuffer(payload))
		if err != nil {
			return fmt.Errorf("max request: %w", err)
		}
		httpReq.Header.Set("Authorization", p.accessToken)
		httpReq.Header.Set("Content-Type", "application/json")

		resp, err := p.client.Do(httpReq)
		if err != nil {
			return fmt.Errorf("max request: %w", err)
		}

		bodyBytes, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated {
			return nil
		}

		if resp.StatusCode == http.StatusTooManyRequests {
			retryAfter := retryAfterFromHeaders(resp.Header)
			if retryAfter <= 0 {
				retryAfter = time.Second * time.Duration(1<<uint(attempt-1))
				if retryAfter > 30*time.Second {
					retryAfter = 30 * time.Second
				}
			}
			if attempt < 6 {
				time.Sleep(retryAfter)
				continue
			}
		}

		if readErr != nil {
			return fmt.Errorf("max api error: status=%d, body read failed: %w", resp.StatusCode, readErr)
		}
		return fmt.Errorf("max api error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
	}

	return fmt.Errorf("max api rate limit: retry attempts exhausted")
}

func retryAfterFromHeaders(h http.Header) time.Duration {
	value := h.Get("Retry-After")
	if value == "" {
		return 0
	}
	seconds, err := strconv.Atoi(value)
	if err != nil || seconds < 0 {
		return 0
	}
	return time.Duration(seconds) * time.Second
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
