# Load Test Report

**Run started:** 2026-07-25T01:01:55+04:00

**Run finished:** 2026-07-25T01:02:02+04:00

**Overall result:** PASS

## Configuration

- user-service: http://localhost:8081
- academic-service: http://localhost:8082
- contracts-service: http://localhost:8083
- crm-service: http://localhost:8084
- notification-service: http://localhost:8085
- nats-url: nats://localhost:4222
- jwt-secret: (hidden)
- tilda-webhook-secret: (not set - webhook signature check disabled)

## Summary

- scenarios: 23 (passed: 23, failed: 0, skipped: 0)
- HTTP requests made: 142
- total run time: 7.535s

| Scenario | Status | Duration | Requests |
|---|---|---|---|
| HealthzAndDocs | PASS | 14ms | 0 |
| AuthNegativeCases | PASS | 693ms | 9 |
| InitialSetup | PASS | 728ms | 6 |
| UserAuthenticationAndDirectory | PASS | 232ms | 5 |
| AuthorizationAndRBAC | PASS | 222ms | 7 |
| UserProfileAndDirectory | PASS | 1.554s | 12 |
| UserAdminManagement | PASS | 247ms | 17 |
| ContractsLifecycle | PASS | 7ms | 4 |
| ContractsValidationAndAccessControl | PASS | 234ms | 11 |
| ContractsCRUD | PASS | 10ms | 7 |
| ContractsPaymentStatus | PASS | 8ms | 6 |
| AcademicLessonAndAttendance | PASS | 25ms | 3 |
| AcademicValidationAndAccessControl | PASS | 230ms | 8 |
| CoursesCRUD | PASS | 7ms | 6 |
| EnrollmentsCRUD | PASS | 9ms | 6 |
| LessonsCRUD | PASS | 12ms | 6 |
| HomeworkLifecycle | PASS | 239ms | 10 |
| NotificationSettingsAndRead | PASS | 13ms | 5 |
| NotificationsAccessControl | PASS | 2ms | 3 |
| AcademicEnrollmentFromContract | PASS | 3ms | 1 |
| CRMWebhookIntake | PASS | 4ms | 0 |
| CRMValidationAndAccessControl | PASS | 11ms | 7 |
| CRMToNotificationFlow | PASS | 3.011s | 3 |

## Scenario results

### ✅ HealthzAndDocs

- status: PASS
- duration: 14ms
- details (15 entries):
  1. OK contracts-service http://localhost:8083/healthz
  2. OK contracts-service http://localhost:8083/openapi.yaml
  3. OK contracts-service http://localhost:8083/docs
  4. OK crm-service http://localhost:8084/healthz
  5. OK crm-service http://localhost:8084/openapi.yaml
  6. OK crm-service http://localhost:8084/docs
  7. OK notification-service http://localhost:8085/healthz
  8. OK notification-service http://localhost:8085/openapi.yaml
  9. OK notification-service http://localhost:8085/docs
  10. OK user-service http://localhost:8081/healthz
  11. OK user-service http://localhost:8081/openapi.yaml
  12. OK user-service http://localhost:8081/docs
  13. OK academic-service http://localhost:8082/healthz
  14. OK academic-service http://localhost:8082/openapi.yaml
  15. OK academic-service http://localhost:8082/docs

### ✅ AuthNegativeCases

- status: PASS
- duration: 693ms
- details (18 entries):
  1. POST /api/v1/auth/register -> 200 (225ms)
  2. registered baseline user parent-negative+1784926915265229300@test.local for negative auth checks
  3. POST /api/v1/auth/register -> 409 (235ms)
  4. confirmed duplicate registration returns 409
  5. POST /api/v1/auth/register -> 400 (1ms)
  6. confirmed registration validation rejects short passwords
  7. POST /api/v1/auth/register -> 400 (1ms)
  8. confirmed registration validation rejects missing name fields
  9. POST /api/v1/auth/login -> 401 (228ms)
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
- duration: 728ms
- details (12 entries):
  1. POST /api/v1/auth/register -> 200 (225ms)
  2. registered parent parent+1784926915958384500@test.local with user id 87
  3. POST /api/v1/branches -> 201 (4ms)
  4. created branch 19
  5. POST /api/v1/users/tutors -> 201 (223ms)
  6. created tutor 88
  7. POST /api/v1/academic/courses -> 201 (18ms)
  8. created course 16
  9. POST /api/v1/users/students -> 201 (236ms)
  10. created student 89 for parent 87
  11. POST /api/v1/contracts -> 201 (17ms)
  12. created contract 18 for student 89

