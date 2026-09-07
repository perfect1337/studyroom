# --- Build stage ---
FROM golang:1.22-alpine AS builder

ENV CGO_ENABLED=0

WORKDIR /app
COPY go.mod go.sum* ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download
COPY . .
# go mod tidy убран намеренно (не нужен для сборки, лишний раз лезет в
# сеть на каждой сборке) и добавлены BuildKit cache-mounts — подробное
# объяснение см. в academic-service/Dockerfile.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go build -o /out/crm-service ./cmd/api

# --- Final stage ---
FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /out/crm-service /crm-service
EXPOSE 8084
ENTRYPOINT ["/crm-service"]
