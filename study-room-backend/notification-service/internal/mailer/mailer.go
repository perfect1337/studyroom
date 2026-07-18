// Package mailer — отправка email через SMTP Яндекс.Почты.
//
// Яндекс поддерживает:
//   - порт 465 — SMTPS (implicit TLS, соединение сразу зашифровано)
//   - порт 587 — STARTTLS (соединение открывается в plaintext, потом апгрейдится)
//
// Логин — полный email (например, no-reply@yourdomain.ru или name@yandex.ru),
// пароль — не обычный пароль от почты, а "пароль приложения", который нужно
// сгенерировать в настройках Яндекс ID (Безопасность → Пароли приложений),
// если на аккаунте включена двухфакторная аутентификация (обычно так и есть).
package mailer

import (
	"crypto/tls"
	"fmt"
	"net"
	"net/smtp"
	"strings"
	"time"
)

type Mailer struct {
	host     string
	port     int
	user     string
	password string
	from     string
}

func New(host string, port int, user, password, from string) *Mailer {
	return &Mailer{host: host, port: port, user: user, password: password, from: from}
}

// Send отправляет письмо в текстовом формате (plain text). to — email получателя.
func (m *Mailer) Send(to, subject, body string) error {
	addr := fmt.Sprintf("%s:%d", m.host, m.port)
	auth := smtp.PlainAuth("", m.user, m.password, m.host)

	msg := buildMessage(m.from, to, subject, body)

	if m.port == 465 {
		return m.sendImplicitTLS(addr, auth, to, msg)
	}
	// 587 (STARTTLS) или любой другой порт — smtp.SendMail сам делает STARTTLS,
	// если сервер его поддерживает (Яндекс на 587 поддерживает).
	return smtp.SendMail(addr, auth, m.from, []string{to}, msg)
}

func (m *Mailer) sendImplicitTLS(addr string, auth smtp.Auth, to string, msg []byte) error {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	conn, err := tls.DialWithDialer(dialer, "tcp", addr, &tls.Config{ServerName: m.host})
	if err != nil {
		return fmt.Errorf("tls dial: %w", err)
	}
	defer conn.Close()

	client, err := smtp.NewClient(conn, m.host)
	if err != nil {
		return fmt.Errorf("smtp client: %w", err)
	}
	defer client.Close()

	if err := client.Auth(auth); err != nil {
		return fmt.Errorf("smtp auth: %w", err)
	}
	if err := client.Mail(m.from); err != nil {
		return fmt.Errorf("smtp mail from: %w", err)
	}
	if err := client.Rcpt(to); err != nil {
		return fmt.Errorf("smtp rcpt to: %w", err)
	}
	wc, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	if _, err := wc.Write(msg); err != nil {
		return fmt.Errorf("smtp write body: %w", err)
	}
	if err := wc.Close(); err != nil {
		return fmt.Errorf("smtp close body: %w", err)
	}
	return client.Quit()
}

func buildMessage(from, to, subject, body string) []byte {
	var b strings.Builder
	b.WriteString("From: " + sanitizeHeader(from) + "\r\n")
	b.WriteString("To: " + sanitizeHeader(to) + "\r\n")
	b.WriteString("Subject: " + sanitizeHeader(subject) + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: text/plain; charset=\"UTF-8\"\r\n")
	b.WriteString("\r\n")
	b.WriteString(body)
	return []byte(b.String())
}

// sanitizeHeader убирает CR/LF, чтобы нельзя было инъектировать заголовки.
func sanitizeHeader(s string) string {
	s = strings.ReplaceAll(s, "\r", "")
	s = strings.ReplaceAll(s, "\n", "")
	return s
}
