---
title: Configuration reference
description: Supported production environment configuration exposed by OpsKnight deployment manifests.
type: reference
product_area: configuration
audience: [developer, operator, administrator]
verification:
  level: source
  verified_at: 2026-10-02
  evidence:
    - src/
    - deploy/
---

# Configuration reference

This operator reference contains settings exposed by deployment manifests or
the supported environment template. Required and default values are conservative
static inferences; the listed source remains authoritative for validation.

## Curated production contract

These critical settings have operator-reviewed semantics. Conditions and safe
rotation procedures in the linked deployment and security guides take precedence
over a scanner-inferred default.

### `DATABASE_URL`

PostgreSQL connection used by the web and worker runtime.

- Type and valid value: PostgreSQL URL
- Runtime role: all runtime roles
- Apply behavior: restart required
- Sensitivity: secret

### `DIRECT_DATABASE_URL`

Direct PostgreSQL connection used for migrations and operations that must bypass a pooler.

- Type and valid value: PostgreSQL URL
- Runtime role: migration/integrated runtime
- Apply behavior: restart required
- Sensitivity: secret

### `NEXTAUTH_URL`

Canonical externally reachable application URL used by authentication callbacks.

- Type and valid value: absolute URL
- Runtime role: web
- Apply behavior: restart required
- Sensitivity: non-secret

### `NEXT_PUBLIC_APP_URL`

Public application origin embedded in browser-visible links and provider callbacks.

- Type and valid value: absolute URL
- Runtime role: web/build
- Apply behavior: rebuild or restart required
- Sensitivity: non-secret

### `NEXTAUTH_SECRET`

Signs authentication state and may act as the voice callback fallback only when sufficiently long.

- Type and valid value: high-entropy string (32+ characters)
- Runtime role: web
- Apply behavior: restart invalidates existing sessions
- Sensitivity: secret

### `ENCRYPTION_KEY`

Encrypts stored integration and provider credentials.

- Type and valid value: 64 hexadecimal characters
- Runtime role: all roles accessing encrypted data
- Apply behavior: coordinated restart; rotate through the documented procedure
- Sensitivity: critical secret

### `VOICE_CALLBACK_SIGNING_SECRET`

Signs Twilio voice gather and status callback tokens independently of login sessions.

- Type and valid value: high-entropy string (32+ characters)
- Runtime role: web and notification workers
- Apply behavior: restart required
- Sensitivity: secret

### `PROMETHEUS_SCRAPE_TOKEN`

Bearer token required by the metrics endpoint when configured.

- Type and valid value: opaque token
- Runtime role: web
- Apply behavior: restart required
- Sensitivity: secret

### `TRUST_PROXY_HEADERS`

Allows forwarded host and protocol headers from a trusted reverse proxy to define the external request origin.

- Type and valid value: boolean
- Runtime role: web behind a trusted proxy
- Apply behavior: restart required
- Sensitivity: non-secret; enable only when untrusted clients cannot set forwarded headers

### `SCIM_BEARER_TOKEN`

Authenticates SCIM provisioning requests.

- Type and valid value: high-entropy bearer token
- Runtime role: web
- Apply behavior: restart required; overlap old and new clients only through an intentional rotation window
- Sensitivity: secret

### `OIDC_REQUIRE_EMAIL_VERIFIED_STRICT`

Rejects OIDC identities whose provider does not assert a verified email.

- Type and valid value: boolean
- Runtime role: web
- Apply behavior: restart required
- Sensitivity: non-secret

### `OIDC_CONFIG_CACHE_TTL_MS`

Controls how long resolved OIDC provider configuration remains in the process cache.

- Type and valid value: positive milliseconds
- Runtime role: web
- Apply behavior: restart required
- Sensitivity: non-secret

### `SLACK_BOT_TOKEN`

Authorizes Slack Web API operations for the connected workspace.

- Type and valid value: Slack bot token
- Runtime role: web and notification workers
- Apply behavior: restart required after secret replacement
- Sensitivity: secret

### `SLACK_SIGNING_SECRET`

Verifies inbound Slack request signatures.

- Type and valid value: Slack signing secret
- Runtime role: web
- Apply behavior: restart required; coordinate rotation with Slack configuration
- Sensitivity: secret

### `SLACK_CLIENT_SECRET`

Authenticates the Slack OAuth client.

- Type and valid value: Slack OAuth client secret
- Runtime role: web
- Apply behavior: restart required
- Sensitivity: secret

