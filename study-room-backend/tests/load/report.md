# Load Test Report

**Run started:** 2026-07-23T14:04:26+04:00

**Run finished:** 2026-07-23T14:04:31+04:00

**Overall result:** PASS

## Configuration

- user-service: http://localhost:8081
- academic-service: http://localhost:8082
- contracts-service: http://localhost:8083
- crm-service: http://localhost:8084
- notification-service: http://localhost:8085
- nats-url: nats://localhost:4222
- jwt-secret: (hidden)

## Summary

- scenarios: 14 (passed: 14, failed: 0, skipped: 0)
- HTTP requests made: 72
- total run time: 5.331s

| Scenario | Status | Duration | Requests |
|---|---|---|---|
| HealthzAndDocs | PASS | 13ms | 0 |
| AuthNegativeCases | PASS | 660ms | 9 |
| InitialSetup | PASS | 678ms | 6 |
| UserAuthenticationAndDirectory | PASS | 227ms | 5 |
| AuthorizationAndRBAC | PASS | 222ms | 7 |
| ContractsLifecycle | PASS | 4ms | 4 |
| ContractsValidationAndAccessControl | PASS | 228ms | 11 |
| AcademicLessonAndAttendance | PASS | 8ms | 3 |
| AcademicValidationAndAccessControl | PASS | 233ms | 8 |
| NotificationSettingsAndRead | PASS | 7ms | 5 |
| NotificationsAccessControl | PASS | 2ms | 3 |
| AcademicEnrollmentFromContract | PASS | 1ms | 1 |
| CRMValidationAndAccessControl | PASS | 17ms | 7 |
| CRMToNotificationFlow | PASS | 3.01s | 3 |

## Scenario results

### ✅ HealthzAndDocs

- status: PASS
- duration: 13ms
- details (15 entries):
  1. OK notification-service http://localhost:8085/healthz
  2. OK notification-service http://localhost:8085/openapi.yaml
  3. OK notification-service http://localhost:8085/docs
  4. OK user-service http://localhost:8081/healthz
  5. OK user-service http://localhost:8081/openapi.yaml
  6. OK user-service http://localhost:8081/docs
  7. OK academic-service http://localhost:8082/healthz
  8. OK academic-service http://localhost:8082/openapi.yaml
  9. OK academic-service http://localhost:8082/docs
  10. OK contracts-service http://localhost:8083/healthz
  11. OK contracts-service http://localhost:8083/openapi.yaml
  12. OK contracts-service http://localhost:8083/docs
  13. OK crm-service http://localhost:8084/healthz
  14. OK crm-service http://localhost:8084/openapi.yaml
  15. OK crm-service http://localhost:8084/docs

### ✅ AuthNegativeCases

- status: PASS
- duration: 660ms
- details (18 entries):
  1. POST /api/v1/auth/register -> 200 (220ms)
  2. registered baseline user parent-negative+1784801066596111800@test.local for negative auth checks
  3. POST /api/v1/auth/register -> 409 (216ms)
  4. confirmed duplicate registration returns 409
  5. POST /api/v1/auth/register -> 400 (1ms)
  6. confirmed registration validation rejects short passwords
  7. POST /api/v1/auth/register -> 400 (1ms)
  8. confirmed registration validation rejects missing name fields
  9. POST /api/v1/auth/login -> 401 (217ms)
  10. confirmed login rejects the wrong password
  11. POST /api/v1/auth/login -> 401 (1ms)
  12. confirmed login rejects an unknown identity
  13. POST /api/v1/auth/refresh -> 401 (1ms)
  14. confirmed refresh rejects an invalid refresh token
  15. POST /api/v1/auth/forgot-password -> 200 (1ms)
  16. confirmed forgot-password does not leak account existence
  17. POST /api/v1/auth/reset-password -> 400 (1ms)
  18. confirmed reset-password rejects an invalid reset token

### ✅ InitialSetup

