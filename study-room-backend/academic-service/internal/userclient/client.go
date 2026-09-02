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
	"log"
	"net/http"
	"sync"
	"time"
)

type cachedChildren struct {
	ids       []int64
	expiresAt time.Time
}

type Client struct {
	baseURL    string
	httpClient *http.Client
	cacheMu    sync.RWMutex
	cache      map[int64]cachedChildren
	cacheTTL   time.Duration
}

func New(baseURL string) *Client {
	return &Client{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 3 * time.Second},
		cache:      map[int64]cachedChildren{},
		cacheTTL:   30 * time.Second,
	}
}

func (c *Client) WithCacheTTL(ttl time.Duration) *Client {
	c.cacheTTL = ttl
	return c
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
	if parentID == 0 {
		return nil, fmt.Errorf("parent id is required")
	}
	if ids, ok := c.cachedChildren(parentID); ok {
		return ids, nil
	}

	url := fmt.Sprintf("%s/api/v1/parents/%d/children", c.baseURL, parentID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+bearerToken)

	var resp *http.Response
	for attempt := 0; attempt < 2; attempt++ {
		resp, err = c.httpClient.Do(req)
		if err == nil {
			break
		}
		if !isTemporaryNetError(err) {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if err != nil {
		if ids, ok := c.cachedChildrenStale(parentID); ok {
			log.Printf("userclient: upstream error, returning stale cached children for parent %d: %v", parentID, err)
			return ids, nil
		}
		return nil, fmt.Errorf("call user-service: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		if ids, ok := c.cachedChildrenStale(parentID); ok {
			log.Printf("userclient: upstream returned status %d, returning stale cached children for parent %d", resp.StatusCode, parentID)
			return ids, nil
		}
		return nil, fmt.Errorf("user-service returned status %d", resp.StatusCode)
	}

	var body childrenResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		if ids, ok := c.cachedChildrenStale(parentID); ok {
			log.Printf("userclient: decode error, returning stale cached children for parent %d: %v", parentID, err)
			return ids, nil
		}
		return nil, fmt.Errorf("decode user-service response: %w", err)
	}

	ids := make([]int64, 0, len(body.Items))
	for _, item := range body.Items {
		ids = append(ids, item.ID)
	}
	c.cacheChildren(parentID, ids)
	return ids, nil
}

func (c *Client) cachedChildren(parentID int64) ([]int64, bool) {
	c.cacheMu.RLock()
	entry, ok := c.cache[parentID]
	c.cacheMu.RUnlock()
	if !ok || time.Now().After(entry.expiresAt) {
		return nil, false
	}
	return entry.ids, true
}

func (c *Client) cachedChildrenStale(parentID int64) ([]int64, bool) {
	c.cacheMu.RLock()
	entry, ok := c.cache[parentID]
	c.cacheMu.RUnlock()
	if !ok {
		return nil, false
	}
	return entry.ids, true
}

func (c *Client) cacheChildren(parentID int64, ids []int64) {
	c.cacheMu.Lock()
	c.cache[parentID] = cachedChildren{ids: ids, expiresAt: time.Now().Add(c.cacheTTL)}
	c.cacheMu.Unlock()
}

func isTemporaryNetError(err error) bool {
	type temporary interface {
		Temporary() bool
	}
	if te, ok := err.(temporary); ok {
		return te.Temporary()
	}
	return false
}
