package userclient_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"studyroom/academic-service/internal/userclient"
)

type childrenResponse struct {
	Items []struct {
		ID int64 `json:"id"`
	} `json:"items"`
}

func TestChildren_CachesSuccessfulResponse(t *testing.T) {
	requestCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(childrenResponse{Items: []struct {
			ID int64 `json:"id"`
		}{{ID: 42}}})
	}))
	defer srv.Close()

	client := userclient.New(srv.URL)
	ids, err := client.Children(context.Background(), "token", 1)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(ids) != 1 || ids[0] != 42 {
		t.Fatalf("unexpected children ids: %#v", ids)
	}

	ids, err = client.Children(context.Background(), "token", 1)
	if err != nil {
		t.Fatalf("expected no error from cache, got %v", err)
	}
	if requestCount != 1 {
		t.Fatalf("expected only one upstream request, got %d", requestCount)
	}
}

func TestChildren_ReturnsStaleCacheWhenUserServiceFails(t *testing.T) {
	responseCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		responseCount++
		if responseCount == 1 {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(childrenResponse{Items: []struct {
				ID int64 `json:"id"`
			}{{ID: 7}}})
			return
		}
		http.Error(w, "service unavailable", http.StatusServiceUnavailable)
	}))
	defer server.Close()

	client := userclient.New(server.URL)
	ids, err := client.Children(context.Background(), "token", 2)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(ids) != 1 || ids[0] != 7 {
		t.Fatalf("unexpected children ids: %#v", ids)
	}

	ids, err = client.Children(context.Background(), "token", 2)
	if err != nil {
		t.Fatalf("expected stale cache fallback, got %v", err)
	}
	if len(ids) != 1 || ids[0] != 7 {
		t.Fatalf("expected cached children on failure, got %#v", ids)
	}
}

func TestChildren_CacheExpires(t *testing.T) {
	reqCount := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqCount++
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(childrenResponse{Items: []struct {
			ID int64 `json:"id"`
		}{{ID: int64(reqCount)}}})
	}))
	defer srv.Close()

	client := userclient.New(srv.URL)
	client = client.WithCacheTTL(10 * time.Millisecond)

	ids, err := client.Children(context.Background(), "token", 3)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(ids) != 1 || ids[0] != 1 {
		t.Fatalf("unexpected ids after first request: %#v", ids)
	}

	time.Sleep(20 * time.Millisecond)
	ids, err = client.Children(context.Background(), "token", 3)
	if err != nil {
		t.Fatalf("expected no error after cache expiry, got %v", err)
	}
	if len(ids) != 1 || ids[0] != 2 {
		t.Fatalf("expected refreshed ids after expiry, got %#v", ids)
	}
}
