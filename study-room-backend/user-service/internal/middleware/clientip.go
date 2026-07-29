package middleware

import (
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
)

// TrustedProxies — список CIDR/IP реверс-прокси (nginx, ingress, LB), которым
// разрешено передавать заголовок X-Forwarded-For. Значения из этого
// заголовка используются только для security-критичных решений (rate
// limit, аудит-логи) если непосредственный TCP-пир входит в этот список —
// иначе заголовок приходит напрямую от клиента и может быть подделан как
// угодно, поэтому полностью игнорируется.
type TrustedProxies struct {
	nets []*net.IPNet
	ips  map[string]struct{}
}

// ParseTrustedProxies разбирает список из ENV (через запятую), например:
// "10.0.0.0/8,172.16.0.0/12" или "127.0.0.1,::1".
//
// Пустая строка — валидный и безопасный дефолт: значит "никому не доверяем",
// X-Forwarded-For игнорируется полностью и IP берётся из r.RemoteAddr.
func ParseTrustedProxies(csv string) (*TrustedProxies, error) {
	tp := &TrustedProxies{ips: make(map[string]struct{})}
	csv = strings.TrimSpace(csv)
	if csv == "" {
		return tp, nil
	}
	for _, raw := range strings.Split(csv, ",") {
		item := strings.TrimSpace(raw)
		if item == "" {
			continue
		}
		if strings.Contains(item, "/") {
			_, ipnet, err := net.ParseCIDR(item)
			if err != nil {
				return nil, fmt.Errorf("invalid TRUSTED_PROXIES CIDR %q: %w", item, err)
			}
			tp.nets = append(tp.nets, ipnet)
			continue
		}
		if net.ParseIP(item) == nil {
			return nil, fmt.Errorf("invalid TRUSTED_PROXIES IP %q", item)
		}
		tp.ips[item] = struct{}{}
	}
	return tp, nil
}

func (tp *TrustedProxies) trusts(ip string) bool {
	if tp == nil {
		return false
	}
	if _, ok := tp.ips[ip]; ok {
		return true
	}
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return false
	}
	for _, n := range tp.nets {
		if n.Contains(parsed) {
			return true
		}
	}
	return false
}

var (
	trustedMu sync.RWMutex
	trusted   *TrustedProxies // nil/пустой по умолчанию — XFF не доверяем никому
)

// SetTrustedProxies задаёт глобальный список доверенных прокси для пакета.
// Вызывается один раз при старте сервиса (main.go), после config.Load().
func SetTrustedProxies(tp *TrustedProxies) {
	trustedMu.Lock()
	trusted = tp
	trustedMu.Unlock()
}

func currentTrustedProxies() *TrustedProxies {
	trustedMu.RLock()
	defer trustedMu.RUnlock()
	return trusted
}

func peerIP(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		// RemoteAddr без порта (например, в юнит-тестах) — возвращаем как есть.
		return remoteAddr
	}
	return host
}

// clientIP определяет "реальный" IP клиента для rate-limit и аудит-логов.
//
// X-Forwarded-For доверяем ТОЛЬКО если непосредственный TCP-пир запроса
// (r.RemoteAddr) входит в список доверенных прокси — иначе заголовок
// пришёл напрямую от (потенциально враждебного) клиента и может содержать
// любое значение. Раньше сервис брал первое значение из XFF без всякой
// проверки: атакующий мог слать свой X-Forwarded-For со случайным IP в
// каждом запросе и полностью обходить rate limit на /auth/* при брутфорсе
// логина/регистрации — этот файл закрывает именно эту дыру.
//
// Если пир доверен, идём по цепочке XFF СПРАВА НАЛЕВО (хопы, ближайшие к
// нам, добавлены доверенными прокси) и берём первый адрес, который сам не
// входит в доверенный список — это и есть внешний клиент. Если список
// доверенных прокси не настроен (пусто) — XFF игнорируется полностью и
// используется только r.RemoteAddr. Это безопасный дефолт "по умолчанию
// никому не доверяем".
func clientIP(r *http.Request) string {
	peer := peerIP(r.RemoteAddr)

	tp := currentTrustedProxies()
	if !tp.trusts(peer) {
		return peer
	}

	xff := r.Header.Get("X-Forwarded-For")
	if xff == "" {
		return peer
	}

	parts := strings.Split(xff, ",")
	for i := len(parts) - 1; i >= 0; i-- {
		candidate := strings.TrimSpace(parts[i])
		if candidate == "" {
			continue
		}
		if !tp.trusts(candidate) {
			return candidate
		}
	}
	return peer
}
