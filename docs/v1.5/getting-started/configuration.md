---
order: 2
title: Configuration Reference
description: Runtime, deployment, security, integration, and advanced environment variables supported by OpsKnight v1.5.
---

# Configuration Reference

This page documents operator-facing environment variables supported by OpsKnight v1.5. Copy `env.example` to `.env`, then provide production secrets through your platform's secret store.

```bash
cp env.example .env
```

## Required variables

| Variable | Description | Example / How to Generate |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `NEXTAUTH_URL` | Exact public authentication origin | `https://ops.yourcompany.com` |
| `NEXTAUTH_SECRET` | Secret used to sign/encrypt session tokens | `openssl rand -base64 32` |

`NEXTAUTH_URL` must match the public URL users access, including `https://`. Callback/cookie mismatches commonly produce OAuth login loops.

## Security and encryption

| Variable | Required in Production | Description |
| --- | :---: | --- |
| `ENCRYPTION_KEYS` | Recommended | Rotation keyring using `key-id:64-hex-key` entries. The first key encrypts new values; the full ring decrypts supported older values. |
| `ENCRYPTION_KEY` | Yes if no keyring | Single 64-hex-character key used as the compatibility/master encryption key. |

Generate a key with:

```bash
openssl rand -hex 32
```

Example:

```bash
ENCRYPTION_KEY=a3f1c2e4b5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2
```

When `NODE_ENV=development` and no encryption key is configured, the development fallback exists only to keep local encryption-dependent flows usable. It provides no production secrecy.

See [Encryption](../security/encryption.md).

## Authentication

### Core authentication variables

| Variable | Default | Description |
| --- | --- | --- |
| `NEXTAUTH_SECRET` | required | Signs/encrypts session JWTs. Changing it invalidates sessions. |
| `NEXTAUTH_URL` | required | Canonical public authentication origin and callback base. |
| `AUTH_TRUST_HOST` | inferred from canonical auth configuration | Explicit Auth.js host-trust control. |
| `TRUSTED_PROXY_HOPS` | `1` | Number of trusted proxy entries read from the right side of `X-Forwarded-For`. |

### Local login and break-glass

| Variable | Default | Description |
| --- | --- | --- |
| `AUTH_LOCAL_LOGIN_ENABLED` | `true` | Enables normal local email/password authentication. Set `false` for SSO-only operation. |
| `AUTH_BREAK_GLASS_ENABLED` | `false` | Enables the explicitly configured emergency local identity even when normal local login is disabled. |
| `AUTH_BREAK_GLASS_EMAIL` | unset | Exact normalized email allowed through the break-glass local-auth path. |

Example SSO-only configuration with an emergency Admin:

```bash
AUTH_LOCAL_LOGIN_ENABLED=false
AUTH_BREAK_GLASS_ENABLED=true
AUTH_BREAK_GLASS_EMAIL=security-admin@example.com
```

Keep break-glass credentials outside the ordinary OIDC dependency and audit each use.

### OIDC session controls

These limits apply to OIDC sessions and do not replace the normal credential Remember Me policy.

| Variable | Default | Allowed runtime range | Description |
| --- | ---: | ---: | --- |
| `AUTH_SSO_SESSION_MAX_AGE_SECONDS` | `43200` (12h) | 900–2592000 | Absolute OpsKnight OIDC session lifetime. |
| `AUTH_SSO_SESSION_UPDATE_AGE_SECONDS` | `3600` (1h) | 60–86400 | NextAuth database session update throttle (retained for database session parity; JWT sessions enforce per-request validation). |
| `AUTH_SSO_SESSION_IDLE_TIMEOUT_SECONDS` | `14400` (4h) | 300–604800 | Idle-time boundary for OIDC sessions. |
| `AUTH_SSO_REAUTH_AFTER_SECONDS` | `43200` (12h) | 900–2592000 | Requires a new OpsKnight OIDC session after this age. It does not guarantee the upstream IdP prompts for credentials. |

Out-of-range or invalid values fall back to safe defaults.

### OIDC compatibility and cache controls

| Variable | Purpose |
| --- | --- |
| `OIDC_REQUIRE_EMAIL_VERIFIED_STRICT` | Generic OIDC verified-email policy. Provider-specific logic still applies to validated issuers such as Microsoft Entra, which may omit the standard claim. Explicit `email_verified=false` is rejected. |
| `OIDC_CONFIG_CACHE_TTL_MS` | Advanced in-process OIDC config cache TTL. |
| `OIDC_CONFIG_RECORD_CACHE_TTL_MS` | Advanced OIDC database-record cache TTL. |
| `AUTH_OPTIONS_CACHE_TTL_MS` | Advanced Auth.js options cache TTL. |
| `JWT_USER_REFRESH_TTL_MS` | Advanced session/user refresh timing. |

