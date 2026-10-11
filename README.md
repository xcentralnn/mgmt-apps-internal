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

## CI/CD Pipeline (GitHub Actions)

Pipeline tự động kích hoạt khi push code vào nhánh `main` hoặc chạy thủ công qua workflow dispatch:

Workflow file: `.github/workflows/deploy.yml`

### Cấu hình Secrets và Variables trên GitHub Repository

1. **Repository Secrets** (Settings -> Secrets and variables -> Actions):
   - `GCP_SA_KEY`: Nội dung file Service Account JSON (tạo bằng script `scripts/setup-github-sa.sh`)
   - `GEMINI_API_KEY`: API Key của Gemini
2. **Repository Variables**:
   - `GCP_PROJECT_ID`: ID của GCP Project (`mgmt-apps` hoặc mã project)
   - `GCP_REGION`: Region triển khai (mặc định: `asia-southeast1`)

### Tạo Service Account cho GitHub Actions trên GCP

```bash
chmod +x scripts/*.sh
./scripts/setup-github-sa.sh <PROJECT_ID>
```

Script sẽ tự động phân quyền các roles cần thiết và xuất ra file `gcp-sa-key.json` để bạn dán vào secret `GCP_SA_KEY`.
