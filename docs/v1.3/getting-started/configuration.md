---
order: 2
title: Configuration Reference
description: Runtime, deployment, security, integration, and advanced environment variables supported by OpsKnight v1.3.
---

# Configuration Reference

This page documents the operator-facing environment variables supported by OpsKnight v1.3. Copy `env.example` to `.env`, then provide secrets through your platform's secret store in production.

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
| `ENCRYPTION_KEY` |        **Yes**         | 32-byte hex master key (64 hex chars) used to encrypt supported stored provider and integration credentials. API keys are one-way hashed separately. |

### Generating the Encryption Key

```bash
openssl rand -hex 32
```

This produces a 64-character hex string. Set it in your environment:

```bash
ENCRYPTION_KEY=a3f1c2e4b5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2
```

**Development note:** When `NODE_ENV=development` and `ENCRYPTION_KEY` is not set, OpsKnight uses a public, deterministic fallback key so local encryption-dependent flows can run. It provides no secrecy and is **not suitable for shared or production data**.

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

**Example encrypted connection:**

```bash
DATABASE_URL=postgresql://opsknight:password@host:5432/opsknight_db?sslmode=require
```

Use the certificate-verification mode and trust configuration required by your PostgreSQL provider. Connection-pool size is deployment-specific: budget the per-process pool across all application replicas plus migration, backup, monitoring, and administrative reserve. Do not copy a fixed `connection_limit` or `pool_timeout` without load testing; see [Scalability and capacity planning](../core-concepts/scalability).

---

## Application URL

| Variable              | Required | Description                                                   |
| --------------------- | :------: | ------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL` |   Yes    | Public URL used in emails, webhooks, RSS feeds, and client JS |

This should match `NEXTAUTH_URL` in most deployments. It is exposed to the browser (hence `NEXT_PUBLIC_`), so it must be the external URL, not an internal container address.

---

## Notification providers

Configure Resend, SendGrid, SMTP, Amazon SES, Twilio, AWS SNS, WhatsApp, and Web Push in **Settings → Notification Providers**. v1.3 does not read `SMTP_*`, `TWILIO_*`, or AWS SNS credentials from environment variables. Configure a valid `ENCRYPTION_KEY` before entering provider credentials; see [Encryption](../security/encryption) for the protected-field and recovery boundaries.

`AWS_ACCESS_KEY_ID` is only a fallback for the SES client after an enabled SES record supplies the remaining provider configuration. Prefer storing the full, dedicated SES credential set in the SES provider form so behavior is explicit.

See [Notifications](../administration/notifications) for fields, recipient requirements, test paths, and delivery semantics.

---

## Push Notifications (Web Push / VAPID)

VAPID keys for web push can be generated via **Settings → Notifications → Web Push** in the UI.

| Variable                       | Description                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Public base64url VAPID key exposed to clients when no database provider key is available. |
| `VAPID_PRIVATE_KEY`            | Matching private VAPID key used by the sender fallback.                                   |
| `VAPID_SUBJECT`                | Contact URI, normally `mailto:admin@example.com`; defaults to `mailto:admin@localhost`.   |

Set the public and private variables together. The database-backed Web Push provider is the normal production path.

---

## Operations and observability

| Variable                                  | Default                    | Description                                                                                                                       |
| ----------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `LOG_LEVEL`                               | `info`                     | Minimum structured-log level: `debug`, `info`, `warn`, or `error`.                                                                |
| `LOG_FORMAT`                              | Environment dependent      | Set to `json` for JSON output.                                                                                                    |
| `LOG_BUFFER_MAX`                          | `500`                      | Maximum in-memory log-buffer size.                                                                                                |
| `SENTRY_DSN`                              | —                          | Requests optional Sentry initialization when a custom build includes `@sentry/nextjs`; the standard v1.3 dependency set does not. |
| `SENTRY_ENVIRONMENT`                      | `NODE_ENV`                 | Optional Sentry environment label for such a custom build.                                                                        |
| `SENTRY_FORCE_ENABLE`                     | `false`                    | Enables that optional Sentry path outside production when `true`.                                                                 |
| `NEXT_PUBLIC_ENABLE_WEB_VITALS`           | `false` outside production | Enables browser Web Vitals reporting outside production.                                                                          |
| `APP_VERSION` / `NEXT_PUBLIC_APP_VERSION` | Package version            | Server/public version label override.                                                                                             |

OpenTelemetry variables are not consumed by the v1.3 application code and are therefore not part of this reference.

## Runtime controls

| Variable                         | Default      | Description                                                                                                                    |
| -------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_POOL_SIZE`             | `40`         | Adds a Prisma connection limit when `DATABASE_URL` has no `connection_limit`.                                                  |
| `ENABLE_INTERNAL_CRON`           | `true`       | Set to `false` when background jobs are run by another designated process.                                                     |
| `INTEGRATION_RATE_LIMIT`         | `true`       | Set to `false` to disable standard-handler integration rate limiting. This is not recommended for internet-facing deployments. |
| `INTEGRATION_VERIFY_SIGNATURES`  | `true`       | Set to `false` to disable signature checks on handlers that honor this flag. Use only for controlled diagnosis.                |
| `CORS_ALLOWED_ORIGINS`           | empty        | Comma-separated origins allowed by middleware for cross-origin API requests.                                                   |
| `STATUS_PAGE_DOMAIN_CACHE_TTL`   | `60`         | Custom-status-domain middleware cache TTL in seconds.                                                                          |
| `EVENT_TRANSACTION_MAX_ATTEMPTS` | code default | Advanced transaction retry limit; tune only after reviewing database contention.                                               |
| `ESCALATION_LOCK_TIMEOUT_MS`     | code default | Advanced escalation lock timeout in milliseconds.                                                                              |
| `SKIP_ENV_VALIDATION`            | unset        | Bypasses production environment validation. Use only for controlled build/diagnostic workflows.                                |
| `DISABLE_PWA`                    | `false`      | Set to `true` at build time to disable production service-worker generation, PWA installation, push, and supported offline behavior. |
| `EMAIL_FROM`                     | derived      | Fallback sender address when code paths do not receive a provider-specific From address; prefer an explicitly verified provider identity. |
| `MIGRATION_RECOVERY_MODE`        | `safe`       | Startup recovery policy. Do not use `aggressive` without database-owner review of the failed migration and actual schema state. |
| `OPSKNIGHT_BACKUP_LAST_SUCCESS_AT` | unset      | ISO-8601 timestamp reported by the external backup controller after a successful backup; displayed as attestation in Health Center. |
| `OPSKNIGHT_RESTORE_TEST_LAST_SUCCESS_AT` | unset | ISO-8601 timestamp recorded only after an isolated restore test succeeds; displayed as attestation in Health Center. |

