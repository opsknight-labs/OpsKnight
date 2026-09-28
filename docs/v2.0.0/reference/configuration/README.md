---
title: Configuration reference
description: Generated inventory of environment configuration used by source and deployment manifests.
type: reference
product_area: configuration
audience: [developer, operator, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/
    - deploy/
---

# Configuration reference

This generated inventory identifies configuration names found in current source
and deployment manifests. Required and default values are conservative static
inferences; the listed source remains authoritative for parsing and validation.

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


## Complete discovered inventory

## `API_KEY_SECRET`

- Required: no or conditionally required
- Secret: yes
- Scope: runtime
- Static default: not displayed
- Sources: `src/lib/api-keys.ts`

## `APP_HOST_ALIASES`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/middleware.ts`

## `APP_PORT`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `3000`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `APP_VERSION`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/components/Sidebar.tsx`, `src/lib/admin-health.ts`, `src/lib/version.ts`

## `AUTH_BREAK_GLASS_EMAIL`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/local-auth-policy.ts`

## `AUTH_BREAK_GLASS_ENABLED`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/local-auth-policy.ts`

## `AUTH_LOCAL_LOGIN_ENABLED`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/local-auth-policy.ts`

## `AUTH_OPTIONS_CACHE_TTL_MS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: `5000`
- Sources: `src/lib/auth.ts`

## `AUTH_SSO_REAUTH_AFTER_SECONDS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/local-auth-policy.ts`

## `AUTH_SSO_SESSION_IDLE_TIMEOUT_SECONDS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/local-auth-policy.ts`

## `AUTH_SSO_SESSION_MAX_AGE_SECONDS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/local-auth-policy.ts`

## `AUTH_SSO_SESSION_UPDATE_AGE_SECONDS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/local-auth-policy.ts`

## `AUTH_TRUST_HOST`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/auth.ts`

## `AWS_ACCESS_KEY_ID`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/email.ts`

## `BASE_APP_VERSION`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/constants.ts`

## `BOOTSTRAP_SECRET`

- Required: no or conditionally required
- Secret: yes
- Scope: runtime
- Static default: not displayed
- Sources: `src/app/setup/actions.ts`, `src/app/setup/page.tsx`

## `BUSINESS_HOURS_END`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/sla-server.ts`

## `BUSINESS_HOURS_START`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/sla-server.ts`

## `CALLBACK_URL_COOKIE_NAME`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/auth.ts`

## `CLAIM_TIMEOUT_MS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/notification-control-plane.ts`

## `CLEANUP_MUTEX_KEY`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/data-cleanup.ts`

## `COMPLIANCE_DRIFT_NOTIFICATIONS_ENABLED`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/compliance/monitoring/config.ts`

## `COMPLIANCE_DRIFT_RENOTIFY_COOLDOWN_MINUTES`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/compliance/monitoring/config.ts`

## `COMPLIANCE_EVIDENCE_TYPES`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/app/api/compliance/controls/[id]/evidence/route.ts`, `src/app/api/compliance/evidence/route.ts`

## `COMPLIANCE_MONITOR_INTERVAL_MINUTES`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/compliance/monitoring/config.ts`

## `COMPLIANCE_MONITORING_ENABLED`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/compliance/monitoring/config.ts`

## `CONTENT_WIDTH`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/status-pages/reports/uptime-report-generator.ts`

## `CORS_ALLOWED_ORIGINS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/middleware.ts`

## `CSRF_TOKEN_COOKIE_NAME`

- Required: no or conditionally required
- Secret: yes
- Scope: runtime
- Static default: not displayed
- Sources: `src/lib/auth.ts`

## `CUSTOM_FIELD_ORDER_LOCK`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/app/api/settings/custom-fields/route.ts`

## `DATABASE_POOL_SIZE`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/prisma.ts`

## `DATABASE_POOL_SIZE_BULK_WORKER`

- Required: no or conditionally required
- Secret: no
- Scope: deployment, runtime
- Static default: `3`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`, `deploy/swarm/docker-stack.yml`, `src/lib/prisma.ts`

## `DATABASE_POOL_SIZE_CRITICAL_WORKER`

- Required: no or conditionally required
- Secret: no
- Scope: deployment, runtime
- Static default: `5`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`, `deploy/swarm/docker-stack.yml`, `src/lib/prisma.ts`

## `DATABASE_POOL_SIZE_GENERAL_WORKER`

- Required: no or conditionally required
- Secret: no
- Scope: deployment, runtime
- Static default: `5`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`, `deploy/swarm/docker-stack.yml`, `src/lib/prisma.ts`

## `DATABASE_POOL_SIZE_INTEGRATED`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/prisma.ts`

## `DATABASE_POOL_SIZE_SCHEDULER`

- Required: no or conditionally required
- Secret: no
- Scope: deployment, runtime
- Static default: `3`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`, `deploy/swarm/docker-stack.yml`, `src/lib/prisma.ts`

## `DATABASE_POOL_SIZE_STATUS_PROJECTOR`

- Required: no or conditionally required
- Secret: no
- Scope: deployment, runtime
- Static default: `3`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`, `deploy/swarm/docker-stack.yml`, `src/lib/prisma.ts`

## `DATABASE_POOL_SIZE_WEB`

- Required: no or conditionally required
- Secret: no
- Scope: deployment, runtime
- Static default: `10`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`, `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`, `src/lib/prisma.ts`

## `DATABASE_POOL_SIZE_WORKER`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/prisma.ts`

## `DATABASE_URL`

- Required: no or conditionally required
- Secret: yes
- Scope: deployment, runtime
- Static default: not displayed
- Sources: `deploy/kubernetes/helm/opsknight/templates/deployment.yaml`, `deploy/kubernetes/helm/opsknight/templates/migration-job.yaml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `deploy/kubernetes/kustomize/profiles/integrated/deployment.yaml`, `deploy/kubernetes/kustomize/profiles/split-pgbouncer/web-database-patch.yaml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`, `src/app/(app)/settings/system/page.tsx`, `src/components/DatabaseOffline.tsx`, `src/lib/prisma-datasource.ts`

## `DEFAULT_LIMIT`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/app/(public)/logs/LogsClient.tsx`

## `DIRECT_DATABASE_URL`

- Required: no or conditionally required
- Secret: yes
- Scope: deployment
- Static default: not displayed
- Sources: `deploy/compose/docker-compose.external-db.yml`, `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/helm/opsknight/templates/migration-job.yaml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `deploy/kubernetes/kustomize/profiles/integrated/deployment.yaml`, `deploy/kubernetes/kustomize/profiles/split-pgbouncer/web-database-patch.yaml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`

## `DOC_TOPICS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/app/(app)/help/page.tsx`

## `EMAIL_FROM`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/env-validation.ts`

## `ENABLE_INTERNAL_CRON`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/app/api/health/route.ts`, `src/lib/admin-health.ts`, `src/lib/cron-scheduler.ts`

## `ENCRYPTION_KEY`

- Required: no or conditionally required
- Secret: yes
- Scope: deployment, runtime
- Static default: not displayed
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/kubernetes/helm/opsknight/templates/deployment.yaml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `src/app/(app)/settings/system/page.tsx`, `src/lib/__tests__/encryption.test.ts`, `src/lib/admin-health.ts`, `src/lib/encryption.ts`, `src/lib/env-validation.ts`

## `ENCRYPTION_KEYS`

- Required: no or conditionally required
- Secret: yes
- Scope: runtime
- Static default: not displayed
- Sources: `src/app/(app)/settings/system/page.tsx`, `src/lib/admin-health.ts`, `src/lib/encryption.ts`, `src/lib/env-validation.ts`

## `ENCRYPTION_TARGETS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/compliance/evaluators/encryption.ts`

## `ESCALATION_LOCK_TIMEOUT_MS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/config.ts`

## `EVENT_TRANSACTION_MAX_ATTEMPTS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/config.ts`

## `EXTERNAL_DB_HOST`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: none discovered
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.external-db.integrated.yml`, `deploy/swarm/docker-stack.external-db.yml`

## `EXTERNAL_DB_NAME`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `${POSTGRES_DB:-opsknight_db`, `opsknight_db`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.external-db.integrated.yml`, `deploy/swarm/docker-stack.external-db.yml`

## `EXTERNAL_DB_PASSWORD`

- Required: no or conditionally required
- Secret: yes
- Scope: deployment
- Static default: not displayed
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`

## `EXTERNAL_DB_PORT`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `5432`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.external-db.integrated.yml`, `deploy/swarm/docker-stack.external-db.yml`

## `EXTERNAL_DB_USER`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `${POSTGRES_USER:-opsknight`, `opsknight`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.external-db.integrated.yml`, `deploy/swarm/docker-stack.external-db.yml`

## `FADE_MS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/components/auth/HelloGreeting.tsx`

## `FAQS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/app/(app)/help/page.tsx`

## `GIT_COMMIT_SHA`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/version.ts`

## `GITHUB_SHA`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/version.ts`

## `IMAGE_DIGEST`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/version.ts`

## `INTEGRATED_REPLICAS`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `1`
- Sources: `deploy/swarm/docker-stack.integrated.yml`

## `INTEGRATION_RATE_LIMIT`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/integrations/handler.ts`

## `INTEGRATION_VERIFY_SIGNATURES`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/app/api/integrations/github/route.ts`, `src/app/api/integrations/grafana/route.ts`, `src/app/api/integrations/sentry/route.ts`, `src/lib/integrations/handler.ts`

## `INTERNAL_API_BASE`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/middleware.ts`

## `INTERNAL_API_URL`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/middleware.ts`

## `JIRA_REQUEST_TIMEOUT_MS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/jira.ts`

## `JSON`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/app/api/events/stream/route.ts`, `src/app/api/sla/stream/route.ts`, `src/app/api/widgets/stream/route.ts`, `src/lib/idempotency.ts`, `src/lib/logger.ts`, `src/lib/status-pages/publication-policy.ts`

## `KEY_PREFIX`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/mobile-cache.ts`

## `LOCK_TIMEOUT_MS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/cron-scheduler.ts`

## `LOG_BUFFER_MAX`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: `500`
- Sources: `src/lib/logger.ts`

## `LOG_FORMAT`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/logger.ts`

## `LOG_LEVEL`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/logger.ts`

## `MARGIN_X`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/status-pages/reports/uptime-report-generator.ts`

## `MAX_ARRAY_LENGTH`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/compliance/evidence/validate.ts`

## `MAX_BATCH_SIZE`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/incidents/lifecycle.ts`

## `MAX_DAYS_PER_CALL`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/app/api/admin/rollups/backfill/route.ts`

## `MAX_DEDUP_KEY_LENGTH`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/incidents/creation.ts`

## `MAX_ESCALATION_DELAY_MINUTES`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/escalation/policy-validation.ts`

## `MAX_EVENT_MESSAGE_LENGTH`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/incidents/lifecycle.ts`

## `MAX_EVIDENCE_DRAFTS_PER_EVALUATION`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/compliance/evidence/validate.ts`

## `MAX_HISTORICAL_DAYS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/compliance/export/validation.ts`

## `MAX_IDEMPOTENCY_KEY_LENGTH`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/idempotency.ts`

## `MAX_INTEGRATION_BODY_BYTES`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/integrations/request-security.ts`

## `MAX_METADATA_BYTES`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/compliance/evidence/validate.ts`

## `MAX_METADATA_DEPTH`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/compliance/evidence/validate.ts`

## `MAX_RECONNECT_ATTEMPTS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/components/dashboard/WidgetProvider.tsx`

## `MAX_RESOLUTION_LENGTH`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/components/incident/ResolveIncidentModal.tsx`

## `MAX_RESOLUTION_NOTE_LENGTH`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/incidents/lifecycle.ts`

## `MAX_RESPONSE_BODY_BYTES`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/webhooks.ts`

## `MAX_SELECTED_CONTROLS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/compliance/export/validation.ts`

## `MAX_SNOOZE_REASON_LENGTH`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/incidents/lifecycle.ts`

## `MAX_STRING_LENGTH`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/compliance/evidence/validate.ts`

## `MICROSOFT_TEAMS_APPLICATION_ID_URI`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/app/(app)/settings/integrations/microsoft-teams/page.tsx`, `src/app/api/microsoft-teams/package/route.ts`

## `MICROSOFT_TEAMS_INCLUDE_OPTIONAL_RSC`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/app/(app)/settings/integrations/microsoft-teams/page.tsx`

## `MICROSOFT_TEAMS_VALID_DOMAINS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/app/(app)/settings/integrations/microsoft-teams/page.tsx`, `src/app/api/microsoft-teams/package/route.ts`

## `MIN_CLEAN_SHADOW_CHECKS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/app/(app)/settings/incident-sla/actions.ts`

## `MIN_RESOLUTION_NOTE_LENGTH`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/incidents/lifecycle.ts`

## `MOBILE_CACHE_PREFIX`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/mobile-cache-status.ts`, `src/lib/mobile-cache.principal-isolation.test.tsx`, `src/lib/mobile-cache.ts`

## `NEXT_PHASE`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/instrumentation.ts`, `src/lib/cron-scheduler.ts`

## `NEXT_PUBLIC_APP_URL`

- Required: no or conditionally required
- Secret: no
- Scope: deployment, runtime
- Static default: `http://localhost:3000`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`, `src/app/(app)/services/[id]/page.tsx`, `src/app/(app)/settings/system/page.tsx`, `src/app/api/settings/app-url/route.ts`, `src/app/api/slack/oauth/callback/route.ts`, `src/app/robots.ts`, `src/app/setup/actions.ts`, `src/app/setup/page.tsx`, `src/lib/admin-health.ts`, `src/lib/app-url.ts`, `src/lib/auth-cookies.ts`, `src/lib/auth-public-origin.ts`, `src/lib/email-components.ts`, `src/lib/env-validation.ts`, `src/lib/notification-providers.ts`, `src/lib/request-host.ts`, `src/lib/status-page-resolver.ts`, `src/lib/status-pages/status-auth.ts`, `src/middleware.ts`

## `NEXT_PUBLIC_APP_VERSION`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/version.ts`

## `NEXT_PUBLIC_ENABLE_WEB_VITALS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/components/WebVitalsReporter.tsx`

## `NEXT_PUBLIC_SOURCE_CODE_URL`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/components/LegalSourceNotice.tsx`

## `NEXT_PUBLIC_VAPID_PUBLIC_KEY`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/app/api/system/vapid-public-key/route.ts`, `src/lib/push.ts`

## `NEXT_RUNTIME`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/instrumentation.ts`

## `NEXTAUTH_COOKIE_SECURE`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/auth-cookies.ts`, `src/lib/request-host.ts`

## `NEXTAUTH_SECRET`

- Required: no or conditionally required
- Secret: yes
- Scope: deployment, runtime
- Static default: not displayed
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/kubernetes/helm/opsknight/templates/deployment.yaml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `src/app/(app)/settings/system/page.tsx`, `src/lib/secret-manager.ts`, `src/lib/user-notification-endpoints.ts`, `src/lib/voice/token.ts`

## `NEXTAUTH_URL`

- Required: no or conditionally required
- Secret: no
- Scope: deployment, runtime
- Static default: `http://localhost:3000`, `localhost`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`, `src/app/(app)/services/[id]/page.tsx`, `src/app/(app)/settings/system/page.tsx`, `src/app/api/prefer-desktop/route.ts`, `src/app/api/settings/app-url/route.ts`, `src/app/api/slack/oauth/callback/route.ts`, `src/app/setup/actions.ts`, `src/app/setup/page.tsx`, `src/lib/admin-health.ts`, `src/lib/app-config.ts`, `src/lib/app-url.ts`, `src/lib/auth-cookies.ts`, `src/lib/auth-public-origin.ts`, `src/lib/email-components.ts`, `src/lib/env-validation.ts`, `src/lib/notification-providers.ts`, `src/lib/request-host.ts`, `src/lib/sla-breach-monitor.ts`, `src/lib/status-page-resolver.ts`, `src/lib/status-pages/status-auth.ts`, `src/middleware.ts`

## `NODE_ENV`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: `development`
- Sources: `src/app/(app)/settings/system/page.tsx`, `src/app/api/health/route.ts`, `src/app/api/jira/webhook/route.ts`, `src/app/api/microsoft-teams/messages/route.ts`, `src/app/api/search/route.ts`, `src/app/api/slack/oauth/route.ts`, `src/app/providers.tsx`, `src/app/setup/page.tsx`, `src/components/DashboardRealtimeWrapper.tsx`, `src/components/WebVitalsReporter.tsx`, `src/components/ui/ErrorBoundary.tsx`, `src/lib/admin-health.ts`, `src/lib/api-keys.ts`, `src/lib/app-url.ts`, `src/lib/auth-cookies.ts`, `src/lib/auth-public-origin.ts`, `src/lib/encryption.ts`, `src/lib/env-validation.ts`, `src/lib/incident-collaboration/meeting-store.ts`, `src/lib/logger.ts`, `src/lib/microsoft-teams/auth.ts`, `src/lib/monitoring/sentry.ts`, `src/lib/provider-admission.ts`, `src/lib/retention-policy.ts`, `src/lib/secret-manager.ts`, `src/middleware.ts`

## `NONCE_COOKIE_NAME`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/auth.ts`

## `NOTIFICATION_AGING_FLOOR`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/notification-control-plane.ts`

## `NOTIFICATION_CONTROL_PLANE_PERSONAL`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `true`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `NOTIFICATION_CONTROL_PLANE_STRICT`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/app/api/health/route.ts`

## `NOTIFICATION_PROVIDER_FEEDBACK_SECRET`

- Required: no or conditionally required
- Secret: yes
- Scope: runtime
- Static default: not displayed
- Sources: `src/app/api/webhooks/notifications/provider-feedback/route.ts`

## `OIDC_CONFIG_CACHE_TTL_MS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: `5000`
- Sources: `src/lib/oidc-config.ts`

## `OIDC_CONFIG_RECORD_CACHE_TTL_MS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: `5000`
- Sources: `src/lib/oidc-config.ts`

## `OIDC_REQUIRE_EMAIL_VERIFIED_STRICT`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: `true`
- Sources: `src/lib/auth.ts`

## `OPSKNIGHT_CUSTOM_CA_SECRET`

- Required: no or conditionally required
- Secret: yes
- Scope: deployment
- Static default: not displayed
- Sources: `deploy/swarm/docker-stack.ca.integrated.yml`, `deploy/swarm/docker-stack.ca.split.yml`, `deploy/swarm/docker-stack.pgbouncer-ca.yml`

## `OPSKNIGHT_DATABASE_URL`

- Required: yes
- Secret: yes
- Scope: deployment
- Static default: not displayed
- Sources: `deploy/compose/docker-compose.external-db.yml`, `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`

## `OPSKNIGHT_DATABASE_URL_SECRET`

- Required: no or conditionally required
- Secret: yes
- Scope: deployment
- Static default: not displayed
- Sources: `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `OPSKNIGHT_DEPLOYMENT_ID`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/version.ts`

## `OPSKNIGHT_DIRECT_DATABASE_URL_SECRET`

- Required: no or conditionally required
- Secret: yes
- Scope: deployment
- Static default: not displayed
- Sources: `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `OPSKNIGHT_ENCRYPTION_KEY_SECRET`

- Required: no or conditionally required
- Secret: yes
- Scope: deployment
- Static default: not displayed
- Sources: `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `OPSKNIGHT_IMAGE`

- Required: yes
- Secret: no
- Scope: deployment
- Static default: `ghcr.io/opsknight-labs/opsknight:1.4.0-hotfix`, `ghcr.io/opsknight-labs/opsknight:latest`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `OPSKNIGHT_NEXTAUTH_SECRET_SECRET`

- Required: no or conditionally required
- Secret: yes
- Scope: deployment
- Static default: not displayed
- Sources: `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `OPSKNIGHT_PGBOUNCER_DB_PASSWORD_SECRET`

- Required: no or conditionally required
- Secret: yes
- Scope: deployment
- Static default: not displayed
- Sources: `deploy/swarm/docker-stack.pgbouncer.yml`

## `OPSKNIGHT_PGBOUNCER_IMAGE`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `ghcr.io/opsknight-labs/opsknight-pgbouncer:1.26.0`
- Sources: `deploy/swarm/docker-stack.pgbouncer.yml`

## `OPSKNIGHT_PGBOUNCER_USERLIST_SECRET`

- Required: no or conditionally required
- Secret: yes
- Scope: deployment
- Static default: not displayed
- Sources: `deploy/swarm/docker-stack.pgbouncer.yml`

## `OPSKNIGHT_PROCESS_ROLE`

- Required: no or conditionally required
- Secret: no
- Scope: deployment, runtime
- Static default: none discovered
- Sources: `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`, `src/lib/runtime-role.ts`

## `OPSKNIGHT_PROCESS_ROLES`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/runtime-role.ts`

## `OPSKNIGHT_PULL_POLICY`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `always`
- Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_SCHEDULER_PROFILE`

- Required: no or conditionally required
- Secret: no
- Scope: deployment, runtime
- Static default: none discovered
- Sources: `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`, `src/lib/runtime-role.ts`

## `OPSKNIGHT_SCHEDULER_PROFILES`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/runtime-role.ts`

## `OPSKNIGHT_SKIP_MIGRATIONS`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: none discovered
- Sources: `deploy/kubernetes/helm/opsknight/templates/deployment.yaml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`

## `OPSKNIGHT_WEB_DATABASE_URL_SECRET`

- Required: no or conditionally required
- Secret: yes
- Scope: deployment
- Static default: not displayed
- Sources: `deploy/swarm/docker-stack.pgbouncer.yml`

## `OPSKNIGHT_WORKER_BATCH_SIZE`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `100`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`

## `OPSKNIGHT_WORKER_BATCH_SIZE_BULK`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `100`
- Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_BATCH_SIZE_CRITICAL`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `50`
- Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_BATCH_SIZE_PROJECTOR`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `100`
- Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_BUSY_POLL_MS`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `100`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`

## `OPSKNIGHT_WORKER_BUSY_POLL_MS_BULK`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `100`
- Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_BUSY_POLL_MS_CRITICAL`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `100`
- Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_BUSY_POLL_MS_PROJECTOR`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `100`
- Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_CONCURRENCY`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `15`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`

## `OPSKNIGHT_WORKER_CONCURRENCY_BULK`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `15`
- Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_CONCURRENCY_CRITICAL`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `10`
- Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_CONCURRENCY_PROJECTOR`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `15`
- Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_ID`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/notification-control-plane.ts`, `src/lib/provider-admission.ts`

## `OPSKNIGHT_WORKER_IDLE_POLL_MS`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `1000`
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`

## `OPSKNIGHT_WORKER_IDLE_POLL_MS_BULK`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `1000`
- Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_IDLE_POLL_MS_CRITICAL`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `1000`
- Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_IDLE_POLL_MS_PROJECTOR`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `1000`
- Sources: `deploy/compose/docker-compose.split.yml`

## `PAGE_HEIGHT`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/status-pages/reports/uptime-report-generator.ts`

## `PAGE_WIDTH`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/status-pages/reports/uptime-report-generator.ts`

## `PANEL_GLOBE_WIDTH`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/components/auth/LoginAnimation.tsx`

## `PASSWORD_MAX_LENGTH`

- Required: no or conditionally required
- Secret: yes
- Scope: runtime
- Static default: not displayed
- Sources: `src/lib/__tests__/passwords.test.ts`, `src/lib/password-strength.ts`, `src/lib/passwords.ts`

## `PASSWORD_MAX_UTF8_BYTES`

- Required: no or conditionally required
- Secret: yes
- Scope: runtime
- Static default: not displayed
- Sources: `src/lib/password-strength.ts`, `src/lib/passwords.ts`

## `PASSWORD_MIN_LENGTH`

- Required: no or conditionally required
- Secret: yes
- Scope: runtime
- Static default: not displayed
- Sources: `src/lib/__tests__/passwords.test.ts`, `src/lib/password-strength.ts`, `src/lib/passwords.ts`

## `PGBOUNCER_DB_HOST`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `${EXTERNAL_DB_HOST:-`, `opsknight-db`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`

## `PGBOUNCER_DB_NAME`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `${EXTERNAL_DB_NAME:-${POSTGRES_DB:-opsknight_db`, `opsknight_db`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`

## `PGBOUNCER_DB_PASSWORD`

- Required: no or conditionally required
- Secret: yes
- Scope: deployment
- Static default: not displayed
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`

## `PGBOUNCER_DB_PASSWORD_FILE`

- Required: no or conditionally required
- Secret: yes
- Scope: deployment
- Static default: not displayed
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`

## `PGBOUNCER_DB_PORT`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `${EXTERNAL_DB_PORT:-5432`, `5432`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`

## `PGBOUNCER_DB_USER`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `${EXTERNAL_DB_USER:-${POSTGRES_USER:-opsknight`, `opsknight`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`

## `PGBOUNCER_DEFAULT_POOL_SIZE`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `10`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`

## `PGBOUNCER_IMAGE`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `ghcr.io/icoretech/pgbouncer-docker:1.26.0@sha256:f6537e614011f3d95349847fdd47f1b3a96be86eab99015b5b5918f732884a75`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`

## `PGBOUNCER_MAX_CLIENT_CONN`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `1000`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`

## `PGBOUNCER_POOL_MODE`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `transaction`
- Sources: `deploy/swarm/docker-stack.pgbouncer.yml`

## `PGBOUNCER_RESERVE_POOL_SIZE`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `5`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`

## `PGBOUNCER_SERVER_TLS_CA_FILE`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: none discovered
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`

## `PGBOUNCER_SERVER_TLS_SSLMODE`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `disable`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`

## `PGBOUNCER_TLS_CA_CERT`

- Required: yes
- Secret: no
- Scope: deployment
- Static default: none discovered
- Sources: `deploy/compose/docker-compose.pgbouncer-ca.yml`

## `PGDATA`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: none discovered
- Sources: `deploy/kubernetes/helm/opsknight/templates/postgres-statefulset.yaml`, `deploy/kubernetes/kustomize/base/postgres-statefulset.yaml`

## `PKCE_CODE_VERIFIER_COOKIE_NAME`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/auth.ts`

## `PORT`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/middleware.ts`

## `POSTGRES_DB`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `opsknight_db`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/kubernetes/helm/opsknight/templates/postgres-statefulset.yaml`, `deploy/kubernetes/kustomize/base/postgres-statefulset.yaml`, `deploy/swarm/docker-stack.db.yml`

## `POSTGRES_INITDB_ARGS`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: none discovered
- Sources: `deploy/kubernetes/helm/opsknight/templates/postgres-statefulset.yaml`, `deploy/kubernetes/kustomize/base/postgres-statefulset.yaml`

## `POSTGRES_PASSWORD`

- Required: no or conditionally required
- Secret: yes
- Scope: deployment
- Static default: not displayed
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/kubernetes/helm/opsknight/templates/postgres-statefulset.yaml`, `deploy/kubernetes/kustomize/base/postgres-statefulset.yaml`, `deploy/swarm/docker-stack.db.yml`

## `POSTGRES_PORT`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `5432`
- Sources: `deploy/compose/docker-compose.yml`

## `POSTGRES_USER`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `opsknight`
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/kubernetes/helm/opsknight/templates/postgres-statefulset.yaml`, `deploy/kubernetes/kustomize/base/postgres-statefulset.yaml`, `deploy/swarm/docker-stack.db.yml`

## `PRISMA_SLOW_QUERY_MS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: `500`
- Sources: `src/lib/prisma.ts`

## `PROMETHEUS_SCRAPE_TOKEN`

- Required: no or conditionally required
- Secret: yes
- Scope: deployment, runtime
- Static default: not displayed
- Sources: `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/kubernetes/helm/opsknight/templates/deployment.yaml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `src/app/api/health/deep/route.ts`, `src/app/api/metrics/route.ts`

## `RECENT_DISPLAY_DAYS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/components/status-page/v3/IncidentsV3.tsx`

## `REDIRECT_TO_CANONICAL_HOST`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/middleware.ts`

## `RENDER_GIT_COMMIT`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/version.ts`

## `RESERVED_PREFIX`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/microsoft-teams/delivery.ts`

## `REVOKED_PLATFORM_PREFIX`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/session-registry.ts`

## `ROW_HEIGHT`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/status-pages/reports/uptime-report-generator.ts`

## `SCHEDULER_HEALTH_MAX_INTERVAL_SECONDS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/app/api/health/route.ts`

## `SCIM_BEARER_TOKEN`

- Required: no or conditionally required
- Secret: yes
- Scope: runtime
- Static default: not displayed
- Sources: `src/lib/scim.ts`

## `SENTRY_DSN`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/monitoring/sentry.ts`

## `SENTRY_ENVIRONMENT`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/monitoring/sentry.ts`

## `SENTRY_FORCE_ENABLE`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/monitoring/sentry.ts`

## `SERVICE_WAR_ROOM_POLICY_PREFIX`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/incident-collaboration/policy.ts`

## `SESSION_ACTIVITY_THROTTLE_MS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: `120000`
- Sources: `src/lib/session-registry.ts`

## `SESSION_DEVICE_PREFIX`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/session-registry.ts`

## `SESSION_PLATFORM_PREFIX`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/session-registry.ts`

## `SESSION_SECURITY_CACHE_TTL_MS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: `5000`
- Sources: `src/lib/session-security-projection.ts`

## `SESSION_TOKEN_COOKIE_NAME`

- Required: no or conditionally required
- Secret: yes
- Scope: runtime
- Static default: not displayed
- Sources: `src/lib/auth.ts`

## `SETUP_SECRET`

- Required: no or conditionally required
- Secret: yes
- Scope: runtime
- Static default: not displayed
- Sources: `src/app/setup/actions.ts`, `src/app/setup/page.tsx`

## `SINGLETON_ID`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/cron-scheduler.ts`

## `SKIP_ENV_VALIDATION`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/env-validation.ts`

## `SLA_ALERT_EMAIL`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/sla-breach-monitor.ts`

## `SLACK_BOT_TOKEN`

- Required: no or conditionally required
- Secret: yes
- Scope: runtime
- Static default: not displayed
- Sources: `src/lib/slack.ts`

## `SLACK_CLIENT_ID`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: `workspace-credentials`
- Sources: `src/app/(app)/settings/slack-oauth/actions.ts`, `src/app/api/slack/oauth/callback/route.ts`, `src/app/api/slack/oauth/route.ts`

## `SLACK_CLIENT_SECRET`

- Required: no or conditionally required
- Secret: yes
- Scope: runtime
- Static default: not displayed
- Sources: `src/app/(app)/settings/slack-oauth/actions.ts`, `src/app/api/slack/oauth/callback/route.ts`, `src/app/api/slack/oauth/route.ts`

## `SLACK_REDIRECT_URI`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/app/api/slack/oauth/callback/route.ts`, `src/app/api/slack/oauth/route.ts`

## `SLACK_RESPONSE_ORIGIN`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/slack-signature.ts`

## `SLACK_SIGNING_SECRET`

- Required: no or conditionally required
- Secret: yes
- Scope: runtime
- Static default: not displayed
- Sources: `src/app/(app)/settings/integrations/slack/page.tsx`, `src/lib/slack-signature.ts`

## `SLACK_WEBHOOK_URL`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/slack.ts`

## `SOURCE_VERSION`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/version.ts`

## `STATE_COOKIE_NAME`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/auth.ts`

## `STATUS_BADGE_CLASS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/components/settings/privacy/PrivacyRequestsBoard.tsx`

## `STATUS_PAGE_ANNOUNCEMENT_FANOUT_V1`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/app/api/settings/status-page/announcements/route.ts`

## `STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/app/api/settings/status-page/announcements/route.ts`

## `STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2_PENDING`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/app/api/settings/status-page/announcements/route.ts`

## `STATUS_PAGE_DOMAIN_CACHE_TTL`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/middleware.ts`

## `STATUS_PAGE_EXTERNAL_SERVING_STORE`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/middleware.ts`

## `STATUS_PAGE_LIFECYCLE_LOCK`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/status-pages/admin.ts`

## `STATUS_PAGE_PUBLIC_CSS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/status-page-preview-css.ts`

## `STATUS_PAGE_SERVING_STORE_TOKEN`

- Required: no or conditionally required
- Secret: yes
- Scope: runtime
- Static default: not displayed
- Sources: `src/lib/status-pages/serving-store.ts`, `src/middleware.ts`

## `STATUS_PAGE_SERVING_STORE_URL`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/status-pages/serving-store.ts`, `src/middleware.ts`

## `STATUS_PAGE_SNAPSHOT_MAX_BYTES`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/status-pages/snapshot.ts`

## `STATUS_PAGE_SURFACE_CLASS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/status-pages/public-css.ts`

## `STATUS_PAGE_SYNC_PUBLISH_BUDGET_MS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/status-pages/publish-configuration.ts`

## `STATUS_SESSION_COOKIE_NAME`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/app/status-auth/callback/route.ts`

## `STORAGE_KEY_PREFIX`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/components/DashboardWidgetToggle.tsx`

## `STORAGE_PREFIX`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/mobile-principal-state.ts`

## `SWARM_NETWORK_NAME`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `opsknight`
- Sources: `deploy/swarm/docker-stack.db.yml`, `deploy/swarm/docker-stack.external-db.integrated.yml`, `deploy/swarm/docker-stack.external-db.yml`, `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`, `deploy/swarm/docker-stack.yml`

## `SWARM_REPLICAS_BULK_WORKER`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `2`
- Sources: `deploy/swarm/docker-stack.yml`

## `SWARM_REPLICAS_CRITICAL_WORKER`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `2`
- Sources: `deploy/swarm/docker-stack.yml`

## `SWARM_REPLICAS_GENERAL_WORKER`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `2`
- Sources: `deploy/swarm/docker-stack.yml`

## `SWARM_REPLICAS_SCHEDULER`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `2`
- Sources: `deploy/swarm/docker-stack.yml`

## `SWARM_REPLICAS_STATUS_PROJECTOR`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `2`
- Sources: `deploy/swarm/docker-stack.yml`

## `SWARM_REPLICAS_WEB`

- Required: no or conditionally required
- Secret: no
- Scope: deployment
- Static default: `2`
- Sources: `deploy/swarm/docker-stack.yml`

## `TILE_W`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/components/auth/LoginAnimation.tsx`

## `TRUST_PROXY_HEADERS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/request-host.ts`, `src/middleware.ts`

## `TRUSTED_PROXY_HOPS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/client-ip.ts`

## `TRUSTED_PWA_SESSION_DAYS`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/pwa-session-policy.ts`

## `VAPID_PRIVATE_KEY`

- Required: no or conditionally required
- Secret: yes
- Scope: runtime
- Static default: not displayed
- Sources: `src/lib/push.ts`

## `VAPID_SUBJECT`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: `mailto:admin@localhost`
- Sources: `src/lib/push.ts`

## `VERCEL_GIT_COMMIT_SHA`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/version.ts`

## `VITEST`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/provider-admission.ts`

## `VITEST_USE_REAL_DB`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/incident-collaboration/meeting-store.ts`

## `VITEST_WORKER_ID`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/provider-admission.ts`

## `VOICE_CALLBACK_SIGNING_SECRET`

- Required: no or conditionally required
- Secret: yes
- Scope: runtime
- Static default: not displayed
- Sources: `src/lib/voice/token.ts`

## `WEB_DATABASE_URL`

- Required: no or conditionally required
- Secret: yes
- Scope: deployment, runtime
- Static default: not displayed
- Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/compose/docker-compose.split.yml`, `src/lib/prisma-datasource.ts`

## `WORKER_ID`

- Required: no or conditionally required
- Secret: no
- Scope: runtime
- Static default: none discovered
- Sources: `src/lib/cron-scheduler.ts`, `src/lib/provider-admission.ts`

