FROM golang:1.24-alpine AS builder

WORKDIR /app
COPY go.mod ./
COPY main.go index.html ./

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o sms-mock .

FROM alpine:3.21

RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app
COPY --from=builder /app/sms-mock /app/sms-mock

EXPOSE 8080

ENTRYPOINT ["/app/sms-mock"]