### `OPSKNIGHT_WORKER_CONCURRENCY`

Sets general worker parallelism when a lane-specific override is absent.

- Type and valid value: positive integer
- Runtime role: worker
- Apply behavior: restart required; increase only after checking database and provider capacity
- Sensitivity: non-secret

### `OPSKNIGHT_WORKER_BATCH_SIZE`

Sets the general queue claim batch when a lane-specific override is absent.

- Type and valid value: positive integer
- Runtime role: worker
- Apply behavior: restart required; keep aligned with concurrency and lease duration
- Sensitivity: non-secret

### `OPSKNIGHT_WORKER_BUSY_POLL_MS`

Sets the polling interval while general work is available.

- Type and valid value: positive milliseconds
- Runtime role: worker
- Apply behavior: restart required
- Sensitivity: non-secret

### `OPSKNIGHT_WORKER_IDLE_POLL_MS`

Sets the polling interval while the general queue is idle.

- Type and valid value: positive milliseconds
- Runtime role: worker
- Apply behavior: restart required
- Sensitivity: non-secret


## Supported production inventory

## `ALLOW_INSECURE_SECRETS`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `1`, `true`
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: not displayed
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `src/lib/encryption.ts`, `src/lib/env-validation.ts`

## `API_KEY_SECRET`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/kubernetes/helm/opsknight/templates/deployment.yaml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `env.example`, `src/lib/api-keys.ts`, `src/lib/env-validation.ts`

## `APP_HOST_ALIASES`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`, `env.example`, `src/middleware.ts`

## `APP_PORT`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `3000`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`, `env.example`

## `AUTH_BREAK_GLASS_EMAIL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `env.example`, `src/lib/local-auth-policy.ts`

## `AUTH_BREAK_GLASS_ENABLED`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `env.example`, `src/lib/local-auth-policy.ts`

## `AUTH_LOCAL_LOGIN_ENABLED`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `env.example`, `src/lib/local-auth-policy.ts`

## `AUTH_SSO_REAUTH_AFTER_SECONDS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `env.example`, `src/lib/local-auth-policy.ts`

## `AUTH_SSO_SESSION_IDLE_TIMEOUT_SECONDS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `env.example`, `src/lib/local-auth-policy.ts`

## `AUTH_SSO_SESSION_MAX_AGE_SECONDS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `env.example`, `src/lib/local-auth-policy.ts`

## `AUTH_SSO_SESSION_UPDATE_AGE_SECONDS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `env.example`, `src/lib/local-auth-policy.ts`

## `DATABASE_POOL_SIZE_BULK_WORKER`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `3`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`, `deploy/swarm/docker-stack.yml`, `src/lib/prisma.ts`

## `DATABASE_POOL_SIZE_CRITICAL_WORKER`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `15`, `5`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`, `deploy/swarm/docker-stack.yml`, `src/lib/prisma.ts`

## `DATABASE_POOL_SIZE_GENERAL_WORKER`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `5`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`, `deploy/swarm/docker-stack.yml`, `src/lib/prisma.ts`

## `DATABASE_POOL_SIZE_SCHEDULER`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `3`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`, `deploy/swarm/docker-stack.yml`, `src/lib/prisma.ts`

## `DATABASE_POOL_SIZE_STATUS_PROJECTOR`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `3`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`, `deploy/swarm/docker-stack.yml`, `src/lib/prisma.ts`

## `DATABASE_POOL_SIZE_WEB`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `10`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`, `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`, `src/lib/prisma.ts`

## `ENCRYPTION_KEYS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/kubernetes/helm/opsknight/templates/deployment.yaml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `env.example`, `src/app/(app)/settings/system/page.tsx`, `src/lib/admin-health.ts`, `src/lib/encryption.ts`, `src/lib/env-validation.ts`

## `EXTERNAL_DB_HOST`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.external-db.integrated.yml`, `deploy/swarm/docker-stack.external-db.yml`

## `EXTERNAL_DB_NAME`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `${POSTGRES_DB:-opsknight_db`, `opsknight_db`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.external-db.integrated.yml`, `deploy/swarm/docker-stack.external-db.yml`

## `EXTERNAL_DB_PASSWORD`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`

## `EXTERNAL_DB_PORT`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `5432`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.external-db.integrated.yml`, `deploy/swarm/docker-stack.external-db.yml`

## `EXTERNAL_DB_USER`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `${POSTGRES_USER:-opsknight`, `opsknight`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.external-db.integrated.yml`, `deploy/swarm/docker-stack.external-db.yml`

