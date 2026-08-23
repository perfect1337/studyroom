package messenger

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// WhatsAppProvider — отправка через WhatsApp Cloud API (Meta).
// https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message
type WhatsAppProvider struct {
	phoneNumberID string
	accessToken   string
	client        *http.Client
}

type whatsappMessageRequest struct {
	MessagingProduct string           `json:"messaging_product"`
	RecipientType    string           `json:"recipient_type"`
	To               string           `json:"to"`
	Type             string           `json:"type"`
	Text             whatsappText     `json:"text"`
}

type whatsappText struct {
	Body string `json:"body"`
}

type whatsappResponse struct {
	Contacts []whatsappContact `json:"contacts"`
	Messages []whatsappMsg     `json:"messages"`
	Error    *whatsappError    `json:"error,omitempty"`
}

type whatsappContact struct {
	Input string `json:"input"`
	WAID  string `json:"wa_id"`
}

type whatsappMsg struct {
	ID  string `json:"id"`
}

type whatsappError struct {
	Code          int    `json:"code"`
	Message       string `json:"message"`
	ErrorData     whatsappErrorData `json:"error_data,omitempty"`
	StatusCode    int    `json:"error_details,omitempty"`
}

type whatsappErrorData struct {
	Message       string `json:"message"`
	ErrorSubcode  int    `json:"error_subcode"`
	FbErrorCode   int    `json:"fberror_code"`
	FbErrorTitle  string `json:"fberror_title"`
	FbErrorString string `json:"fberror_string"`
}

// NewWhatsAppProvider создаёт провайдер для WhatsApp Cloud API.
// phoneNumberID — ID номера телефона из WhatsApp Business API.
// accessToken — temporary или permanent access token из Meta Developer Console.
func NewWhatsAppProvider(phoneNumberID, accessToken string) *WhatsAppProvider {
	return &WhatsAppProvider{
		phoneNumberID: phoneNumberID,
		accessToken:   accessToken,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// Send отправляет сообщение через WhatsApp Cloud API.
func (p *WhatsAppProvider) Send(userID int64, to, subject, body string) error {
	// to — это phone number в формате E.164 (например, +79XXXXXXXXX)
	msgReq := whatsappMessageRequest{
		MessagingProduct: "whatsapp",
		RecipientType:    "individual",
		To:               to,
		Type:             "text",
		Text: whatsappText{
			Body: formatMessage(subject, body),
		},
	}

	payload, err := json.Marshal(msgReq)
	if err != nil {
		return fmt.Errorf("whatsapp marshal: %w", err)
	}

	url := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/messages", p.phoneNumberID)

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(payload))
	if err != nil {
		return fmt.Errorf("whatsapp request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+p.accessToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("whatsapp request: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("whatsapp api error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
	}

	var waResp whatsappResponse
	if err := json.Unmarshal(bodyBytes, &waResp); err != nil {
		return fmt.Errorf("whatsapp decode response: %w", err)
	}

	if waResp.Error != nil {
		return fmt.Errorf("whatsapp api error: %d - %s", waResp.Error.Code, waResp.Error.Message)
	}

	return nil
}
