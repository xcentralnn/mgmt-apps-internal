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

echo "Step 1: Ensuring GCS bucket for n8n backups exists..."
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

echo "Step 4: n8n is running on GCE e2-micro Always Free VM (n8n-free-tier) via Cloudflare Tunnel."
echo "Deployment finished successfully."
echo "SearXNG URL: ${SEARXNG_URL}"