Use the UI under **Settings → System → Single Sign-On (OIDC)** for issuer, client ID, encrypted client secret, provider policy, organization/domain restrictions, role mapping, and profile mapping. Do not add those secrets as ad-hoc environment variables.

See [OIDC SSO Setup](../security/oidc-setup.md) and [Authentication](../administration/authentication.md).

## SCIM provisioning

| Variable | Default | Description |
| --- | --- | --- |
| `SCIM_BEARER_TOKEN` | unset | Bearer secret for `/api/scim/v2`. Must be at least 32 characters. |

Recommended generation:

```bash
openssl rand -hex 32
```

Example:

```bash
SCIM_BEARER_TOKEN=<64-hex-character-random-value>
```

Do not reuse the OIDC client secret as the SCIM token. See [SCIM Provisioning](../security/scim-provisioning.md).

## Database

| Variable | Required | Description | Default |
| --- | :---: | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string | — |
| `POSTGRES_USER` | No | Database username for bundled Compose PostgreSQL | `opsknight` |
| `POSTGRES_PASSWORD` | No | Bundled Compose PostgreSQL password | — |
| `POSTGRES_DB` | No | Bundled Compose database name | `opsknight_db` |
| `DATABASE_POOL_SIZE` | No | Adds a Prisma connection limit when `DATABASE_URL` has no `connection_limit` | `40` |

For Kubernetes or Helm deployments, configure the database independently and set `DATABASE_URL` directly.

Example encrypted connection:

```bash
DATABASE_URL=postgresql://opsknight:password@host:5432/opsknight_db?sslmode=require
```

Budget per-process pools across all application replicas plus migration, backup, monitoring, and administrative reserve. See [Scalability and capacity planning](../core-concepts/scalability.md).

## Application URL

| Variable | Required | Description |
| --- | :---: | --- |
| `NEXT_PUBLIC_APP_URL` | Yes | Public URL used in emails, webhooks, RSS feeds, and client-side links. |

This normally matches `NEXTAUTH_URL`. It is exposed to browser code and must not contain an internal-only container URL.

## Notification providers

Configure Resend, SendGrid, SMTP, Amazon SES, Twilio, AWS SNS, WhatsApp, and Web Push from **Settings → Notification Providers**. Provider credentials are normally stored through the UI using encrypted protected fields.

`AWS_ACCESS_KEY_ID` is only a fallback for the SES client after an enabled SES record supplies the remaining provider configuration. Prefer the complete dedicated SES configuration in the UI.

See [Notifications](../administration/notifications.md).

## Push notifications (Web Push / VAPID)

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Public base64url VAPID key exposed to clients when no database provider key is available. |
| `VAPID_PRIVATE_KEY` | Matching private VAPID fallback key. |
| `VAPID_SUBJECT` | Contact URI, normally `mailto:admin@example.com`. |

Set the public and private values together. The database-backed Web Push provider is the normal production path.

## Operations and observability

| Variable | Default | Description |
| --- | --- | --- |
| `LOG_LEVEL` | `info` | Minimum structured-log level: `debug`, `info`, `warn`, or `error`. |
| `LOG_FORMAT` | environment dependent | Set to `json` for JSON output. |
| `LOG_BUFFER_MAX` | `500` | Maximum in-memory log buffer size. |
| `SENTRY_DSN` | — | Optional Sentry DSN when the deployed build includes the supported Sentry integration. |
| `SENTRY_ENVIRONMENT` | `NODE_ENV` | Optional Sentry environment label. |
| `SENTRY_FORCE_ENABLE` | `false` | Enables optional Sentry initialization outside production where supported. |
| `NEXT_PUBLIC_ENABLE_WEB_VITALS` | `false` outside production | Enables browser Web Vitals reporting outside production. |
| `APP_VERSION` / `NEXT_PUBLIC_APP_VERSION` | package version | Server/public version label override. |
| `PROMETHEUS_SCRAPE_TOKEN` | — | Bearer token for authenticated `/api/metrics` scraping. |

See [Prometheus metrics](../deployment/prometheus.md) for the scrape contract.

## Runtime controls

