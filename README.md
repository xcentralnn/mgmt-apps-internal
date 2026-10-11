# mgmt-apps-internal

Kiến trúc triển khai n8n và SearXNG siêu nhẹ trên Google Cloud Run Gen2, đồng bộ toàn bộ tham số môi trường và cấu hình AI từ repo devops-platform.

## Kiến trúc hệ thống

- **n8n Core**: Cloud Run Gen2 (1 vCPU, 2Gi RAM, autoscaling 0 to 1 instance)
- **Lưu trữ dữ liệu**: Cloud Storage FUSE bucket mount trực tiếp vào thư mục `/home/node/.n8n`, giúp lưu trữ SQLite an toàn, không tốn chi phí database server riêng
- **AI Web Search**: SearXNG chạy độc lập trên Cloud Run (0.5 vCPU, 512Mi RAM)
- **AI Model**: Tích hợp Google Gemini qua OpenAI-compatible API endpoint của Google AI Studio

| Thành phần | Image / Phiên bản | CPU | Memory | Scaling |
|---|---|---|---|---|
| n8n | `n8nio/n8n:2.42.6` | 1 vCPU | 2Gi | 0 - 1 instance |
| SearXNG | `searxng/searxng:2026.10.9-f4822b3fc` | 0.5 vCPU | 512Mi | 0 - 2 instances |
| Persistence | Cloud Storage (GCS) FUSE | n/a | n/a | gs://${PROJECT_ID}-n8n-data |

## Cấu hình môi trường đã đồng bộ từ devops-platform

- `GENERIC_TIMEZONE`: Asia/Ho_Chi_Minh
- `EXECUTIONS_MODE`: regular
- `EXECUTIONS_DATA_PRUNE`: true (lưu tối đa 168 giờ)
- `N8N_PAYLOAD_SIZE_MAX`: 50MB
- `N8N_UNVERIFIED_PACKAGES_ENABLED`: true
- `N8N_RUNNERS_TASK_TIMEOUT`: 300
- `N8N_COMPRESSION_NODE_MAX_DECOMPRESSED_SIZE_BYTES`: 2147483648
- `N8N_COMPRESSION_NODE_MAX_ZIP_ENTRIES`: 5000
- `N8N_INSTANCE_AI_MODEL`: gemini-3.7-flash
- `N8N_INSTANCE_AI_MODEL_URL`: https://generativelanguage.googleapis.com/v1beta/openai/

## Hướng dẫn triển khai

### Bước 1: Xác thực GCP trong WSL

Chạy lệnh xác thực tài khoản Google Cloud:

```bash
gcloud auth login
gcloud auth application-default login
```

Hoặc nếu dùng Access Token:

```bash
gcloud config set auth/access_token_file /path/to/token
```

### Bước 2: Tạo project mgmt-apps và kích hoạt API

```bash
chmod +x scripts/*.sh
./scripts/create-project.sh mgmt-apps
```

### Bước 3: Triển khai n8n và SearXNG

```bash
export GEMINI_API_KEY="your-gemini-api-key"
export REGION="asia-southeast1"
./scripts/deploy-all.sh
```
