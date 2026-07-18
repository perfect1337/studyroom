.PHONY: test clean build dev prod build-docker help run-docker

.DEFAULT_GOAL := help

test: ## Запустить контрактные тесты
	go test -v ./tests/contracts/...

clean: ## Очистить результаты тестов
	rm -rf tests/contracts/results

build: ## Собрать бинарник user-service
	go build -o user-service ./cmd/user-service/main.go

dev: ## Запустить в режиме разработки
	go run ./cmd/user-service/main.go

prod: ## Запустить продакшен через docker compose
	docker compose up -d

build-docker: ## Собрать Docker-образ
	docker build -t user-service .

run-docker: ## Запустить Docker-образ
	docker run -p 8080:8080 user-service

help:
	@awk 'BEGIN {FS = ":.*##"; printf "\033[36m%-20s\033[0m %s\n", "Target", "Description"} \
	       /^[a-zA-Z_-]+:.*##/ { printf "\033[36m%-20s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)