| Variable | Default | Description |
| --- | --- | --- |
| `ENABLE_INTERNAL_CRON` | `true` | Set `false` when background jobs are run by another designated process. |
| `INTEGRATION_RATE_LIMIT` | `true` | Controls standard-handler integration rate limiting. Disabling is not recommended for internet-facing deployments. |
| `INTEGRATION_VERIFY_SIGNATURES` | `true` | Controls signature checks only for handlers that explicitly honor this flag. Use disablement only for controlled diagnosis. |
| `CORS_ALLOWED_ORIGINS` | empty | Comma-separated origins allowed by middleware for cross-origin API requests. |
| `STATUS_PAGE_DOMAIN_CACHE_TTL` | `60` | Custom status-domain middleware cache TTL in seconds. |
| `EVENT_TRANSACTION_MAX_ATTEMPTS` | code default | Advanced transaction retry limit. |
| `ESCALATION_LOCK_TIMEOUT_MS` | code default | Advanced escalation lock timeout. |
| `SKIP_ENV_VALIDATION` | unset | Bypasses production environment validation; use only for controlled build/diagnostic workflows. |
| `DISABLE_PWA` | `false` | Disables production service-worker generation/PWA behavior at build time when `true`. |
| `EMAIL_FROM` | derived | Fallback sender address when a code path does not receive a provider-specific From address. |
| `MIGRATION_RECOVERY_MODE` | `safe` | Startup migration recovery policy. Do not use aggressive recovery without database-owner review. |

## Integration overrides

| Variable | Purpose |
| --- | --- |
| `API_KEY_SECRET` | Overrides the secret used to hash API keys; otherwise `NEXTAUTH_SECRET` is used. |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI` | Slack OAuth fallback values when equivalent stored settings are absent. |
| `SLACK_SIGNING_SECRET` | Slack request-signature fallback/override. |
| `SLACK_BOT_TOKEN`, `SLACK_WEBHOOK_URL` | Legacy Slack sender fallbacks; prefer encrypted stored Slack configuration. |
| `SLA_ALERT_EMAIL` | Fallback recipient for configured SLA-breach email alerts. |

## Example production `.env`

```bash
DATABASE_URL=postgresql://opsknight:your_secure_password@db-host:5432/opsknight_db?sslmode=require
NEXTAUTH_URL=https://ops.yourcompany.com
NEXTAUTH_SECRET=<output-of-openssl-rand-base64-32>
NEXT_PUBLIC_APP_URL=https://ops.yourcompany.com

ENCRYPTION_KEY=<output-of-openssl-rand-hex-32>

# Enterprise SSO-only example
AUTH_LOCAL_LOGIN_ENABLED=false
AUTH_BREAK_GLASS_ENABLED=true
AUTH_BREAK_GLASS_EMAIL=security-admin@example.com
AUTH_SSO_SESSION_MAX_AGE_SECONDS=43200
AUTH_SSO_SESSION_UPDATE_AGE_SECONDS=3600
AUTH_SSO_SESSION_IDLE_TIMEOUT_SECONDS=14400
AUTH_SSO_REAUTH_AFTER_SECONDS=43200

# Optional SCIM provisioning
SCIM_BEARER_TOKEN=<output-of-openssl-rand-hex-32>
```

## Example local-development `.env`

```bash
DATABASE_URL=postgresql://opsknight:opsknight@localhost:5432/opsknight_db
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=dev-secret-not-for-production
NEXT_PUBLIC_APP_URL=http://localhost:3000
AUTH_LOCAL_LOGIN_ENABLED=true
```

`ENCRYPTION_KEY` may be omitted only for local development where the documented non-secret fallback is acceptable.

## Configuration tips

- Use AWS Secrets Manager, HashiCorp Vault, GCP Secret Manager, Kubernetes Secrets, or an equivalent production secret store.
- Keep `NEXTAUTH_SECRET`, encryption keys, OIDC client secrets, break-glass credentials, and `SCIM_BEARER_TOKEN` out of source control.
- Use distinct secrets for development, staging, and production.
- Treat issuer changes and authentication-origin changes as security-sensitive changes and test them before production rollout.
- For SSO-only deployments, document and periodically verify the break-glass recovery procedure.

## Related topics

- [Installation Guide](./installation.md)
- [Encryption](../security/encryption.md)
- [Authentication](../administration/authentication.md)
- [OIDC SSO Setup](../security/oidc-setup.md)
- [SCIM Provisioning](../security/scim-provisioning.md)
- [Deployment: Docker](../deployment/docker.md)
- [Deployment: Kubernetes](../deployment/kubernetes.md)
