# --- Build stage ---
FROM golang:1.22-alpine AS builder

ENV CGO_ENABLED=0

WORKDIR /app
COPY go.mod go.sum* ./
# Кэш модулей на именованном BuildKit-кэше — go.mod/go.sum редко меняются,
# так что этот слой почти всегда попадает в обычный Docker-кэш и не
# перекачивает модули заново; кэш-mount тут просто ускоряет холодный кейс
# (первая сборка / после `docker builder prune`).
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download
COPY . .
# Раньше здесь был `go mod tidy && go build`. go mod tidy лишний на этапе
# сборки образа — он не нужен для компиляции (go.sum уже проверен на шаге
# download), а только на каждой сборке заново пересчитывает граф зависимостей
# и трогает сеть, замедляя билд. go mod tidy должен запускаться разработчиком
# локально перед коммитом, а не при каждой сборке контейнера.
#
# Кэш-mounts на /go/pkg/mod и /root/.cache/go-build — вот что реально убирает
# долгую пересборку: без них компилятору приходится каждый docker build
# заново собирать стандартную библиотеку и все зависимости с нуля, потому что
# слой этого RUN пересоздаётся при любом изменении исходников (см. COPY . .
# выше). С кэш-mount'ами пересобираются только изменившиеся пакеты — кэш
# живёт отдельно от слоёв образа и переживает `docker build`, пока не
# почистить его явно (`docker builder prune`).
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build -o /out/academic-service ./cmd/api

# --- Final stage ---
FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /out/academic-service /academic-service
EXPOSE 8082
ENTRYPOINT ["/academic-service"]
