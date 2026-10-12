FROM listmonk/listmonk:v6.2.0 AS listmonk_bin

FROM alpine:3.21

RUN apk add --no-cache \
    postgresql17 \
    postgresql17-client \
    postgresql17-contrib \
    nodejs \
    ca-certificates \
    tzdata \
    tar

COPY --from=listmonk_bin /listmonk /listmonk

WORKDIR /listmonk

COPY config.toml /listmonk/config.toml
COPY sync.js /listmonk/sync.js

RUN mkdir -p /var/lib/postgresql/data /run/postgresql /listmonk/uploads && \
    chown -R postgres:postgres /var/lib/postgresql /run/postgresql

EXPOSE 8080

ENTRYPOINT ["node", "/listmonk/sync.js"]
