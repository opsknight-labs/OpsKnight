---
order: 2
title: Configuration Reference
description: All environment variables used by OpsKnight with descriptions, examples, and generation instructions
---

# Configuration Reference

This page is the complete reference for all environment variables used by OpsKnight. Copy `env.example` to `.env` and fill in the values appropriate for your environment.

```bash
cp env.example .env
```

---

## Required Variables

These variables must be set for OpsKnight to start correctly in any environment.

| Variable          | Description                                    | Example / How to Generate             |
| ----------------- | ---------------------------------------------- | ------------------------------------- |
| `DATABASE_URL`    | PostgreSQL connection string                   | `postgresql://user:pass@host:5432/db` |
| `NEXTAUTH_URL`    | Public-facing URL of the application           | `https://ops.yourcompany.com`         |
| `NEXTAUTH_SECRET` | Secret used to sign and encrypt session tokens | `openssl rand -base64 32`             |

> **`NEXTAUTH_URL`** must match the exact base URL your users will access, including the scheme (`https://`). Mismatches cause OAuth callback failures.

---

## Security & Encryption

| Variable         | Required in Production | Description                                                                                      |
| ---------------- | :--------------------: | ------------------------------------------------------------------------------------------------ |
| `ENCRYPTION_KEY` |        **Yes**         | 32-byte hex master key (64 hex chars) used to encrypt integration secrets (SSO, Slack, API keys) |

### Generating the Encryption Key

```bash
openssl rand -hex 32
```

This produces a 64-character hex string. Set it in your environment:

```bash
ENCRYPTION_KEY=a3f1c2e4b5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2
```

**Development note:** When `NODE_ENV=development` and `ENCRYPTION_KEY` is not set, a safe static fallback key is used automatically — no local configuration is required. This fallback is **not suitable for production**.

See [Encryption](../security/encryption) for key rotation, migration guidance, and security considerations.

---

## Authentication

| Variable          | Required | Description                                   | Generate With             |
| ----------------- | :------: | --------------------------------------------- | ------------------------- |
| `NEXTAUTH_SECRET` |   Yes    | Secret for signing session JWTs               | `openssl rand -base64 32` |
| `NEXTAUTH_URL`    |   Yes    | Base URL for OAuth callbacks and redirects    | Your public domain        |
| `ENCRYPTION_KEY`  |  Yes\*   | Master key for encrypting integration secrets | `openssl rand -hex 32`    |

\*Required in production; auto-fallback available in development.

---

## Database

| Variable            | Required | Description                  | Default        |
| ------------------- | :------: | ---------------------------- | -------------- |
| `DATABASE_URL`      |   Yes    | PostgreSQL connection string | —              |
| `POSTGRES_USER`     |    No    | Database username (Docker)   | `opsknight`    |
| `POSTGRES_PASSWORD` |    No    | Database password (Docker)   | —              |
| `POSTGRES_DB`       |    No    | Database name (Docker)       | `opsknight_db` |

`POSTGRES_*` variables are used by Docker Compose to initialise the database container. For Kubernetes or Helm deployments, configure your database separately and set `DATABASE_URL` directly.

**Recommended connection string options for production:**

```bash
DATABASE_URL=postgresql://opsknight:password@host:5432/opsknight_db?sslmode=require&connection_limit=40&pool_timeout=30
```

| Option             | Recommended Value | Purpose                         |
| ------------------ | ----------------- | ------------------------------- |
| `sslmode`          | `require`         | Enforce encrypted connections   |
| `connection_limit` | `40`              | Max connections per process     |
| `pool_timeout`     | `30`              | Seconds to wait for a free slot |

---

## Application URL

