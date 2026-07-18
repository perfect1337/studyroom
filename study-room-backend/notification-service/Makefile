.PHONY: test clean build dev prod build-docker help run-docker

.DEFAULT_GOAL := help

test: ## Запустить контрактные тесты (нужен TEST_DATABASE_URL или postgres-notifications на 5434)
	go test -v ./tests/contracts/...

clean: ## Очистить результаты тестов
	rm -rf tests/contracts/results

build: ## Собрать бинарник notification-service
	go build -o notification-service ./cmd/api

dev: ## Запустить в режиме разработки
	go run ./cmd/api

prod: ## Запустить продакшен через docker compose
	docker compose up -d

build-docker: ## Собрать Docker-образ
	docker build -t notification-service .

run-docker: ## Запустить Docker-образ
	docker run -p 8085:8085 notification-service

help:
	@awk 'BEGIN {FS = ":.*##"; printf "\033[36m%-20s\033[0m %s\n", "Target", "Description"} \
	       /^[a-zA-Z_-]+:.*##/ { printf "\033[36m%-20s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
