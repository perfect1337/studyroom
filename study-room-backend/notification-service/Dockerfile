# --- Build stage ---
FROM golang:1.22-alpine AS builder

ENV CGO_ENABLED=0

WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN go mod tidy && go build -o /out/notification-service ./cmd/api

# --- Final stage ---
FROM alpine:3.19
RUN apk add --no-cache ca-certificates

# Добавляем корневой и промежуточный сертификаты Минцифры России,
# т.к. platform-api2.max.ru (MAX Bot API) использует "Russian Trusted CA",
# который не входит в стандартный набор доверенных сертификатов.
# Файлы .cer нужно предварительно скачать вручную в папку ./certs рядом
# с этим Dockerfile.
# ВАЖНО: файлы должны лежать прямо в /usr/local/share/ca-certificates/,
# БЕЗ вложенной подпапки — update-ca-certificates в Alpine не всегда
# обходит вложенные директории рекурсивно.
COPY certs/russian_trusted_root_ca.cer /usr/local/share/ca-certificates/russian_trusted_root_ca.crt
COPY certs/russian_trusted_sub_ca.cer /usr/local/share/ca-certificates/russian_trusted_sub_ca.crt
RUN ls -la /usr/local/share/ca-certificates/ \
    && wc -l /usr/local/share/ca-certificates/*.crt \
    && update-ca-certificates -v -f

COPY --from=builder /out/notification-service /notification-service
EXPOSE 8085
ENTRYPOINT ["/notification-service"]
