package models

import "time"

// Role — дублирует enum из User Service. Отдельная копия, а не общий пакет —
// разные Go-модули с разными БД (database-per-service).
type Role string

const (
	RoleOwner       Role = "owner"
	RoleBranchOwner Role = "branch_owner"
	RoleTutor       Role = "tutor"
	RoleParent      Role = "parent"
	RoleStudent     Role = "student"
)

// UserRef — облегчённая копия пользователя, наполняется user.created/
// user.updated. См. README.md — на текущий момент используется только для
// мягкой валидации (роль student_id/parent_id действительно
// student/parent) при создании договора; авторизация по branch_owner/parent
// идёт через claims/userclient, не через этот кэш.
type UserRef struct {
	UserID   int64  `json:"user_id"`
	FullName string `json:"full_name"`
	Role     Role   `json:"role"`
	BranchID *int64 `json:"branch_id"`
}

type ContractStatus string

const (
	StatusActive     ContractStatus = "active"
	StatusCompleted  ContractStatus = "completed"
	StatusTerminated ContractStatus = "terminated"
)

type PaymentStatus string

const (
	PaymentUnpaid PaymentStatus = "unpaid"
	PaymentPaid   PaymentStatus = "paid"
)

// Contract — соответствует таблице contracts (см. api-contracts.md, раздел 3).
// student_id/parent_id/course_id/branch_id — ссылки на записи в других
// сервисах, без настоящего FK (разные БД, разные процессы).
// StartDate/EndDate — time.Time (как в academic-service), не отдельный
// Date-тип: JSON-маршалинг даёт RFC3339 ("2026-08-01T00:00:00Z"), а не
// голое "2026-08-01" из примеров api-contracts.md — то же расхождение уже
// есть в academic-service (Enrollment.StartDate) и здесь оставлено для
// консистентности между сервисами, а не исправлено половинчато в одном месте.
type Contract struct {
	ID             int64          `json:"id"`
	ContractNumber string         `json:"contract_number"`
	StudentID      int64          `json:"student_id"`
	ParentID       int64          `json:"parent_id"`
	CourseID       int64          `json:"course_id"`
	BranchID       int64          `json:"branch_id"`
	Amount         float64        `json:"amount"`
	PaymentStatus  PaymentStatus  `json:"payment_status"`
	Status         ContractStatus `json:"status"`
	StartDate      time.Time      `json:"start_date"`
	EndDate        time.Time      `json:"end_date"`
	CreatedAt      time.Time      `json:"created_at"`
}

// ContractExpiry — облегчённая версия для 3.3a (branch_owner/parent):
// никаких полей про сумму/статус оплаты.
type ContractExpiry struct {
	ContractID int64     `json:"contract_id"`
	EndDate    time.Time `json:"end_date"`
}
