package messenger

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// MaxProvider — отправка через MAX (MaxCore Solutions) REST API.
// Документация MAX API зависит от версии, здесь типичная реализация.
type MaxProvider struct {
	apiURL    string
	appToken  string
	client    *http.Client
}

type maxMessageRequest struct {
	ApplicationToken string `json:"applicationToken"`
	RecipientPhone   string `json:"recipientPhone"`
	Message          string `json:"message"`
}

type maxMessageResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
	Error   string `json:"error,omitempty"`
}

// NewMaxProvider создаёт провайдер для MAX мессенджера.
// apiURL — URL MAX API (например, https://max.example.com/api/v1)
// appToken — токен приложения для авторизации.
func NewMaxProvider(apiURL, appToken string) *MaxProvider {
	return &MaxProvider{
		apiURL: apiURL,
		appToken: appToken,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// Send отправляет сообщение через MAX API.
func (p *MaxProvider) Send(userID int64, to, subject, body string) error {
	// to — это phone number в формате E.164 (например, +79XXXXXXXXX)
	req := maxMessageRequest{
		ApplicationToken: p.appToken,
		RecipientPhone:   to,
		Message:          formatMessage(subject, body),
	}

	payload, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("max marshal: %w", err)
	}

	url := p.apiURL + "/messages/send"

	resp, err := p.client.Post(url, "application/json", bytes.NewBuffer(payload))
	if err != nil {
		return fmt.Errorf("max request: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("max api error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
	}

	var maxResp maxMessageResponse
	if err := json.Unmarshal(bodyBytes, &maxResp); err != nil {
		return fmt.Errorf("max decode response: %w", err)
	}

	if !maxResp.Success {
		return fmt.Errorf("max api not success: %s", maxResp.Error)
	}

	return nil
}
