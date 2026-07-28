package models

import "time"

// Role — дублирует enum из User Service (models.Role). Отдельная копия,
// а не общий пакет, потому что это разные Go-модули с разными БД —
// см. service-info/microservices-plan.md, "database-per-service".
// Значения строго совпадают со строками в JWT-claims, которые выпускает
// User Service, и с role в USER_REFS.
type Role string

const (
	RoleOwner       Role = "owner"
	RoleBranchOwner Role = "branch_owner"
	RoleTutor       Role = "tutor"
	RoleParent      Role = "parent"
	RoleStudent     Role = "student"
)

// UserRef — облегчённая копия пользователя (таблица user_refs), наполняется
// событиями user.created/user.updated из User Service. Даёт возможность
// проверять роль/филиал репетитора или ученика локально, без синхронного
// похода в User Service на каждый запрос (см. microservices-plan.md, 2.4).
type UserRef struct {
	UserID   int64   `json:"user_id"`
	FullName string  `json:"full_name"`
	Role     Role    `json:"role"`
	BranchID *int64  `json:"branch_id"`
}

type CourseFormat string

const (
	FormatIndividual CourseFormat = "individual"
	FormatGroup      CourseFormat = "group"
)

// Course — соответствует таблице courses.
// TutorIDs — id преподавателей, которые ведут этот курс (таблица
// course_tutors, many-to-many). Наполняется JOIN'ом в репозитории,
// собственной колонки в courses нет. Пусто в ответах Create/Update
// (только что созданный курс ещё ни к кому не привязан).
type Course struct {
	ID          int64        `json:"id"`
	Title       string       `json:"title"`
	Subject     string       `json:"subject"`
	Format      CourseFormat `json:"format"`
	Description *string      `json:"description,omitempty"`
	BranchID    int64        `json:"branch_id"`
	TutorIDs    []int64      `json:"tutor_ids"`
	CreatedAt   time.Time    `json:"created_at"`
}

// CourseTutor — соответствует таблице course_tutors: назначение
// преподавателя на курс (один курс — несколько преподавателей,
// один преподаватель — несколько курсов).
type CourseTutor struct {
	CourseID  int64     `json:"course_id"`
	TutorID   int64     `json:"tutor_id"`
	CreatedAt time.Time `json:"created_at"`
}

type EnrollmentStatus string

const (
	EnrollmentActive    EnrollmentStatus = "active"
	EnrollmentCompleted EnrollmentStatus = "completed"
	EnrollmentPaused    EnrollmentStatus = "paused"
)

// Enrollment — соответствует таблице enrollments.
type Enrollment struct {
	ID          int64            `json:"id"`
	StudentID   int64            `json:"student_id"`
	CourseID    int64            `json:"course_id"`
	TutorID     *int64           `json:"tutor_id"`
	ProgressPct int              `json:"progress_pct"`
	Status      EnrollmentStatus `json:"status"`
	StartDate   *time.Time       `json:"start_date,omitempty"`
	EndDate     *time.Time       `json:"end_date,omitempty"`
	CreatedAt   time.Time        `json:"created_at"`
}

type LocationType string

const (
	LocationOnsite LocationType = "onsite"
	LocationRemote LocationType = "remote"
)

type GroupType string

const (
	GroupIndividual GroupType = "individual"
	GroupGroup      GroupType = "group"
)

type LessonStatus string

const (
	LessonScheduled LessonStatus = "scheduled"
	LessonCompleted LessonStatus = "completed"
	LessonCancelled LessonStatus = "cancelled"
)

// Lesson — соответствует таблице lessons.
type Lesson struct {
	ID           int64        `json:"id"`
	CourseID     int64        `json:"course_id"`
	TutorID      int64        `json:"tutor_id"`
	CreatedBy    int64        `json:"created_by"`
	Topic        string       `json:"topic"`
	LessonDate   time.Time    `json:"lesson_date"`
	StartTime    string       `json:"start_time"`
	EndTime      string       `json:"end_time"`
	LocationType LocationType `json:"location_type"`
	GroupType    GroupType    `json:"group_type"`
	Status       LessonStatus `json:"status"`
	Comment      *string      `json:"comment,omitempty"`
	CreatedAt    time.Time    `json:"created_at"`
	// ParticipantIDs — id учеников занятия (lesson_participants). Заполняется
	// в хендлере (см. LessonHandler.List) отдельным батч-запросом, а не в
	// каждом scanLesson, чтобы не плодить N+1. Нужно фронту, чтобы строить
	// "Мои ученики" тьютора из реально созданных занятий, а не из enrollments/
	// course_tutors — см. TutorStudents.jsx / PeopleDirectory.jsx.
	ParticipantIDs []int64 `json:"participant_ids,omitempty"`
}

type AttendanceStatus string

const (
	AttendancePresent AttendanceStatus = "present"
	AttendanceAbsent  AttendanceStatus = "absent"
)

// Attendance — соответствует таблице attendance.
type Attendance struct {
	ID             int64            `json:"id"`
	LessonID       int64            `json:"lesson_id"`
	StudentID      int64            `json:"student_id"`
	Status         AttendanceStatus `json:"status"`
	AbsenceReason  *string          `json:"absence_reason,omitempty"`
}

type HomeworkStatus string

const (
	HomeworkAssigned HomeworkStatus = "assigned"
	HomeworkViewed   HomeworkStatus = "viewed"
)

// Homework — соответствует таблице homework. Максимально упрощено:
// репетитор выдаёт ссылку на внешний ресурс, сдач/оценок нет.
type Homework struct {
	ID        int64          `json:"id"`
	StudentID int64          `json:"student_id"`
	CreatedBy int64          `json:"created_by"`
	LinkURL   string         `json:"link_url"`
	Status    HomeworkStatus `json:"status"`
	ViewedAt  *time.Time     `json:"viewed_at"`
	CreatedAt time.Time      `json:"created_at"`
}