## `INTEGRATED_REPLICAS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `1`
- Sources: `deploy/swarm/docker-stack.integrated.yml`

## `NOTIFICATION_CONTROL_PLANE_PERSONAL`

- Type: boolean
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `true`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `OPSKNIGHT_API_KEY_SECRET_SECRET`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `OPSKNIGHT_CUSTOM_CA_SECRET`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `deploy/swarm/docker-stack.ca.integrated.yml`, `deploy/swarm/docker-stack.ca.split.yml`, `deploy/swarm/docker-stack.pgbouncer-ca.yml`

## `OPSKNIGHT_DATABASE_URL`

- Type: string
- Required: yes
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: not displayed
- Sources: `deploy/compose/docker-compose.external-db.yml`, `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `env.example`

## `OPSKNIGHT_DATABASE_URL_SECRET`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `OPSKNIGHT_DIRECT_DATABASE_URL_SECRET`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `OPSKNIGHT_ENCRYPTION_KEY_SECRET`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `OPSKNIGHT_ENCRYPTION_KEYS_SECRET`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `OPSKNIGHT_IMAGE`

- Type: string
- Required: yes
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `ghcr.io/opsknight-labs/opsknight:2.0.0`, `opsknight-local:test`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`, `env.example`, `scripts/soak-test-2h.sh`

## `OPSKNIGHT_NEXTAUTH_SECRET_SECRET`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `OPSKNIGHT_PGBOUNCER_DB_PASSWORD_SECRET`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `deploy/swarm/docker-stack.pgbouncer.yml`

## `OPSKNIGHT_PGBOUNCER_IMAGE`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `ghcr.io/opsknight-labs/opsknight-pgbouncer:1.26.0`
- Sources: `deploy/swarm/docker-stack.pgbouncer.yml`

## `OPSKNIGHT_PGBOUNCER_USERLIST_SECRET`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `deploy/swarm/docker-stack.pgbouncer.yml`

## `OPSKNIGHT_PROCESS_ROLE`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`, `env.example`, `src/lib/runtime-role.ts`

## `OPSKNIGHT_PULL_POLICY`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `always`, `never`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `scripts/soak-test-2h.sh`

## `OPSKNIGHT_SCHEDULER_PROFILE`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`, `env.example`, `src/lib/runtime-role.ts`

## `OPSKNIGHT_SKIP_MIGRATIONS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `deploy/kubernetes/helm/opsknight/templates/deployment.yaml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`

## `OPSKNIGHT_WEB_DATABASE_URL_SECRET`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `deploy/swarm/docker-stack.pgbouncer.yml`

