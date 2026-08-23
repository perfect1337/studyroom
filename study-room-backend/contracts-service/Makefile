.PHONY: test test-unit clean build dev prod build-docker help run-docker

.DEFAULT_GOAL := help

test: ## Запустить контрактные тесты (нужен TEST_DATABASE_URL или postgres-contracts на 5437)
	go test -v ./tests/contracts/...

test-unit: ## Юнит-тесты auth/middleware, без БД
	go test -v ./internal/auth/... ./internal/middleware/...

clean: ## Очистить результаты тестов
	rm -rf tests/contracts/results

build: ## Собрать бинарник contracts-service
	go build -o contracts-service ./cmd/api

dev: ## Запустить в режиме разработки
	go run ./cmd/api

prod: ## Запустить продакшен через docker compose
	docker compose up -d

build-docker: ## Собрать Docker-образ
	docker build -t contracts-service .

run-docker: ## Запустить Docker-образ
	docker run -p 8083:8083 contracts-service

help:
	@awk 'BEGIN {FS = ":.*##"; printf "\033[36m%-20s\033[0m %s\n", "Target", "Description"} \
	       /^[a-zA-Z_-]+:.*##/ { printf "\033[36m%-20s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
