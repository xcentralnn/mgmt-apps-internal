FROM searxng/searxng:2026.10.9-f4822b3fc

COPY settings.yml /etc/searxng/settings.yml
COPY limiter.toml /etc/searxng/limiter.toml

ENV SEARXNG_BASE_URL="http://localhost:8080"
ENV SEARXNG_LIMITER="false"
ENV PORT=8080

EXPOSE 8080
