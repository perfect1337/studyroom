// Package userclient — единственный синхронный HTTP-вызов Academic Service
// к User Service. Всё остальное (роль, филиал репетитора/ученика) читается
// из локального кэша user_refs, наполняемого событиями (см. internal/events).
//
// Список "чьи я дети" — это связь parent↔student, которой в Academic Service
// нет и не будет (см. service-info/microservices-plan.md: "database-per-service",
// у Academic нет причин дублировать семейные связи). Поэтому для фильтрации
// "покажи записи/занятия/домашку только моих детей" сервис один раз
// синхронно спрашивает User Service — см. api-contracts.md, 1.18
// GET /parents/{id}/children — и передаёт дальше тот же Bearer-токен
// вызывающего (эндпоинт и так требует role=parent и самого parent'а).
package userclient

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type Client struct {
	baseURL    string
	httpClient *http.Client
}

func New(baseURL string) *Client {
	return &Client{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 3 * time.Second},
	}
}

// childrenResponse — соответствует api-contracts.md, 1.18:
// { "items": [ { "id": 4588201, "first_name": "...", ... } ] }
type childrenResponse struct {
	Items []struct {
		ID int64 `json:"id"`
	} `json:"items"`
}

// Children возвращает id детей родителя parentID, используя тот же
// Bearer-токен, что пришёл в запрос к Academic Service (проброс авторизации
// "как есть" — User Service сам проверит, что это действительно этот parent).
func (c *Client) Children(ctx context.Context, bearerToken string, parentID int64) ([]int64, error) {
	url := fmt.Sprintf("%s/api/v1/parents/%d/children", c.baseURL, parentID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+bearerToken)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call user-service: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("user-service returned status %d", resp.StatusCode)
	}

	var body childrenResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("decode user-service response: %w", err)
	}

	ids := make([]int64, 0, len(body.Items))
	for _, item := range body.Items {
		ids = append(ids, item.ID)
	}
	return ids, nil
}
