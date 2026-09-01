package messenger

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// MaxProvider — отправка через MAX Bot API (мессенджер MAX, платформа VK).
// Документация: https://dev.max.ru/docs-api
//
// Ключевые факты API (проверены по документации dev.max.ru):
//   - базовый домен: https://platform-api2.max.ru
//   - авторизация: заголовок `Authorization: <access_token>` (query-параметр
//     больше не поддерживается)
//   - отправка сообщения пользователю: POST /messages?user_id={user_id}
//     (user_id — ID пользователя MAX, не телефон!)
//   - лимит: не более 2 сообщений в секунду в один диалог
//   - форматирование: параметр format = "html" | "markdown"
//
// ВАЖНО: раньше здесь был placeholder с выдуманным API
// (POST {apiURL}/messages/send, поля applicationToken/recipientPhone).
// Это не соответствует реальному MAX Bot API и заменено на рабочий клиент.
type MaxProvider struct {
	accessToken string
	client      *http.Client

	// perUserLastSend — время последней отправки по каждому max user_id.
	// MAX разрешает не более 2 сообщений/сек в один диалог — держим паузу
	// minSendInterval между сообщениями одному пользователю (простая
	// очередь-троттлинг на стороне провайдера, см. документацию выше).
	mu              sync.Mutex
	perUserLastSend map[int64]time.Time
	perUserMu       map[int64]*sync.Mutex
}

// maxMessageRequest — тело запроса POST /messages (только текст; медиа и
// клавиатуры в MVP не нужны).
type maxMessageRequest struct {
	Text   string `json:"text"`
	Format string `json:"format,omitempty"` // "html" | "markdown"
}

// minSendInterval — 500мс между сообщениями в один диалог (лимит 2/сек).
const minSendInterval = 500 * time.Millisecond

// NewMaxProvider создаёт провайдер для MAX.
// accessToken — токен бота (от MasterBot или «MAX для бизнеса»).
func NewMaxProvider(accessToken string) *MaxProvider {
	return &MaxProvider{
		accessToken:     accessToken,
		perUserLastSend: map[int64]time.Time{},
		perUserMu:       map[int64]*sync.Mutex{},
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// Send отправляет сообщение пользователю MAX.
// to — это max user_id (число, из max_users.max_user_id / users_ref.max_id).
func (p *MaxProvider) Send(userID int64, to, subject, body string) error {
	maxUserID, err := strconv.ParseInt(to, 10, 64)
	if err != nil {
		return fmt.Errorf("max: invalid user id %q (must be numeric MAX user_id): %w", to, err)
	}

	// Троттлинг: не более 2 сообщений/сек в один диалог.
	p.throttle(maxUserID)

	req := maxMessageRequest{
		Text:   formatMessage(subject, body),
		Format: "html",
	}

	payload, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("max marshal: %w", err)
	}

	url := fmt.Sprintf("https://platform-api2.max.ru/messages?user_id=%d", maxUserID)

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
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		return fmt.Errorf("max api error: status=%d, body=%s", resp.StatusCode, string(bodyBytes))
	}

	// На 200/201 MAX возвращает объект сообщения; для нашей цели достаточно
	// самого статуса — детальный разбор ответа не требуется.
	return nil
}

// throttle ждёт, пока с момента последней отправки пользователю maxUserID
// пройдёт minSendInterval (MAX: ≤2 сообщений/сек в один диалог).
func (p *MaxProvider) throttle(maxUserID int64) {
	// Берём отдельный mutex на каждый MAX user_id: параллельные уведомления
	// одному диалогу действительно становятся очередью, а разные диалоги
	// не блокируют друг друга. Важно записывать lastSend ПОСЛЕ ожидания —
	// иначе две goroutine могли одновременно увидеть старое время и уйти в
	// MAX практически одновременно, нарушив лимит 2 msg/sec.
	p.mu.Lock()
	userMu := p.perUserMu[maxUserID]
	if userMu == nil {
		userMu = &sync.Mutex{}
		p.perUserMu[maxUserID] = userMu
	}
	p.mu.Unlock()

	userMu.Lock()
	defer userMu.Unlock()

	p.mu.Lock()
	last := p.perUserLastSend[maxUserID]
	p.mu.Unlock()

	if !last.IsZero() {
		if wait := minSendInterval - time.Since(last); wait > 0 {
			time.Sleep(wait)
		}
	}

	p.mu.Lock()
	p.perUserLastSend[maxUserID] = time.Now()
	p.mu.Unlock()
}
