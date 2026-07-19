.PHONY: test clean build dev prod build-docker help run-docker

.DEFAULT_GOAL := help

test: ## Запустить контрактные тесты (нужен TEST_DATABASE_URL или postgres-academic на 5435)
	go test -v ./tests/contracts/...

test-unit: ## Юнит-тесты без БД (auth, middleware)
	go test -v ./internal/auth/... ./internal/middleware/...

clean: ## Очистить результаты тестов
	rm -rf tests/contracts/results

build: ## Собрать бинарник academic-service
	go build -o academic-service ./cmd/api

dev: ## Запустить в режиме разработки
	go run ./cmd/api

prod: ## Запустить продакшен через docker compose
	docker compose up -d

build-docker: ## Собрать Docker-образ
	docker build -t academic-service .

run-docker: ## Запустить Docker-образ
	docker run -p 8082:8082 academic-service

help:
	@awk 'BEGIN {FS = ":.*##"; printf "\033[36m%-20s\033[0m %s\n", "Target", "Description"} \
	       /^[a-zA-Z_-]+:.*##/ { printf "\033[36m%-20s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
