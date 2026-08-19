PROJECT_DIR := $(shell pwd)
FRONTEND_DIR := $(PROJECT_DIR)\study-room-frontend
BACKEND_DIR := $(PROJECT_DIR)\study-room-backend

.PHONY: up down down-v build build-frontend build-backend logs ps help up-d healthz-full env test-user test-academic test-notification clean

.DEFAULT_GOAL := help

# ============================================================
# Docker Compose (Backend)
# ============================================================
up: ## Поднять backend (docker compose up --build)
	cd "$(BACKEND_DIR)" && docker compose up --build

up-d: ## Поднять backend в фоне (docker compose up -d --build)
	cd "$(BACKEND_DIR)" && docker compose up -d --build

up-prod: ## Поднять production stack (docker compose -f docker-compose.prod.yml)
	cd "$(BACKEND_DIR)" && docker compose -f docker-compose.prod.yml up -d --build

up-prod-d: ## Поднять production stack в фоне
	cd "$(BACKEND_DIR)" && docker compose -f docker-compose.prod.yml up -d --build

down: ## Остановить backend (данные сохраняются)
	cd "$(BACKEND_DIR)" && docker compose down

down-v: ## Остановить backend и снести volumes (чистая БД)
	cd "$(BACKEND_DIR)" && docker compose down -v

down-prod: ## Остановить production stack
	cd "$(BACKEND_DIR)" && docker compose -f docker-compose.prod.yml down

down-prod-v: ## Остановить production stack и снести volumes
	cd "$(BACKEND_DIR)" && docker compose -f docker-compose.prod.yml down -v

build: ## Пересобрать образы без запуска
	cd "$(BACKEND_DIR)" && docker compose build

build-frontend: ## Собрать фронтенд (npm run build)
	cd "$(FRONTEND_DIR)" && npm install && npm run build

build-backend: ## Собрать backend образы
	cd "$(BACKEND_DIR)" && docker compose build

# ============================================================
# Logs & Status
# ============================================================
logs: ## Логи всех сервисов (Ctrl+C для выхода)
	cd "$(BACKEND_DIR)" && docker compose logs -f

logs-frontend: ## Логи nginx
	cd "$(BACKEND_DIR)" && docker compose logs -f nginx

ps: ## Статус контейнеров
	cd "$(BACKEND_DIR)" && docker compose ps

# ============================================================
# Health Checks
# ============================================================
healthz: ## Проверить все backend сервисы
	cd "$(BACKEND_DIR)" && docker compose exec user-service wget -qO- http://localhost:8081/healthz && echo " user-service OK"
	cd "$(BACKEND_DIR)" && docker compose exec academic-service wget -qO- http://localhost:8082/healthz && echo " academic-service OK"
	cd "$(BACKEND_DIR)" && docker compose exec contracts-service wget -qO- http://localhost:8083/healthz && echo " contracts-service OK"
	cd "$(BACKEND_DIR)" && docker compose exec crm-service wget -qO- http://localhost:8084/healthz && echo " crm-service OK"
	cd "$(BACKEND_DIR)" && docker compose exec notification-service wget -qO- http://localhost:8085/healthz && echo " notification-service OK"

healthz-full: ## Проверить nginx healthz
	curl -sf http://localhost/healthz && echo " nginx OK"

healthz-user: ## Проверить user-service
	curl -sf http://localhost:8081/healthz && echo " user-service OK"

healthz-notifications: ## Проверить notification-service
	curl -sf http://localhost:8085/healthz && echo " notification-service OK"

healthz-academic: ## Проверить academic-service
	curl -sf http://localhost:8082/healthz && echo " academic-service OK"

# ============================================================
# Environment Setup
# ============================================================
env: ## Создать .env из .env.example, если его ещё нет
	@if not exist $(BACKEND_DIR)\.env ( copy $(BACKEND_DIR)\.env.example $(BACKEND_DIR)\.env >nul && echo .env created ) else ( echo .env already exists )

env-dev: ## Создать .env для dev
	@if not exist $(BACKEND_DIR)\.env ( copy $(BACKEND_DIR)\.env.example $(BACKEND_DIR)\.env >nul && echo .env created ) else ( echo .env already exists )

env-prod: ## Создать .env.prod
	@if not exist $(BACKEND_DIR)\.env.prod ( copy $(BACKEND_DIR)\.env.example $(BACKEND_DIR)\.env.prod >nul && echo .env.prod created ) else ( echo .env.prod already exists )

# ============================================================
# Tests
# ============================================================
test-user: ## Контрактные тесты user-service
	cd "$(BACKEND_DIR)\user-service" && make test

test-academic: ## Контрактные тесты academic-service
	cd "$(BACKEND_DIR)\academic-service" && make test

test-notification: ## Контрактные тесты notification-service
	cd "$(BACKEND_DIR)\notification-service" && make test

test-load: ## Запустить load/integration тесты
	cd "$(BACKEND_DIR)\tests\load" && go test -v ./...

# ============================================================
# Frontend
# ============================================================
frontend-dev: ## Запустить frontend dev server
	cd "$(FRONTEND_DIR)" && npm run dev

frontend-build: ## Собрать frontend static
	cd "$(FRONTEND_DIR)" && npm run build

# ============================================================
# Utility
# ============================================================
clean: ## Очистить Docker-образы и volumes
	cd "$(BACKEND_DIR)" && docker compose down -v
	docker system prune -f

help:
	@awk 'BEGIN {FS = ":.*##"; printf "\033[36m%-25s\033[0m %s\n", "Target", "Description"} \
	       /^[a-zA-Z_-]+:.*##/ { printf "\033[36m%-25s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