- status: PASS
- duration: 678ms
- details (12 entries):
  1. POST /api/v1/auth/register -> 200 (221ms)
  2. registered parent parent+1784801067256116800@test.local with user id 32
  3. POST /api/v1/branches -> 201 (2ms)
  4. created branch 9
  5. POST /api/v1/users/tutors -> 201 (224ms)
  6. created tutor 33
  7. POST /api/v1/academic/courses -> 201 (5ms)
  8. created course 7
  9. POST /api/v1/users/students -> 201 (218ms)
  10. created student 34 for parent 32
  11. POST /api/v1/contracts -> 201 (4ms)
  12. created contract 6 for student 34

### ✅ UserAuthenticationAndDirectory

- status: PASS
- duration: 227ms
- details (10 entries):
  1. POST /api/v1/auth/login -> 200 (221ms)
  2. parent login success for user 32
  3. POST /api/v1/auth/refresh -> 200 (3ms)
  4. refresh token returned new access token
  5. GET /api/v1/users/me -> 200 (1ms)
  6. users/me returned parent profile for id 32
  7. PATCH /api/v1/users/me -> 200 (2ms)
  8. updated parent first_name to Ирина
  9. GET /api/v1/parents/32/children -> 200 (1ms)
  10. parent has 1 child(ren)

### ✅ AuthorizationAndRBAC

- status: PASS
- duration: 222ms
- details (13 entries):
  1. GET /api/v1/users/me -> 401 (1ms)
  2. confirmed users/me rejects requests without a token
  3. GET /api/v1/users/me -> 401 (1ms)
  4. confirmed users/me rejects a malformed token
  5. POST /api/v1/branches -> 403 (1ms)
  6. confirmed parent role cannot create branches (403)
  7. POST /api/v1/users/tutors -> 403 (1ms)
  8. confirmed parent role cannot create tutors (403)
  9. POST /api/v1/users/students -> 403 (1ms)
  10. confirmed a parent cannot create a student under another parent's id
  11. POST /api/v1/auth/register -> 200 (219ms)
  12. GET /api/v1/parents/32/children -> 403 (1ms)
  13. confirmed a parent cannot view another parent's children list

### ✅ ContractsLifecycle

- status: PASS
- duration: 4ms
- details (8 entries):
  1. GET /api/v1/contracts/6 -> 200 (1ms)
  2. fetched contract 6
  3. GET /api/v1/contracts?student_id=34 -> 200 (1ms)
  4. owner can see contract 6 in contract list
  5. PATCH /api/v1/contracts/6/status -> 200 (2ms)
  6. contract 6 status update request accepted
  7. GET /api/v1/contracts/6 -> 200 (1ms)
  8. contract 6 transitioned to status "completed"

### ✅ ContractsValidationAndAccessControl

- status: PASS
- duration: 228ms
- details (17 entries):
  1. POST /api/v1/contracts -> 403 (1ms)
  2. confirmed parent role cannot create contracts (403)
  3. POST /api/v1/contracts -> 400 (1ms)
  4. POST /api/v1/contracts -> 400 (1ms)
  5. POST /api/v1/contracts -> 400 (1ms)
  6. POST /api/v1/contracts -> 400 (1ms)
  7. confirmed contract creation validation rejects malformed payloads
  8. GET /api/v1/contracts/999999999 -> 404 (1ms)
  9. confirmed nonexistent contract returns 404
  10. PATCH /api/v1/contracts/6/status -> 400 (1ms)
  11. confirmed invalid contract status value is rejected
  12. POST /api/v1/branches -> 201 (2ms)
  13. GET /api/v1/contracts/6/expiry -> 403 (1ms)
  14. confirmed branch_owner from another branch cannot read this contract's expiry
  15. POST /api/v1/auth/register -> 200 (219ms)
  16. GET /api/v1/contracts/6/expiry -> 403 (2ms)
  17. confirmed a parent outside the family cannot read this contract's expiry

### ✅ AcademicLessonAndAttendance

- status: PASS
- duration: 8ms
- details (6 entries):
  1. POST /api/v1/academic/lessons -> 201 (4ms)
  2. created lesson 9 for course 7
  3. POST /api/v1/academic/lessons/9/attendance -> 200 (2ms)
  4. marked attendance present for student 34 on lesson 9
  5. GET /api/v1/academic/lessons/9/attendance -> 200 (3ms)
  6. verified attendance record for student 34 on lesson 9