### ✅ UserAuthenticationAndDirectory

- status: PASS
- duration: 232ms
- details (10 entries):
  1. POST /api/v1/auth/login -> 200 (222ms)
  2. parent login success for user 87
  3. POST /api/v1/auth/refresh -> 200 (3ms)
  4. refresh token returned new access token
  5. GET /api/v1/users/me -> 200 (1ms)
  6. users/me returned parent profile for id 87
  7. PATCH /api/v1/users/me -> 200 (2ms)
  8. updated parent first_name to Ирина
  9. GET /api/v1/parents/87/children -> 200 (4ms)
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
  11. POST /api/v1/auth/register -> 200 (218ms)
  12. GET /api/v1/parents/87/children -> 403 (1ms)
  13. confirmed a parent cannot view another parent's children list

### ✅ UserProfileAndDirectory

- status: PASS
- duration: 1.554s
- details (22 entries):
  1. GET /api/v1/users -> 200 (2ms)
  2. confirmed parent directory lists their own child and leaves other lists empty
  3. GET /api/v1/users?branch_id=19 -> 200 (9ms)
  4. confirmed owner directory filtered by branch_id includes the run's tutor
  5. GET /api/v1/users/89 -> 200 (1ms)
  6. confirmed owner can fetch student 89 by id
  7. GET /api/v1/users/89 -> 200 (2ms)
  8. confirmed a parent can fetch their own child by id
  9. POST /api/v1/auth/register -> 200 (223ms)
  10. GET /api/v1/users/89 -> 403 (2ms)
  11. confirmed an unrelated parent cannot fetch another parent's child by id
  12. GET /api/v1/users/999999999 -> 404 (1ms)
  13. confirmed fetching a nonexistent user id returns 404
  14. POST /api/v1/auth/register -> 200 (222ms)
  15. POST /api/v1/users/me/change-password -> 200 (438ms)
  16. changed password for user 92
  17. POST /api/v1/auth/login -> 401 (217ms)
  18. confirmed the old password no longer works after change-password
  19. POST /api/v1/auth/login -> 200 (220ms)
  20. confirmed the new password works after change-password
  21. POST /api/v1/users/me/change-password -> 400 (218ms)
  22. confirmed change-password rejects an incorrect current password

### ✅ UserAdminManagement

- status: PASS
- duration: 247ms
- details (34 entries):
  1. GET /api/v1/branches -> 200 (2ms)
  2. confirmed owner branch list includes branch 19
  3. GET /api/v1/branches -> 403 (1ms)
  4. confirmed a parent cannot list branches (403)
  5. POST /api/v1/users/students -> 201 (224ms)
  6. created disposable student 93 for admin-editing checks
  7. PATCH /api/v1/users/93 -> 200 (2ms)
  8. owner updated last_name for user 93
  9. PATCH /api/v1/users/93 -> 200 (3ms)
  10. confirmed branch_owner can edit a user in their own branch
  11. PATCH /api/v1/users/93 -> 403 (1ms)
  12. confirmed branch_owner cannot edit a user outside their branch (403)
  13. PATCH /api/v1/users/93 -> 403 (1ms)
  14. confirmed a parent cannot use the admin edit endpoint, even on their own child (403)
  15. PATCH /api/v1/users/93/status -> 200 (2ms)
  16. deactivated user 93
  17. GET /api/v1/users/93 -> 200 (1ms)
  18. confirmed user 93 is_active=false after deactivation
  19. PATCH /api/v1/users/93/status -> 200 (2ms)
  20. reactivated user 93
  21. PATCH /api/v1/users/93/status -> 403 (1ms)
  22. confirmed branch_owner cannot toggle a user's active status (403)
  23. PATCH /api/v1/tutors/88/status -> 200 (3ms)
  24. owner set tutor 88 status to vacation
  25. PATCH /api/v1/tutors/88/status -> 200 (2ms)
  26. confirmed branch_owner can set their own branch's tutor status to sick_leave
  27. PATCH /api/v1/tutors/88/status -> 403 (1ms)
  28. confirmed branch_owner cannot set a tutor status to inactive (403)
  29. PATCH /api/v1/tutors/88/status -> 400 (1ms)
  30. confirmed an invalid tutor status value is rejected
  31. PATCH /api/v1/tutors/88/status -> 403 (1ms)
  32. confirmed a parent cannot set a tutor's status (403)
  33. PATCH /api/v1/tutors/88/status -> 200 (2ms)
  34. reset tutor 88 status back to active

