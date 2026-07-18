.PHONY: up down down-v build logs ps env test-user test-notification help

.DEFAULT_GOAL := help

up: ## Поднять весь backend (docker compose up --build)
	docker compose up --build

up-d: ## Поднять весь backend в фоне
	docker compose up -d --build

down: ## Остановить всё (данные в volume сохраняются)
	docker compose down

down-v: ## Остановить всё и снести volume (чистая БД)
	docker compose down -v

build: ## Пересобрать образы без запуска
	docker compose build

logs: ## Логи всех сервисов (Ctrl+C для выхода)
	docker compose logs -f

ps: ## Статус контейнеров
	docker compose ps

env: ## Создать .env из .env.example, если его ещё нет
	@test -f .env || cp .env.example .env
	@echo ".env готов — поменяйте секреты перед продакшеном"

healthz-user: ## Проверить user-service
	curl -sf http://localhost:8081/healthz && echo " user-service OK"

healthz-notifications: ## Проверить notification-service
	curl -sf http://localhost:8085/healthz && echo " notification-service OK"

test-user: ## Контрактные тесты user-service
	cd user-service && $(MAKE) test

help:
	@awk 'BEGIN {FS = ":.*##"; printf "\033[36m%-25s\033[0m %s\n", "Target", "Description"} \
	       /^[a-zA-Z_-]+:.*##/ { printf "\033[36m%-25s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
