---
order: 2
---

# Configuration Reference

This page lists the primary environment variables used by OpsKnight and how to set them.

## Required

| Variable          | Description                   | Example                               |
| ----------------- | ----------------------------- | ------------------------------------- |
| `DATABASE_URL`    | PostgreSQL connection string  | `postgresql://user:pass@host:5432/db` |
| `NEXTAUTH_URL`    | Public URL of the application | `https://ops.yourcompany.com`         |
| `NEXTAUTH_SECRET` | Secret for session encryption | `openssl rand -base64 32`             |

> **Important:** `NEXTAUTH_URL` must match the exact base URL users will access.

## Database

| Variable            | Description       | Default        |
| ------------------- | ----------------- | -------------- |
| `POSTGRES_USER`     | Database user     | `opsknight`    |
| `POSTGRES_PASSWORD` | Database password | -              |
| `POSTGRES_DB`       | Database name     | `opsknight_db` |

These are used by Docker Compose. For Kubernetes or Helm, configure your database connection in the chart values and ensure `DATABASE_URL` points to the correct host.

## Email (SMTP)

Configure via **Settings → Notifications** in the UI, or set variables:

| Variable        | Description             |
| --------------- | ----------------------- |
| `SMTP_HOST`     | SMTP server hostname    |
| `SMTP_PORT`     | SMTP port (usually 587) |
| `SMTP_USER`     | SMTP username           |
| `SMTP_PASSWORD` | SMTP password           |
| `SMTP_FROM`     | From email address      |

## SMS (Twilio)

| Variable              | Description         |
| --------------------- | ------------------- |
| `TWILIO_ACCOUNT_SID`  | Twilio Account SID  |
| `TWILIO_AUTH_TOKEN`   | Twilio Auth Token   |
| `TWILIO_PHONE_NUMBER` | Twilio phone number |

## Push Notifications (OneSignal)

| Variable            | Description            |
| ------------------- | ---------------------- |
| `ONESIGNAL_APP_ID`  | OneSignal App ID       |
| `ONESIGNAL_API_KEY` | OneSignal REST API Key |

## AWS SNS (SMS)

| Variable                | Description    |
| ----------------------- | -------------- |
| `AWS_REGION`            | AWS region     |
| `AWS_ACCESS_KEY_ID`     | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key |

## Security

| Variable         | Description                            |
| ---------------- | -------------------------------------- |
| `ENCRYPTION_KEY` | Key for encrypting integration secrets |

See [Encryption](../security/encryption) for key rotation guidance.

## Example `.env`

```bash
# Database
DATABASE_URL=postgresql://opsknight:secure_password@localhost:5432/opsknight_db

# NextAuth
NEXTAUTH_URL=https://ops.yourcompany.com
NEXTAUTH_SECRET=your-32-char-secret-here



# Email (optional - configure via UI)
# SMTP_HOST=smtp.example.com
# SMTP_PORT=587
# SMTP_USER=user@example.com
# SMTP_PASSWORD=password
# SMTP_FROM=noreply@example.com
```

## Configuration Tips

- Use a secrets manager in production (AWS Secrets Manager, Vault, etc.).
- Keep environments isolated (dev/staging/prod) with distinct secrets.
- Rotate `NEXTAUTH_SECRET` and `ENCRYPTION_KEY` on a regular cadence.
