package models

import "time"

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
	TutorStatusActive     TutorStatus = "active"
	TutorStatusVacation   TutorStatus = "vacation"
	TutorStatusSickLeave  TutorStatus = "sick_leave"
	TutorStatusInactive   TutorStatus = "inactive"
)

// User — соответствует таблице users. password_hash никогда не сериализуется в JSON.
type User struct {
	ID           int64     `json:"id"`
	Email        string    `json:"email"`
	Phone        *string   `json:"phone,omitempty"`
	PasswordHash string    `json:"-"`
	Role         Role      `json:"role"`
	LastName     string    `json:"last_name"`
	FirstName    string    `json:"first_name"`
	Patronymic   *string   `json:"patronymic,omitempty"`
	AvatarURL    *string   `json:"avatar_url,omitempty"`
	BranchID     *int64    `json:"branch_id"`
	IsActive     bool      `json:"is_active"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type Branch struct {
	ID        int64     `json:"id"`
	Name      string    `json:"name"`
	City      string    `json:"city"`
	Address   *string   `json:"address,omitempty"`
	Phone     *string   `json:"phone,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

type StudentProfile struct {
	UserID        int64    `json:"user_id"`
	ClassInfo     *string  `json:"class_info,omitempty"`
	School        *string  `json:"school,omitempty"`
	AvgGrade      *float64 `json:"avg_grade,omitempty"`
	AttendancePct *float64 `json:"attendance_pct,omitempty"`
}

type TutorProfile struct {
	UserID           int64       `json:"user_id"`
	Specialization   *string     `json:"specialization,omitempty"`
	ExperienceYears  *int        `json:"experience_years,omitempty"`
	Rating           *float64    `json:"rating,omitempty"`
	Status           TutorStatus `json:"status"`
}