| Variable              | Required | Description                                                   |
| --------------------- | :------: | ------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL` |   Yes    | Public URL used in emails, webhooks, RSS feeds, and client JS |

This should match `NEXTAUTH_URL` in most deployments. It is exposed to the browser (hence `NEXT_PUBLIC_`), so it must be the external URL, not an internal container address.

---

## Email / SMTP

Configure SMTP credentials via **Settings → Notifications** in the UI, or supply them as environment variables:

| Variable        | Description                     |
| --------------- | ------------------------------- |
| `SMTP_HOST`     | SMTP server hostname            |
| `SMTP_PORT`     | SMTP port (typically 587 / 465) |
| `SMTP_USER`     | SMTP username                   |
| `SMTP_PASSWORD` | SMTP password                   |
| `SMTP_FROM`     | From address for outbound email |

---

## SMS (Twilio)

Configure Twilio credentials via **Settings → Notifications** in the UI, or supply them as environment variables:

| Variable              | Description                |
| --------------------- | -------------------------- |
| `TWILIO_ACCOUNT_SID`  | Twilio Account SID         |
| `TWILIO_AUTH_TOKEN`   | Twilio Auth Token          |
| `TWILIO_PHONE_NUMBER` | Twilio source phone number |

---

## AWS SNS (SMS)

| Variable                | Description        |
| ----------------------- | ------------------ |
| `AWS_REGION`            | AWS region         |
| `AWS_ACCESS_KEY_ID`     | AWS IAM access key |
| `AWS_SECRET_ACCESS_KEY` | AWS IAM secret key |

---

## Push Notifications (Web Push / VAPID)

VAPID keys for web push can be generated via **Settings → Notifications → Web Push** in the UI.

| Variable            | Description                   |
| ------------------- | ----------------------------- |
| `VAPID_PUBLIC_KEY`  | VAPID public key              |
| `VAPID_PRIVATE_KEY` | VAPID private key (encrypted) |
| `VAPID_SUBJECT`     | Contact email for VAPID       |

---

## Observability

| Variable                      | Description                                     |
| ----------------------------- | ----------------------------------------------- |
| `OTEL_ENABLED`                | Set to `true` to enable OpenTelemetry tracing   |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP collector endpoint                         |
| `LOG_LEVEL`                   | Log verbosity: `debug`, `info`, `warn`, `error` |

---

## Example `.env` (Production)

```bash
# ============================================================
# OpsKnight — Production Environment Configuration
# ============================================================

# --- Required ---
DATABASE_URL=postgresql://opsknight:your_secure_password@db-host:5432/opsknight_db?sslmode=require&connection_limit=40
NEXTAUTH_URL=https://ops.yourcompany.com
NEXTAUTH_SECRET=<output of: openssl rand -base64 32>

# --- Encryption (required in production) ---
# Generate with: openssl rand -hex 32
ENCRYPTION_KEY=<your-64-char-hex-key>

# --- Application URL ---
NEXT_PUBLIC_APP_URL=https://ops.yourcompany.com

# --- Email (optional — can configure via UI) ---
# SMTP_HOST=smtp.yourcompany.com
# SMTP_PORT=587
# SMTP_USER=opsknight@yourcompany.com
# SMTP_PASSWORD=your-smtp-password
# SMTP_FROM=opsknight@yourcompany.com
```

---

## Example `.env` (Local Development)

```bash
# ============================================================
# OpsKnight — Local Development
# ============================================================

DATABASE_URL=postgresql://opsknight:opsknight@localhost:5432/opsknight_db
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=dev-secret-not-for-production
NEXT_PUBLIC_APP_URL=http://localhost:3000

# ENCRYPTION_KEY is intentionally omitted in development.
# A safe static fallback key is used automatically when NODE_ENV=development.
```

---

## Configuration Tips

- **Secrets management**: Use AWS Secrets Manager, HashiCorp Vault, or GCP Secret Manager in production. Never commit secrets to source control.
- **Per-environment isolation**: Use distinct values for `NEXTAUTH_SECRET` and `ENCRYPTION_KEY` across dev, staging, and production.
- **Rotation**: Rotate `NEXTAUTH_SECRET` (invalidates all sessions) and `ENCRYPTION_KEY` (requires data re-encryption) on a regular cadence or after a suspected compromise.
- **Validation**: OpsKnight validates `ENCRYPTION_KEY` format on startup. If it is set but malformed (not a 64-char hex string), encryption is disabled and an error is logged.

---

## Related Topics

- [Installation Guide](./installation) — Get OpsKnight running
- [Encryption](../security/encryption) — Key management and rotation
- [Authentication](../administration/authentication) — OIDC SSO configuration
- [Deployment: Docker](../deployment/docker) — Docker-specific configuration
- [Deployment: Kubernetes](../deployment/kubernetes) — Kubernetes secrets and ConfigMaps
