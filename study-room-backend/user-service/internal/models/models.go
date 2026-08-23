package models

import "time"

// IsValidGrade — класс ученика должен быть чистым числом от 1 до 11 (без
// букв/литер вроде "10А"). Используется и при регистрации ученика
// (CreateStudent/UpdateMe), и в ежегодном job'е автоповышения класса
// (см. internal/promotion), поэтому вынесено в общий пакет моделей, а не
// продублировано в обоих местах.
func IsValidGrade(s string) bool {
	if len(s) == 0 || len(s) > 2 {
		return false
	}
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	switch s {
	case "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11":
		return true
	default:
		return false
	}
}

type Role string

const (
	RoleOwner       Role = "owner"
	RoleBranchOwner Role = "branch_owner"
	RoleTutor       Role = "tutor"
	RoleParent      Role = "parent"
	RoleStudent     Role = "student"
)

type TutorStatus string

const (
	TutorStatusActive    TutorStatus = "active"
	TutorStatusVacation  TutorStatus = "vacation"
	TutorStatusSickLeave TutorStatus = "sick_leave"
	TutorStatusInactive  TutorStatus = "inactive"
)

// User — соответствует таблице users. password_hash никогда не сериализуется в JSON.
type User struct {
	ID           int64   `json:"id"`
	Email        string  `json:"email"`
	Phone        *string `json:"phone,omitempty"`
	PasswordHash string  `json:"-"`
	Role         Role    `json:"role"`
	LastName     string  `json:"last_name"`
	FirstName    string  `json:"first_name"`
	Patronymic   *string `json:"patronymic,omitempty"`
	AvatarURL    *string `json:"avatar_url,omitempty"`
	BranchID     *int64  `json:"branch_id"`
	// BranchName — заполняется через LEFT JOIN branches в profileColumns/
	// fromProfileJoins (см. user_repository.go). nil, если branch_id не задан.
	// Нужен фронту, чтобы показывать филиал в профиле (сайдбар и т.п.) без
	// отдельного похода в GET /branches, который доступен только owner.
	BranchName *string   `json:"branch_name,omitempty"`
	IsActive   bool      `json:"is_active"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`

	// Заполняются только для role=tutor через LEFT JOIN tutor_profiles в List/ListAll
	// (см. user_repository.go). Для остальных ролей всегда nil.
	Specialization *string      `json:"specialization,omitempty"`
	TutorStatus    *TutorStatus `json:"tutor_status,omitempty"`

	// Заполняются только для role=student через LEFT JOIN student_profiles
	// в List/ListAll/GetByID (см. user_repository.go, scanUserWithProfiles).
	// Для остальных ролей всегда nil.
	ClassInfo     *string  `json:"class_info,omitempty"`
	School        *string  `json:"school,omitempty"`
	AvgGrade      *float64 `json:"avg_grade,omitempty"`
	AttendancePct *float64 `json:"attendance_pct,omitempty"`
}

type Branch struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	City      string    `json:"city"`
	Address   *string   `json:"address,omitempty"`
	Phone     *string   `json:"phone,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	// DeletedAt — nil для активного филиала. Заполняется при "удалении"
	// филиала (см. BranchRepository.Delete): сам филиал физически не
	// стирается, а только помечается, чтобы owner мог посмотреть его в
	// разделе "Удалённые" (какие преподаватели/ученики там были).
	DeletedAt *time.Time `json:"deleted_at,omitempty"`
}

type StudentProfile struct {
	UserID        int64    `json:"user_id"`
	ClassInfo     *string  `json:"class_info,omitempty"`
	School        *string  `json:"school,omitempty"`
	AvgGrade      *float64 `json:"avg_grade,omitempty"`
	AttendancePct *float64 `json:"attendance_pct,omitempty"`
}

type TutorProfile struct {
	UserID          int64       `json:"user_id"`
	Specialization  *string     `json:"specialization,omitempty"`
	ExperienceYears *int        `json:"experience_years,omitempty"`
	Rating          *float64    `json:"rating,omitempty"`
	Status          TutorStatus `json:"status"`
}
