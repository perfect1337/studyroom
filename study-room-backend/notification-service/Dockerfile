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
COPY --from=builder /out/notification-service /notification-service
EXPOSE 8085
ENTRYPOINT ["/notification-service"]
