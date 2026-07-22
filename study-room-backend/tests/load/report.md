# Load Test Report

**Run started:** 2026-07-22T20:44:57+04:00

**Run finished:** 2026-07-22T20:45:01+04:00

**Overall result:** FAIL

## Configuration

- user-service: http://localhost:8081
- academic-service: http://localhost:8082
- contracts-service: http://localhost:8083
- crm-service: http://localhost:8084
- notification-service: http://localhost:8085
- nats-url: nats://localhost:4222
- jwt-secret: (default placeholder)

## Scenario results

### HealthzAndDocs

- status: PASS
- duration: 63.9834ms
- details:
  - OK contracts-service http://localhost:8083/healthz
  - OK contracts-service http://localhost:8083/openapi.yaml
  - OK contracts-service http://localhost:8083/docs
  - OK crm-service http://localhost:8084/healthz
  - OK crm-service http://localhost:8084/openapi.yaml
  - OK crm-service http://localhost:8084/docs
  - OK notification-service http://localhost:8085/healthz
  - OK notification-service http://localhost:8085/openapi.yaml
  - OK notification-service http://localhost:8085/docs
  - OK user-service http://localhost:8081/healthz
  - OK user-service http://localhost:8081/openapi.yaml
  - OK user-service http://localhost:8081/docs
  - OK academic-service http://localhost:8082/healthz
  - OK academic-service http://localhost:8082/openapi.yaml
  - OK academic-service http://localhost:8082/docs

### InitialSetup

- status: PASS
- duration: 1.2377595s
- details:
  - registered parent parent+1784738697209386400@test.local with user id 3
  - created branch 2
  - created course 2
  - created student 4 for parent 3
  - created contract 2 for student 4

### UserAuthenticationAndDirectory

- status: PASS
- duration: 567.0261ms
- details:
  - parent login success for user 3
  - refresh token returned new access token
  - users/me returned parent profile for id 3
  - updated parent first_name to Ирина
  - parent has 1 child(ren)

### ContractsLifecycle

- status: FAIL
- duration: 11.8772ms
- details:
  - fetched contract 2

### AcademicLessonAndAttendance

- status: FAIL
- duration: 7.3161ms

### NotificationSettingsAndRead

- status: PASS
- duration: 39.7881ms
- details:
  - fetched notification settings: email=true sms=false messenger=false
  - toggled sms_enabled from false to true
  - marked notification 5 as read
  - confirmed notification 5 no longer present in unread list

### AcademicEnrollmentFromContract

- status: PASS
- duration: 13.3123ms
- details:
  - found enrollment for student 4

### CRMToNotificationFlow

- status: PASS
- duration: 2.0401021s
- details:
  - seeded owner user.created event for user id 9999
  - received CRM notification new_application for owner 9999