### ✅ ContractsLifecycle

- status: PASS
- duration: 7ms
- details (8 entries):
  1. GET /api/v1/contracts/18 -> 200 (1ms)
  2. fetched contract 18
  3. GET /api/v1/contracts?student_id=89 -> 200 (4ms)
  4. owner can see contract 18 in contract list
  5. PATCH /api/v1/contracts/18/status -> 200 (2ms)
  6. contract 18 status update request accepted
  7. GET /api/v1/contracts/18 -> 200 (1ms)
  8. contract 18 transitioned to status "completed"

### ✅ ContractsValidationAndAccessControl

- status: PASS
- duration: 234ms
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
  10. PATCH /api/v1/contracts/18/status -> 400 (1ms)
  11. confirmed invalid contract status value is rejected
  12. POST /api/v1/branches -> 201 (2ms)
  13. GET /api/v1/contracts/18/expiry -> 403 (1ms)
  14. confirmed branch_owner from another branch cannot read this contract's expiry
  15. POST /api/v1/auth/register -> 200 (222ms)
  16. GET /api/v1/contracts/18/expiry -> 403 (4ms)
  17. confirmed a parent outside the family cannot read this contract's expiry

### ✅ ContractsCRUD

- status: PASS
- duration: 10ms
- details (14 entries):
  1. POST /api/v1/contracts -> 201 (3ms)
  2. created disposable contract 19 for CRUD checks
  3. PATCH /api/v1/contracts/19 -> 200 (2ms)
  4. updated contract 19 amount to 20000
  5. GET /api/v1/contracts/19 -> 200 (1ms)
  6. confirmed contract 19 amount persisted as 20000
  7. PATCH /api/v1/contracts/19 -> 403 (1ms)
  8. confirmed parent role cannot update contract fields (403)
  9. DELETE /api/v1/contracts/19 -> 403 (1ms)
  10. confirmed parent role cannot delete contracts (403)
  11. DELETE /api/v1/contracts/19 -> 200 (2ms)
  12. deleted contract 19
  13. GET /api/v1/contracts/19 -> 404 (1ms)
  14. confirmed deleted contract 19 no longer exists (404)

### ✅ ContractsPaymentStatus

- status: PASS
- duration: 8ms
- details (12 entries):
  1. POST /api/v1/contracts -> 201 (3ms)
  2. created disposable contract 20 for payment-status checks
  3. PATCH /api/v1/contracts/20/payment-status -> 200 (2ms)
  4. marked contract 20 as paid
  5. GET /api/v1/contracts/20 -> 200 (1ms)
  6. confirmed contract 20 payment_status persisted as paid
  7. PATCH /api/v1/contracts/20/payment-status -> 400 (1ms)
  8. confirmed an invalid payment_status value is rejected
  9. PATCH /api/v1/contracts/20/payment-status -> 403 (1ms)
  10. confirmed a parent cannot update a contract's payment status (403)
  11. PATCH /api/v1/contracts/999999999/payment-status -> 404 (1ms)
  12. confirmed marking a nonexistent contract's payment status returns 404

### ✅ AcademicLessonAndAttendance

- status: PASS
- duration: 25ms
- details (6 entries):
  1. POST /api/v1/academic/lessons -> 201 (14ms)
  2. created lesson 23 for course 16
  3. POST /api/v1/academic/lessons/23/attendance -> 200 (6ms)
  4. marked attendance present for student 89 on lesson 23
  5. GET /api/v1/academic/lessons/23/attendance -> 200 (5ms)
  6. verified attendance record for student 89 on lesson 23

### ✅ AcademicValidationAndAccessControl

