// Package academicclient — HTTP-клиент к Academic Service для получения
// student IDs по филиалу. Используется для фильтрации учеников branch_owner'а
// — чтобы видеть не только "домашних" учеников (users.branch_id), но и
// иногородних, которые обучаются в этом филиале по enrollment.
package academicclient

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type cachedBranch struct {
	expiresAt time.Time
	ids       []int64
}

type Client struct {
	baseURL    string
	httpClient *http.Client
	cacheMu    sync.RWMutex
	cache      map[int64]cachedBranch
	cacheTTL   time.Duration
}

func New(baseURL string) *Client {
	return &Client{
		baseURL:    baseURL,
		httpClient: &http.Client{Timeout: 3 * time.Second},
		cache:      map[int64]cachedBranch{},
		cacheTTL:   30 * time.Second,
	}
}

func (c *Client) WithCacheTTL(ttl time.Duration) *Client {
	c.cacheTTL = ttl
	return c
}

// StudentIDsByBranch возвращает список student IDs, у которых есть active
// enrollment в указанном филиале. Используется user-service для фильтрации
// учеников branch_owner'а — чтобы видеть иногородних учеников.
func (c *Client) StudentIDsByBranch(ctx context.Context, bearerToken string, branchID int64) ([]int64, error) {
	if ids, ok := c.cached(branchID); ok {
		return ids, nil
	}

	url := fmt.Sprintf("%s/api/v1/academic/enrollments/branch/%d/students", c.baseURL, branchID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+bearerToken)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("call academic-service: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("academic-service returned status %d", resp.StatusCode)
	}

	var body struct {
		StudentIDs []int64 `json:"student_ids"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("decode academic-service response: %w", err)
	}

	ids := body.StudentIDs
	if ids == nil {
		ids = []int64{}
	}
	c.cacheBranch(branchID, ids)
	return ids, nil
}

func (c *Client) cached(branchID int64) ([]int64, bool) {
	c.cacheMu.RLock()
	entry, ok := c.cache[branchID]
	c.cacheMu.RUnlock()
	if !ok || time.Now().After(entry.expiresAt) {
		return nil, false
	}
	return entry.ids, true
}

func (c *Client) cacheBranch(branchID int64, ids []int64) {
	c.cacheMu.Lock()
	c.cache[branchID] = cachedBranch{
		expiresAt: time.Now().Add(c.cacheTTL),
		ids:       ids,
	}
	c.cacheMu.Unlock()
}