## Authentication and integration overrides

| Variable                                                       | Purpose                                                                                                           |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `AUTH_TRUST_HOST`                                              | Explicitly enables Auth.js host trust; setting `NEXTAUTH_URL` also enables it.                                    |
| `OIDC_REQUIRE_EMAIL_VERIFIED_STRICT`                           | Requires a verified-email claim from OIDC when `true`.                                                            |
| `OIDC_CONFIG_CACHE_TTL_MS`, `OIDC_CONFIG_RECORD_CACHE_TTL_MS`  | Advanced OIDC cache TTLs.                                                                                         |
| `AUTH_OPTIONS_CACHE_TTL_MS`, `JWT_USER_REFRESH_TTL_MS`         | Advanced authentication/session cache timing.                                                                     |
| `API_KEY_SECRET`                                               | Overrides the secret used to hash API keys; otherwise `NEXTAUTH_SECRET` is used. Back up and rotate deliberately. |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI` | Slack OAuth fallback values when equivalent stored settings are absent.                                           |
| `SLACK_SIGNING_SECRET`                                         | Slack request-signature fallback/override.                                                                        |
| `SLACK_BOT_TOKEN`, `SLACK_WEBHOOK_URL`                         | Legacy Slack sender fallbacks; prefer the encrypted Slack configuration UI.                                       |
| `SLA_ALERT_EMAIL`                                              | Fallback recipient for configured SLA-breach email alerts.                                                        |

---

## Example `.env` (Production)

```bash
# ============================================================
# OpsKnight — Production Environment Configuration
# ============================================================

# --- Required ---
DATABASE_URL=postgresql://opsknight:your_secure_password@db-host:5432/opsknight_db?sslmode=require
NEXTAUTH_URL=https://ops.yourcompany.com
NEXTAUTH_SECRET=<output of: openssl rand -base64 32>

# --- Encryption (required in production) ---
# Generate with: openssl rand -hex 32
ENCRYPTION_KEY=<your-64-char-hex-key>

# --- Application URL ---
NEXT_PUBLIC_APP_URL=https://ops.yourcompany.com

# Configure notification-provider credentials in the application UI.
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
# A public deterministic fallback key is used when NODE_ENV=development.
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
