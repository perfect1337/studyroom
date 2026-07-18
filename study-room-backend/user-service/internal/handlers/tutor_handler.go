package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"studyroom/user-service/internal/middleware"
	"studyroom/user-service/internal/models"
	"studyroom/user-service/internal/repository"
)

type TutorHandler struct {
	tutorProfiles *repository.TutorProfileRepository
	users         *repository.UserRepository
}

func NewTutorHandler(tp *repository.TutorProfileRepository, users *repository.UserRepository) *TutorHandler {
	return &TutorHandler{tutorProfiles: tp, users: users}
}

var allowedTutorStatuses = map[models.TutorStatus]bool{
	models.TutorStatusActive:    true,
	models.TutorStatusVacation:  true,
	models.TutorStatusSickLeave: true,
	models.TutorStatusInactive:  true,
}

// --- 1.15. PATCH /tutors/{id}/status ---
func (h *TutorHandler) SetStatus(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "invalid id")
		return
	}
	var body struct {
		Status models.TutorStatus `json:"status"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || !allowedTutorStatuses[body.Status] {
		writeError(w, http.StatusBadRequest, "VALIDATION_ERROR", "status must be one of active|vacation|sick_leave|inactive")
		return
	}

	claims, _ := middleware.FromContext(r.Context())

	// Ключевое правило контракта 1.15: значение "inactive" может ставить
	// только owner. branch_owner получает 403, даже если это репетитор его филиала.
	if body.Status == models.TutorStatusInactive && claims.Role != models.RoleOwner {
		writeError(w, http.StatusForbidden, "FORBIDDEN", "only owner can set status to inactive")
		return
	}

	// branch_owner может менять статус только репетиторам своего филиала
	if claims.Role == models.RoleBranchOwner {
		target, err := h.users.GetByID(r.Context(), id)
		if err != nil {
			writeError(w, http.StatusNotFound, "NOT_FOUND", "tutor not found")
			return
		}
		if target.BranchID == nil || claims.BranchID == nil || *target.BranchID != *claims.BranchID {
			writeError(w, http.StatusForbidden, "FORBIDDEN", "not allowed to edit tutors of another branch")
			return
		}
	}

	if err := h.tutorProfiles.SetStatus(r.Context(), id, body.Status); err != nil {
		writeError(w, http.StatusInternalServerError, "INTERNAL", "update failed")
		return
	}
	w.WriteHeader(http.StatusOK)
}