- status: PASS
- duration: 230ms
- details (15 entries):
  1. POST /api/v1/academic/lessons -> 400 (1ms)
  2. confirmed lesson creation validation rejects incomplete payloads
  3. POST /api/v1/academic/lessons -> 403 (1ms)
  4. confirmed parent role cannot create lessons (403)
  5. POST /api/v1/academic/lessons -> 403 (1ms)
  6. confirmed a tutor cannot create lessons on behalf of another tutor
  7. POST /api/v1/academic/lessons -> 201 (3ms)
  8. created lesson 24 to exercise attendance validation/access checks
  9. POST /api/v1/academic/lessons/24/attendance -> 400 (1ms)
  10. confirmed invalid attendance status value is rejected
  11. GET /api/v1/academic/lessons/999999999/attendance -> 404 (1ms)
  12. confirmed nonexistent lesson returns 404
  13. POST /api/v1/auth/register -> 200 (222ms)
  14. GET /api/v1/academic/lessons/24/attendance -> 403 (2ms)
  15. confirmed a parent whose child doesn't attend the lesson cannot read attendance

### ✅ CoursesCRUD

- status: PASS
- duration: 7ms
- details (12 entries):
  1. POST /api/v1/academic/courses -> 201 (1ms)
  2. created disposable course 17 for CRUD checks
  3. PATCH /api/v1/academic/courses/17 -> 200 (2ms)
  4. updated course 17 title
  5. PATCH /api/v1/academic/courses/17 -> 403 (1ms)
  6. confirmed branch_owner role cannot update courses (403)
  7. DELETE /api/v1/academic/courses/17 -> 403 (1ms)
  8. confirmed branch_owner role cannot delete courses (403)
  9. DELETE /api/v1/academic/courses/17 -> 200 (2ms)
  10. deleted course 17
  11. DELETE /api/v1/academic/courses/17 -> 404 (1ms)
  12. confirmed deleting an already-deleted course returns 404

### ✅ EnrollmentsCRUD

- status: PASS
- duration: 9ms
- details (12 entries):
  1. POST /api/v1/academic/enrollments -> 201 (2ms)
  2. created disposable enrollment 26 for CRUD checks
  3. PATCH /api/v1/academic/enrollments/26/assign-tutor -> 200 (2ms)
  4. assigned tutor 88 to enrollment 26
  5. PATCH /api/v1/academic/enrollments/26 -> 200 (3ms)
  6. updated enrollment 26 progress to 42%
  7. PATCH /api/v1/academic/enrollments/26/assign-tutor -> 403 (1ms)
  8. confirmed parent role cannot assign tutors (403)
  9. PATCH /api/v1/academic/enrollments/26 -> 403 (1ms)
  10. confirmed parent role cannot update enrollment progress (403)
  11. PATCH /api/v1/academic/enrollments/999999999/assign-tutor -> 404 (1ms)
  12. confirmed assigning a tutor to a nonexistent enrollment returns 404

### ✅ LessonsCRUD

- status: PASS
- duration: 12ms
- details (12 entries):
  1. POST /api/v1/academic/lessons -> 201 (3ms)
  2. created disposable lesson 25 for CRUD checks
  3. PATCH /api/v1/academic/lessons/25 -> 200 (2ms)
  4. updated lesson 25 topic
  5. PATCH /api/v1/academic/lessons/25 -> 403 (1ms)
  6. confirmed parent role cannot update lessons (403)
  7. DELETE /api/v1/academic/lessons/25 -> 403 (1ms)
  8. confirmed parent role cannot delete lessons (403)
  9. DELETE /api/v1/academic/lessons/25 -> 200 (3ms)
  10. deleted lesson 25
  11. DELETE /api/v1/academic/lessons/25 -> 404 (2ms)
  12. confirmed deleting an already-deleted lesson returns 404

### ✅ HomeworkLifecycle