### ✅ AcademicValidationAndAccessControl

- status: PASS
- duration: 233ms
- details (15 entries):
  1. POST /api/v1/academic/lessons -> 400 (1ms)
  2. confirmed lesson creation validation rejects incomplete payloads
  3. POST /api/v1/academic/lessons -> 403 (1ms)
  4. confirmed parent role cannot create lessons (403)
  5. POST /api/v1/academic/lessons -> 403 (1ms)
  6. confirmed a tutor cannot create lessons on behalf of another tutor
  7. POST /api/v1/academic/lessons -> 201 (3ms)
  8. created lesson 10 to exercise attendance validation/access checks
  9. POST /api/v1/academic/lessons/10/attendance -> 400 (1ms)
  10. confirmed invalid attendance status value is rejected
  11. GET /api/v1/academic/lessons/999999999/attendance -> 404 (1ms)
  12. confirmed nonexistent lesson returns 404
  13. POST /api/v1/auth/register -> 200 (225ms)
  14. GET /api/v1/academic/lessons/10/attendance -> 403 (2ms)
  15. confirmed a parent whose child doesn't attend the lesson cannot read attendance

### ✅ NotificationSettingsAndRead

- status: PASS
- duration: 7ms
- details (9 entries):
  1. GET /api/v1/notifications/settings -> 200 (2ms)
  2. fetched notification settings: email=true sms=false messenger=false
  3. PATCH /api/v1/notifications/settings -> 200 (1ms)
  4. toggled sms_enabled from false to true
  5. GET /api/v1/notifications?unread_only=true -> 200 (1ms)
  6. PATCH /api/v1/notifications/45/read -> 200 (2ms)
  7. marked notification 45 as read
  8. GET /api/v1/notifications?unread_only=true -> 200 (1ms)
  9. confirmed notification 45 no longer present in unread list

### ✅ NotificationsAccessControl

- status: PASS
- duration: 2ms
- details (6 entries):
  1. GET /api/v1/notifications -> 401 (0s)
  2. confirmed notifications endpoint rejects requests without a token
  3. GET /api/v1/notifications -> 401 (1ms)
  4. confirmed notifications endpoint rejects a malformed token
  5. PATCH /api/v1/notifications/999999999/read -> 404 (1ms)
  6. confirmed marking a nonexistent notification as read returns 404

### ✅ AcademicEnrollmentFromContract

- status: PASS
- duration: 1ms
- details (2 entries):
  1. GET /api/v1/academic/enrollments -> 200 (1ms)
  2. found enrollment for student 34

### ✅ CRMValidationAndAccessControl

- status: PASS
- duration: 17ms
- details (14 entries):
  1. POST /api/v1/crm/applications -> 403 (4ms)
  2. confirmed owner role cannot submit CRM applications (403)
  3. POST /api/v1/crm/applications -> 400 (1ms)
  4. confirmed CRM application validation rejects a missing student_id
  5. GET /api/v1/crm/applications -> 403 (1ms)
  6. confirmed parent role cannot list CRM applications (403)
  7. POST /api/v1/crm/applications -> 201 (3ms)
  8. created application 9 to exercise status validation
  9. PATCH /api/v1/crm/applications/9 -> 400 (1ms)
  10. confirmed invalid CRM application status value is rejected
  11. PATCH /api/v1/crm/applications/999999999 -> 404 (3ms)
  12. confirmed updating a nonexistent CRM application returns 404
  13. DELETE /api/v1/crm/applications/999999999 -> 404 (4ms)
  14. confirmed deleting a nonexistent CRM application returns 404

### ✅ CRMToNotificationFlow

- status: PASS
- duration: 3.01s
- details (6 entries):
  1. seeded branch_owner user.created event for user id 900000009 (branch 9)
  2. POST /api/v1/crm/applications -> 201 (3ms)
  3. GET /api/v1/notifications?unread_only=true -> 200 (1ms)
  4. waiting for notification service to receive CRM event
  5. GET /api/v1/notifications?unread_only=true -> 200 (1ms)
  6. received CRM notification new_application for branch owner 900000009

