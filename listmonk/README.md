# Listmonk on Cloud Run (Zero-Cost Embedded Architecture)

Listmonk is a self-hosted newsletter, transactional email, and SMS campaign manager.

This deployment runs Listmonk on Google Cloud Run with **0đ Cloud SQL cost** by co-locating an embedded PostgreSQL 17 instance inside the container and continuously synchronizing state with Google Cloud Storage (`gs://${BUCKET_NAME}/listmonk-db.dump`).

## Architecture

- **Runtime**: Google Cloud Run (scale-to-zero when idle, min instances: 0, max instances: 1)
- **Container**: `alpine:3.21` running `listmonk v6.2.0` + embedded `postgresql17`
- **Persistence**: Automated `pg_dump` and `pg_restore` against GCS bucket via Cloud Run Service Account
- **Port**: `8080`

## SMS Configuration in Listmonk

Listmonk supports SMS via **Postback (HTTP) Messengers**:

1. Navigate to **Settings** -> **Messengers** in the Listmonk dashboard.
2. Add a new messenger with provider **Postback**.
3. Configure the webhook endpoint (e.g. Twilio, Termii, or custom HTTP SMS gateway).
4. For transactional SMS, call:
   ```bash
   curl -X POST https://<LISTMONK_URL>/api/tx \
     -u "admin:adminpassword" \
     -H "Content-Type: application/json" \
     -d '{
       "subscriber_email": "user@example.com",
       "template_id": 1,
       "data": {"otp": "123456"}
     }'
   ```

## Local Development & Docker Build

```bash
docker build -t listmonk:local -f listmonk/Dockerfile listmonk
docker run -p 8080:8080 listmonk:local
```