- status: PASS
- duration: 239ms
- details (19 entries):
  1. POST /api/v1/academic/homework -> 400 (1ms)
  2. confirmed homework creation validation rejects incomplete payloads
  3. POST /api/v1/academic/homework -> 403 (1ms)
  4. confirmed parent role cannot assign homework (403)
  5. POST /api/v1/academic/homework -> 201 (5ms)
  6. tutor 88 assigned homework 5 to student 89
  7. GET /api/v1/academic/homework -> 200 (1ms)
  8. confirmed tutor sees homework 5 in their own list
  9. GET /api/v1/academic/homework -> 200 (2ms)
  10. confirmed parent sees homework 5 for their child
  11. POST /api/v1/users/students -> 201 (223ms)
  12. GET /api/v1/academic/homework/5/open -> 403 (3ms)
  13. confirmed a student cannot open another student's homework (403)
  14. GET /api/v1/academic/homework/5/open -> 302 (2ms)
  15. student 89 opened homework 5 (redirected to link)
  16. GET /api/v1/academic/homework?status=viewed -> 200 (2ms)
  17. confirmed homework 5 status flipped to "viewed" after opening
  18. GET /api/v1/academic/homework/999999999/open -> 404 (1ms)
  19. confirmed opening a nonexistent homework item returns 404

### ✅ NotificationSettingsAndRead

- status: PASS
- duration: 13ms
- details (9 entries):
  1. GET /api/v1/notifications/settings -> 200 (2ms)
  2. fetched notification settings: email=true sms=false messenger=false
  3. PATCH /api/v1/notifications/settings -> 200 (3ms)
  4. toggled sms_enabled from false to true
  5. GET /api/v1/notifications?unread_only=true -> 200 (5ms)
  6. PATCH /api/v1/notifications/164/read -> 200 (2ms)
  7. marked notification 164 as read
  8. GET /api/v1/notifications?unread_only=true -> 200 (1ms)
  9. confirmed notification 164 no longer present in unread list

### ✅ NotificationsAccessControl

- status: PASS
- duration: 2ms
- details (6 entries):
  1. GET /api/v1/notifications -> 401 (1ms)
  2. confirmed notifications endpoint rejects requests without a token
  3. GET /api/v1/notifications -> 401 (1ms)
  4. confirmed notifications endpoint rejects a malformed token
  5. PATCH /api/v1/notifications/999999999/read -> 404 (1ms)
  6. confirmed marking a nonexistent notification as read returns 404

### ✅ AcademicEnrollmentFromContract

- status: PASS
- duration: 3ms
- details (2 entries):
  1. GET /api/v1/academic/enrollments -> 200 (3ms)
  2. found enrollment for student 89

### ✅ CRMWebhookIntake

- status: PASS
- duration: 4ms
- notes:
  - TILDA_WEBHOOK_SECRET is not set - skipping the invalid-signature check (signature verification is disabled server-side under this configuration too)
- details (2 entries):
  1. tilda webhook accepted a new application
  2. confirmed the webhook rejects a payload without a name

### ✅ CRMValidationAndAccessControl

- status: PASS
- duration: 11ms
- details (14 entries):
  1. POST /api/v1/crm/applications -> 403 (2ms)
  2. confirmed owner role cannot submit CRM applications (403)
  3. POST /api/v1/crm/applications -> 400 (1ms)
  4. confirmed CRM application validation rejects a missing student_id
  5. GET /api/v1/crm/applications -> 403 (1ms)
  6. confirmed parent role cannot list CRM applications (403)
  7. POST /api/v1/crm/applications -> 201 (4ms)
  8. created application 25 to exercise status validation
  9. PATCH /api/v1/crm/applications/25 -> 400 (1ms)
  10. confirmed invalid CRM application status value is rejected
  11. PATCH /api/v1/crm/applications/999999999 -> 404 (1ms)
  12. confirmed updating a nonexistent CRM application returns 404
  13. DELETE /api/v1/crm/applications/999999999 -> 404 (1ms)
  14. confirmed deleting a nonexistent CRM application returns 404

### ✅ CRMToNotificationFlow

- status: PASS
- duration: 3.011s
- details (6 entries):
  1. seeded branch_owner user.created event for user id 900000019 (branch 19)
  2. POST /api/v1/crm/applications -> 201 (3ms)
  3. GET /api/v1/notifications?unread_only=true -> 200 (1ms)
  4. waiting for notification service to receive CRM event
  5. GET /api/v1/notifications?unread_only=true -> 200 (3ms)
  6. received CRM notification new_application for branch owner 900000019