## `OPSKNIGHT_WORKER_BATCH_SIZE_BULK`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `100`
- Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_BATCH_SIZE_CRITICAL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `100`
- Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_BATCH_SIZE_PROJECTOR`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `100`
- Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_BUSY_POLL_MS_BULK`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `100`
- Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_BUSY_POLL_MS_CRITICAL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `50`
- Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_BUSY_POLL_MS_PROJECTOR`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `100`
- Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_CONCURRENCY_BULK`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `15`
- Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_CONCURRENCY_CRITICAL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `15`
- Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_CONCURRENCY_PROJECTOR`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `15`
- Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_IDLE_POLL_MS_BULK`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `1000`
- Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_IDLE_POLL_MS_CRITICAL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `1000`
- Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_IDLE_POLL_MS_PROJECTOR`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `1000`
- Sources: `deploy/compose/docker-compose.split.yml`

## `PGBOUNCER_DB_HOST`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `${EXTERNAL_DB_HOST:-`, `opsknight-db`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`, `env.example`

## `PGBOUNCER_DB_NAME`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `${EXTERNAL_DB_NAME:-${POSTGRES_DB:-opsknight_db`, `opsknight_db`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`, `env.example`

## `PGBOUNCER_DB_PASSWORD`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`, `env.example`

## `PGBOUNCER_DB_PASSWORD_FILE`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`

## `PGBOUNCER_DB_PORT`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `${EXTERNAL_DB_PORT:-5432`, `5432`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`, `env.example`

## `PGBOUNCER_DB_USER`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `${EXTERNAL_DB_USER:-${POSTGRES_USER:-opsknight`, `opsknight`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`, `env.example`

## `PGBOUNCER_DEFAULT_POOL_SIZE`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `10`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`, `env.example`

## `PGBOUNCER_ENABLED`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `env.example`

## `PGBOUNCER_IMAGE`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `ghcr.io/icoretech/pgbouncer-docker:1.26.0@sha256:f6537e614011f3d95349847fdd47f1b3a96be86eab99015b5b5918f732884a75`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`

## `PGBOUNCER_MAX_CLIENT_CONN`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `1000`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`

## `PGBOUNCER_POOL_MODE`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `transaction`
- Sources: `deploy/swarm/docker-stack.pgbouncer.yml`

## `PGBOUNCER_RESERVE_POOL_SIZE`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `5`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`, `env.example`

## `PGBOUNCER_SERVER_TLS_CA_FILE`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `env.example`

## `PGBOUNCER_SERVER_TLS_SSLMODE`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `disable`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`, `env.example`

## `PGBOUNCER_TLS_CA_CERT`

- Type: string
- Required: yes
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: none discovered
- Sources: `deploy/compose/docker-compose.pgbouncer-ca.yml`, `env.example`

## `PGDATA`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `deploy/kubernetes/helm/opsknight/templates/postgres-statefulset.yaml`, `deploy/kubernetes/kustomize/base/postgres-statefulset.yaml`

## `POSTGRES_DB`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `opsknight_db`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/kubernetes/helm/opsknight/templates/postgres-statefulset.yaml`, `deploy/kubernetes/kustomize/base/postgres-statefulset.yaml`, `deploy/swarm/docker-stack.db.yml`, `env.example`

## `POSTGRES_INITDB_ARGS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `deploy/kubernetes/helm/opsknight/templates/postgres-statefulset.yaml`, `deploy/kubernetes/kustomize/base/postgres-statefulset.yaml`

## `POSTGRES_PASSWORD`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/kubernetes/helm/opsknight/templates/postgres-statefulset.yaml`, `deploy/kubernetes/kustomize/base/postgres-statefulset.yaml`, `deploy/swarm/docker-stack.db.yml`, `env.example`, `src/lib/env-validation.ts`

## `POSTGRES_PORT`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `5432`
- Sources: `deploy/compose/docker-compose.yml`, `env.example`

## `POSTGRES_USER`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `opsknight`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/kubernetes/helm/opsknight/templates/postgres-statefulset.yaml`, `deploy/kubernetes/kustomize/base/postgres-statefulset.yaml`, `deploy/swarm/docker-stack.db.yml`, `env.example`

## `REDIRECT_TO_CANONICAL_HOST`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `false`
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `true`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`, `env.example`, `src/middleware.ts`

## `RUNTIME_DATABASE_URL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `deploy/kubernetes/helm/opsknight/templates/migration-job.yaml`

## `SETUP_SECRET`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/kubernetes/helm/opsknight/templates/deployment.yaml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`, `env.example`, `src/app/setup/actions.ts`

## `SWARM_NETWORK_NAME`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `opsknight`
- Sources: `deploy/swarm/docker-stack.db.yml`, `deploy/swarm/docker-stack.external-db.integrated.yml`, `deploy/swarm/docker-stack.external-db.yml`, `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`, `deploy/swarm/docker-stack.yml`

## `SWARM_REPLICAS_BULK_WORKER`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `2`
- Sources: `deploy/swarm/docker-stack.yml`

## `SWARM_REPLICAS_CRITICAL_WORKER`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `2`
- Sources: `deploy/swarm/docker-stack.yml`

## `SWARM_REPLICAS_GENERAL_WORKER`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `2`
- Sources: `deploy/swarm/docker-stack.yml`

## `SWARM_REPLICAS_PGBOUNCER`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `2`
- Sources: `deploy/swarm/docker-stack.pgbouncer.yml`

## `SWARM_REPLICAS_SCHEDULER`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `2`
- Sources: `deploy/swarm/docker-stack.yml`

## `SWARM_REPLICAS_STATUS_PROJECTOR`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `2`
- Sources: `deploy/swarm/docker-stack.yml`

## `SWARM_REPLICAS_WEB`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `2`
- Sources: `deploy/swarm/docker-stack.yml`

## `SWARM_RUNTIME_MODE`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `deploy/swarm/docker-stack.integrated.yml`

## `TRUSTED_PROXY_HOPS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `1`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`, `env.example`, `src/lib/client-ip.ts`

## `WEB_DATABASE_URL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: manifest
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/compose/docker-compose.split.yml`, `env.example`, `src/lib/prisma-datasource.ts`

