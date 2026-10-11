#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-asia-southeast1}"
BUCKET_NAME="${BUCKET_NAME:-${PROJECT_ID}-n8n-data}"
GEMINI_API_KEY="${GEMINI_API_KEY:-}"

if [ -z "${PROJECT_ID}" ]
then
  echo "Error: PROJECT_ID is not set."
  exit 1
fi

echo "Deploying to Project: ${PROJECT_ID} in Region: ${REGION}"

echo "Step 1: Creating GCS bucket for n8n persistent storage..."
if ! gcloud storage buckets describe "gs://${BUCKET_NAME}" >/dev/null 2>&1
then
  gcloud storage buckets create "gs://${BUCKET_NAME}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --uniform-bucket-level-access
fi

PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")
COMPUTE_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "Step 2: Granting storage permissions to service account ${COMPUTE_SA}..."
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET_NAME}" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/storage.objectAdmin"

echo "Step 3: Building and deploying SearXNG..."
SEARXNG_SECRET=$(head /dev/urandom | tr -dc a-z0-9 | head -c 32)
gcloud builds submit --tag="gcr.io/${PROJECT_ID}/searxng:latest" ./searxng

gcloud run deploy searxng \
  --image="gcr.io/${PROJECT_ID}/searxng:latest" \
  --region="${REGION}" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=512Mi \
  --cpu=0.5 \
  --min-instances=0 \
  --max-instances=2 \
  --set-env-vars="SEARXNG_LIMITER=false,SEARXNG_SECRET=${SEARXNG_SECRET}"

SEARXNG_URL=$(gcloud run services describe searxng --region="${REGION}" --format="value(status.url)")
echo "SearXNG deployed at: ${SEARXNG_URL}"

echo "Step 4: Deploying n8n to Cloud Run Gen2..."
gcloud run deploy n8n \
  --image="n8nio/n8n:2.42.6" \
  --region="${REGION}" \
  --platform=managed \
  --allow-unauthenticated \
  --execution-environment=gen2 \
  --add-volume="name=n8n-storage,type=cloud-storage,bucket=${BUCKET_NAME}" \
  --add-volume-mount="volume=n8n-storage,mount-path=/home/node/.n8n" \
  --port=8080 \
  --cpu=1 \
  --memory=2Gi \
  --min-instances=0 \
  --max-instances=1 \
  --timeout=3600 \
  --set-env-vars="N8N_PORT=8080,N8N_PROTOCOL=https,GENERIC_TIMEZONE=Asia/Ho_Chi_Minh,EXECUTIONS_MODE=regular,EXECUTIONS_DATA_PRUNE=true,EXECUTIONS_DATA_MAX_AGE=168,N8N_PAYLOAD_SIZE_MAX=50,N8N_UNVERIFIED_PACKAGES_ENABLED=true,N8N_RUNNERS_TASK_TIMEOUT=300,N8N_COMPRESSION_NODE_MAX_DECOMPRESSED_SIZE_BYTES=2147483648,N8N_COMPRESSION_NODE_MAX_ZIP_ENTRIES=5000,N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true,N8N_INSTANCE_AI_MODEL=gemini-3.7-flash,N8N_INSTANCE_AI_MODEL_URL=https://generativelanguage.googleapis.com/v1beta/openai/,N8N_INSTANCE_AI_MODEL_API_KEY=${GEMINI_API_KEY},N8N_INSTANCE_AI_SEARXNG_URL=${SEARXNG_URL}"

N8N_URL=$(gcloud run services describe n8n --region="${REGION}" --format="value(status.url)")
echo "Updating n8n Webhook and Editor URL with ${N8N_URL}..."
gcloud run services update n8n \
  --region="${REGION}" \
  --update-env-vars="WEBHOOK_URL=${N8N_URL},N8N_EDITOR_BASE_URL=${N8N_URL}"

echo "Deployment finished successfully."
echo "n8n URL: ${N8N_URL}"
echo "SearXNG URL: ${SEARXNG_URL}"
