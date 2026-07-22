package models

import "time"

// Role — дублирует enum из User Service (models.Role). Отдельная копия,
// а не общий пакет, потому что это разные Go-модули с разными БД —
// см. service-info/microservices-plan.md, "database-per-service".
type Role string

const (
	RoleOwner       Role = "owner"
	RoleBranchOwner Role = "branch_owner"
	RoleTutor       Role = "tutor"
	RoleParent      Role = "parent"
	RoleStudent     Role = "student"
)

// UserRef — облегчённая копия пользователя (таблица user_refs), наполняется
// событиями user.created/user.updated из User Service. Нужна CRM Service,
// чтобы резолвить, кому из owner/branch_owner слать application.received
// (см. event-schema.md, "v1.application.received"), без синхронного похода
// в User Service на каждую заявку.
type UserRef struct {
	UserID   int64  `json:"user_id"`
	FullName string `json:"full_name"`
	Role     Role   `json:"role"`
	BranchID *int64 `json:"branch_id"`
}

type ApplicationSource string

const (
	SourceTilda    ApplicationSource = "tilda"
	SourceInternal ApplicationSource = "internal"
)

type ApplicationStatus string

const (
	StatusNew        ApplicationStatus = "new"
	StatusInProgress ApplicationStatus = "in_progress"
	StatusConverted  ApplicationStatus = "converted"
	StatusRejected   ApplicationStatus = "rejected"
)

// Application — соответствует таблице applications. Покрывает оба
// источника заявок сразу (см. api-contracts.md, 4.1/4.2):
//   - source=tilda: наполняются Name/Age/Phone/SubjectInterest/ParentName
//     из вебхука, StudentID/Format всегда nil.
//   - source=internal: наполняются StudentID/SubjectInterest/Format от
//     родителя из ЛК, Age/Phone/ParentName всегда nil (уже есть в
//     User Service, дублировать незачем — см. 2.4 microservices-plan.md).
type Application struct {
	ID              int64             `json:"id"`
	Source          ApplicationSource `json:"source"`
	Status          ApplicationStatus `json:"status"`
	Name            string            `json:"name"`
	Age             *int              `json:"age,omitempty"`
	Phone           *string           `json:"phone,omitempty"`
	SubjectInterest *string           `json:"subject_interest,omitempty"`
	ParentName      *string           `json:"parent_name,omitempty"`
	StudentID       *int64            `json:"student_id,omitempty"`
	Format          *string           `json:"format,omitempty"`
	BranchID        *int64            `json:"branch_id,omitempty"`
	HandledBy       *int64            `json:"handled_by,omitempty"`
	CreatedAt       time.Time         `json:"created_at"`
}
