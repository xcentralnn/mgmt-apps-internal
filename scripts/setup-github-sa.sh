#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${1:-$(gcloud config get-value project 2>/dev/null)}"
SA_NAME="github-actions-deployer"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "Creating Service Account: ${SA_NAME} in project ${PROJECT_ID}"
if ! gcloud iam service-accounts describe "${SA_EMAIL}" --project="${PROJECT_ID}" >/dev/null 2>&1
then
  gcloud iam service-accounts create "${SA_NAME}" \
    --project="${PROJECT_ID}" \
    --display-name="GitHub Actions Deployer"
fi

ROLES=(
  "roles/run.admin"
  "roles/storage.admin"
  "roles/cloudbuild.builds.editor"
  "roles/iam.serviceAccountUser"
  "roles/artifactregistry.writer"
  "roles/resourcemanager.projectViewer"
)

for ROLE in "${ROLES[@]}"
do
  echo "Assigning role: ${ROLE}"
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${ROLE}"
done

KEY_FILE="gcp-sa-key.json"
echo "Creating credentials key at ${KEY_FILE}..."
gcloud iam service-accounts keys create "${KEY_FILE}" \
  --iam-account="${SA_EMAIL}" \
  --project="${PROJECT_ID}"

echo "Service account key saved to ${KEY_FILE}"
echo "Add content of ${KEY_FILE} to GitHub Secrets as GCP_SA_KEY"
