#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="${1:-mgmt-apps}"
RANDOM_SUFFIX=$(head /dev/urandom | tr -dc a-z0-9 | head -c 6)
PROJECT_ID="${PROJECT_NAME}-${RANDOM_SUFFIX}"
REGION="${REGION:-asia-southeast1}"

echo "Creating GCP Project..."
echo "Project Name: ${PROJECT_NAME}"
echo "Project ID: ${PROJECT_ID}"

gcloud projects create "${PROJECT_ID}" --name="${PROJECT_NAME}"
gcloud config set project "${PROJECT_ID}"

BILLING_ACCOUNT=$(gcloud billing accounts list --format="value(name)" --filter="open=true" 2>/dev/null | head -n 1 || true)
if [ -n "${BILLING_ACCOUNT}" ]
then
  echo "Linking billing account: ${BILLING_ACCOUNT}"
  gcloud billing projects link "${PROJECT_ID}" --billing-account="${BILLING_ACCOUNT}"
else
  echo "Warning: No open billing account detected. Please link a billing account manually."
fi

echo "Enabling necessary APIs..."
gcloud services enable \
  run.googleapis.com \
  storage.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com

echo "Setup completed successfully."
echo "Active Project: ${PROJECT_ID}"
