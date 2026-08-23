.PHONY: test clean build dev prod build-docker help run-docker

.DEFAULT_GOAL := help

test: ## Запустить контрактные тесты (нужен TEST_DATABASE_URL или postgres-crm на 5436)
	go test -v ./tests/contracts/...

clean: ## Очистить результаты тестов
	rm -rf tests/contracts/results

build: ## Собрать бинарник crm-service
	go build -o crm-service ./cmd/api

dev: ## Запустить в режиме разработки
	go run ./cmd/api

prod: ## Запустить продакшен через docker compose
	docker compose up -d

build-docker: ## Собрать Docker-образ
	docker build -t crm-service .

run-docker: ## Запустить Docker-образ
	docker run -p 8084:8084 crm-service

help:
	@awk 'BEGIN {FS = ":.*##"; printf "\033[36m%-20s\033[0m %s\n", "Target", "Description"} \
	       /^[a-zA-Z_-]+:.*##/ { printf "\033[36m%-20s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
