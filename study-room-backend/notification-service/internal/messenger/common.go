package messenger

// formatMessage форматирует subject и body в сообщение для мессенджера.
// Добавляет тему в начало сообщения.
func formatMessage(subject, body string) string {
	if subject == "" {
		return body
	}
	return subject + "\n\n" + body
}
