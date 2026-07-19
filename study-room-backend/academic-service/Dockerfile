# --- Build stage ---
FROM golang:1.22-alpine AS builder

ENV CGO_ENABLED=0

WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN go mod tidy && go build -o /out/academic-service ./cmd/api

# --- Final stage ---
FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /out/academic-service /academic-service
EXPOSE 8082
ENTRYPOINT ["/academic-service"]
