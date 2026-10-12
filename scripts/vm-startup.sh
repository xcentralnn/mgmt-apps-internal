#!/usr/bin/env bash
set -euo pipefail

echo "=== 1. Setup 2GB Swap ==="
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "=== 2. Install Docker & Cloudflared ==="
apt-get update -y
apt-get install -y ca-certificates curl gnupg lsb-release docker.io docker-compose-v2

systemctl enable --now docke

# Install cloudflared
curl -L --output /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
dpkg -i /tmp/cloudflared.deb || true

echo "=== 3. Setup n8n directory & restore backup ==="
mkdir -p /opt/n8n/data
chown -R 1000:1000 /opt/n8n/data

# Restore backup from GCS
if command -v gcloud &>/dev/null; then
  if gcloud storage cp gs://mgmt-apps-n8n-data/n8n-backup.tar.gz /tmp/n8n-backup.tar.gz; then
    tar -xzf /tmp/n8n-backup.tar.gz -C /opt/n8n/data
    chown -R 1000:1000 /opt/n8n/data
    echo "Restored n8n backup from GCS successfully"
  fi
fi

echo "=== 4. Launch n8n Docker ==="
cat << 'EOF' > /opt/n8n/docker-compose.yml
services:
  n8n:
    image: docker.n8n.io/n8nio/n8n:2.43.3
    container_name: n8n
    restart: always
    ports:
      - "127.0.0.1:5678:5678"
    environment:
      - N8N_PORT=5678
      - N8N_HOST=n8n.curator.io.vn
      - N8N_PROTOCOL=https
      - WEBHOOK_URL=https://n8n.curator.io.vn/
      - N8N_WEBHOOK_URL=https://n8n.curator.io.vn/
      - N8N_EDITOR_BASE_URL=https://n8n.curator.io.vn/
      - GENERIC_TIMEZONE=Asia/Ho_Chi_Minh
      - EXECUTIONS_DATA_PRUNE=true
      - EXECUTIONS_DATA_MAX_AGE=168
      - N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=false
    volumes:
      - /opt/n8n/data:/home/node/.n8n
EOF

cd /opt/n8n
docker compose up -d

echo "=== Setup completed ==="
