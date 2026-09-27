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
and deployment manifests. Presence is not proof that a variable is required or
safe to change; consult its source locations for parsing, defaults, and scope.

## `API_KEY_SECRET`

Sources: `src/lib/api-keys.ts`

## `APP_HOST_ALIASES`

Sources: `src/middleware.ts`

## `APP_PORT`

Sources: `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `APP_VERSION`

Sources: `src/components/Sidebar.tsx`, `src/lib/admin-health.ts`, `src/lib/version.ts`

## `AUTH_BREAK_GLASS_EMAIL`

Sources: `src/lib/local-auth-policy.ts`

## `AUTH_BREAK_GLASS_ENABLED`

Sources: `src/lib/local-auth-policy.ts`

## `AUTH_LOCAL_LOGIN_ENABLED`

Sources: `src/lib/local-auth-policy.ts`

## `AUTH_OPTIONS_CACHE_TTL_MS`

Sources: `src/lib/auth.ts`

## `AUTH_SSO_REAUTH_AFTER_SECONDS`

Sources: `src/lib/local-auth-policy.ts`

## `AUTH_SSO_SESSION_IDLE_TIMEOUT_SECONDS`

Sources: `src/lib/local-auth-policy.ts`

## `AUTH_SSO_SESSION_MAX_AGE_SECONDS`

Sources: `src/lib/local-auth-policy.ts`

## `AUTH_SSO_SESSION_UPDATE_AGE_SECONDS`

Sources: `src/lib/local-auth-policy.ts`

## `AUTH_TRUST_HOST`

Sources: `src/lib/auth.ts`

## `AWS_ACCESS_KEY_ID`

Sources: `src/lib/email.ts`

## `BASE_APP_VERSION`

Sources: `src/lib/constants.ts`

## `BOOTSTRAP_SECRET`

Sources: `src/app/setup/actions.ts`, `src/app/setup/page.tsx`

## `BUSINESS_HOURS_END`

Sources: `src/lib/sla-server.ts`

## `BUSINESS_HOURS_START`

Sources: `src/lib/sla-server.ts`

## `CALLBACK_URL_COOKIE_NAME`

Sources: `src/lib/auth.ts`

## `CLAIM_TIMEOUT_MS`

Sources: `src/lib/notification-control-plane.ts`

## `CLEANUP_MUTEX_KEY`

Sources: `src/lib/data-cleanup.ts`

## `COMPLIANCE_DRIFT_NOTIFICATIONS_ENABLED`

Sources: `src/lib/compliance/monitoring/config.ts`

## `COMPLIANCE_DRIFT_RENOTIFY_COOLDOWN_MINUTES`

Sources: `src/lib/compliance/monitoring/config.ts`

## `COMPLIANCE_EVIDENCE_TYPES`

Sources: `src/app/api/compliance/controls/[id]/evidence/route.ts`, `src/app/api/compliance/evidence/route.ts`

## `COMPLIANCE_MONITOR_INTERVAL_MINUTES`

Sources: `src/lib/compliance/monitoring/config.ts`

## `COMPLIANCE_MONITORING_ENABLED`

Sources: `src/lib/compliance/monitoring/config.ts`

## `CONTENT_WIDTH`

Sources: `src/lib/status-pages/reports/uptime-report-generator.ts`

## `CORS_ALLOWED_ORIGINS`

Sources: `src/middleware.ts`

## `CSRF_TOKEN_COOKIE_NAME`

Sources: `src/lib/auth.ts`

## `CUSTOM_FIELD_ORDER_LOCK`

Sources: `src/app/api/settings/custom-fields/route.ts`

## `DATABASE_POOL_SIZE`

Sources: `src/lib/prisma.ts`

## `DATABASE_POOL_SIZE_BULK_WORKER`

Sources: `src/lib/prisma.ts`, `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`, `deploy/swarm/docker-stack.yml`

## `DATABASE_POOL_SIZE_CRITICAL_WORKER`

Sources: `src/lib/prisma.ts`, `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`, `deploy/swarm/docker-stack.yml`

## `DATABASE_POOL_SIZE_GENERAL_WORKER`

Sources: `src/lib/prisma.ts`, `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`, `deploy/swarm/docker-stack.yml`

## `DATABASE_POOL_SIZE_INTEGRATED`

Sources: `src/lib/prisma.ts`

## `DATABASE_POOL_SIZE_SCHEDULER`

Sources: `src/lib/prisma.ts`, `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`, `deploy/swarm/docker-stack.yml`

## `DATABASE_POOL_SIZE_STATUS_PROJECTOR`

Sources: `src/lib/prisma.ts`, `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`, `deploy/swarm/docker-stack.yml`

## `DATABASE_POOL_SIZE_WEB`

Sources: `src/lib/prisma.ts`, `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`, `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `DATABASE_POOL_SIZE_WORKER`

Sources: `src/lib/prisma.ts`

## `DATABASE_URL`

Sources: `src/app/(app)/settings/system/page.tsx`, `src/components/DatabaseOffline.tsx`, `src/lib/prisma-datasource.ts`, `deploy/kubernetes/helm/opsknight/templates/deployment.yaml`, `deploy/kubernetes/helm/opsknight/templates/migration-job.yaml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `deploy/kubernetes/kustomize/profiles/integrated/deployment.yaml`, `deploy/kubernetes/kustomize/profiles/split-pgbouncer/web-database-patch.yaml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`

## `DEFAULT_LIMIT`

Sources: `src/app/(public)/logs/LogsClient.tsx`

## `DIRECT_DATABASE_URL`

Sources: `deploy/compose/docker-compose.external-db.yml`, `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/helm/opsknight/templates/migration-job.yaml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `deploy/kubernetes/kustomize/profiles/integrated/deployment.yaml`, `deploy/kubernetes/kustomize/profiles/split-pgbouncer/web-database-patch.yaml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`

## `DOC_TOPICS`

Sources: `src/app/(app)/help/page.tsx`

## `EMAIL_FROM`

Sources: `src/lib/env-validation.ts`

## `ENABLE_INTERNAL_CRON`

Sources: `src/app/api/health/route.ts`, `src/lib/admin-health.ts`, `src/lib/cron-scheduler.ts`

## `ENCRYPTION_KEY`

Sources: `src/app/(app)/settings/system/page.tsx`, `src/lib/__tests__/encryption.test.ts`, `src/lib/admin-health.ts`, `src/lib/encryption.ts`, `src/lib/env-validation.ts`, `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/kubernetes/helm/opsknight/templates/deployment.yaml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`

## `ENCRYPTION_KEYS`

Sources: `src/app/(app)/settings/system/page.tsx`, `src/lib/admin-health.ts`, `src/lib/encryption.ts`, `src/lib/env-validation.ts`

## `ENCRYPTION_TARGETS`

Sources: `src/lib/compliance/evaluators/encryption.ts`

## `ESCALATION_LOCK_TIMEOUT_MS`

Sources: `src/lib/config.ts`

## `EVENT_TRANSACTION_MAX_ATTEMPTS`

Sources: `src/lib/config.ts`

## `EXTERNAL_DB_HOST`

Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.external-db.integrated.yml`, `deploy/swarm/docker-stack.external-db.yml`

## `EXTERNAL_DB_NAME`

Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.external-db.integrated.yml`, `deploy/swarm/docker-stack.external-db.yml`

## `EXTERNAL_DB_PASSWORD`

Sources: `deploy/compose/docker-compose.pgbouncer.yml`

## `EXTERNAL_DB_PORT`

Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.external-db.integrated.yml`, `deploy/swarm/docker-stack.external-db.yml`

## `EXTERNAL_DB_USER`

Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.external-db.integrated.yml`, `deploy/swarm/docker-stack.external-db.yml`

## `FADE_MS`

Sources: `src/components/auth/HelloGreeting.tsx`

## `FAQS`

Sources: `src/app/(app)/help/page.tsx`

## `GIT_COMMIT_SHA`

Sources: `src/lib/version.ts`

## `GITHUB_SHA`

Sources: `src/lib/version.ts`

## `IMAGE_DIGEST`

Sources: `src/lib/version.ts`

## `INTEGRATED_REPLICAS`

Sources: `deploy/swarm/docker-stack.integrated.yml`

## `INTEGRATION_RATE_LIMIT`

Sources: `src/lib/integrations/handler.ts`

## `INTEGRATION_VERIFY_SIGNATURES`

Sources: `src/app/api/integrations/github/route.ts`, `src/app/api/integrations/grafana/route.ts`, `src/app/api/integrations/sentry/route.ts`, `src/lib/integrations/handler.ts`

## `INTERNAL_API_BASE`

Sources: `src/middleware.ts`

## `INTERNAL_API_URL`

Sources: `src/middleware.ts`

## `JIRA_REQUEST_TIMEOUT_MS`

Sources: `src/lib/jira.ts`

## `JSON`

Sources: `src/app/api/events/stream/route.ts`, `src/app/api/sla/stream/route.ts`, `src/app/api/widgets/stream/route.ts`, `src/lib/idempotency.ts`, `src/lib/logger.ts`, `src/lib/status-pages/publication-policy.ts`

## `KEY_PREFIX`

Sources: `src/lib/mobile-cache.ts`

## `LOCK_TIMEOUT_MS`

Sources: `src/lib/cron-scheduler.ts`

## `LOG_BUFFER_MAX`

Sources: `src/lib/logger.ts`

## `LOG_FORMAT`

Sources: `src/lib/logger.ts`

## `LOG_LEVEL`

Sources: `src/lib/logger.ts`

## `MARGIN_X`

Sources: `src/lib/status-pages/reports/uptime-report-generator.ts`

## `MAX_ARRAY_LENGTH`

Sources: `src/lib/compliance/evidence/validate.ts`

## `MAX_BATCH_SIZE`

Sources: `src/lib/incidents/lifecycle.ts`

## `MAX_DAYS_PER_CALL`

Sources: `src/app/api/admin/rollups/backfill/route.ts`

## `MAX_DEDUP_KEY_LENGTH`

Sources: `src/lib/incidents/creation.ts`

## `MAX_ESCALATION_DELAY_MINUTES`

Sources: `src/lib/escalation/policy-validation.ts`

## `MAX_EVENT_MESSAGE_LENGTH`

Sources: `src/lib/incidents/lifecycle.ts`

## `MAX_EVIDENCE_DRAFTS_PER_EVALUATION`

Sources: `src/lib/compliance/evidence/validate.ts`

## `MAX_HISTORICAL_DAYS`

Sources: `src/lib/compliance/export/validation.ts`

## `MAX_IDEMPOTENCY_KEY_LENGTH`

Sources: `src/lib/idempotency.ts`

## `MAX_INTEGRATION_BODY_BYTES`

Sources: `src/lib/integrations/request-security.ts`

## `MAX_METADATA_BYTES`

Sources: `src/lib/compliance/evidence/validate.ts`

## `MAX_METADATA_DEPTH`

Sources: `src/lib/compliance/evidence/validate.ts`

## `MAX_RECONNECT_ATTEMPTS`

Sources: `src/components/dashboard/WidgetProvider.tsx`

## `MAX_RESOLUTION_LENGTH`

Sources: `src/components/incident/ResolveIncidentModal.tsx`

## `MAX_RESOLUTION_NOTE_LENGTH`

Sources: `src/lib/incidents/lifecycle.ts`

## `MAX_RESPONSE_BODY_BYTES`

Sources: `src/lib/webhooks.ts`

## `MAX_SELECTED_CONTROLS`

Sources: `src/lib/compliance/export/validation.ts`

## `MAX_SNOOZE_REASON_LENGTH`

Sources: `src/lib/incidents/lifecycle.ts`

## `MAX_STRING_LENGTH`

Sources: `src/lib/compliance/evidence/validate.ts`

## `MICROSOFT_TEAMS_APPLICATION_ID_URI`

Sources: `src/app/(app)/settings/integrations/microsoft-teams/page.tsx`, `src/app/api/microsoft-teams/package/route.ts`

## `MICROSOFT_TEAMS_INCLUDE_OPTIONAL_RSC`

Sources: `src/app/(app)/settings/integrations/microsoft-teams/page.tsx`

## `MICROSOFT_TEAMS_VALID_DOMAINS`

Sources: `src/app/(app)/settings/integrations/microsoft-teams/page.tsx`, `src/app/api/microsoft-teams/package/route.ts`

## `MIN_CLEAN_SHADOW_CHECKS`

Sources: `src/app/(app)/settings/incident-sla/actions.ts`

## `MIN_RESOLUTION_NOTE_LENGTH`

Sources: `src/lib/incidents/lifecycle.ts`

## `MOBILE_CACHE_PREFIX`

Sources: `src/lib/mobile-cache-status.ts`, `src/lib/mobile-cache.principal-isolation.test.tsx`, `src/lib/mobile-cache.ts`

## `NEXT_PHASE`

Sources: `src/instrumentation.ts`, `src/lib/cron-scheduler.ts`

## `NEXT_PUBLIC_APP_URL`

Sources: `src/app/(app)/services/[id]/page.tsx`, `src/app/(app)/settings/system/page.tsx`, `src/app/api/settings/app-url/route.ts`, `src/app/api/slack/oauth/callback/route.ts`, `src/app/robots.ts`, `src/app/setup/actions.ts`, `src/app/setup/page.tsx`, `src/lib/admin-health.ts`, `src/lib/app-url.ts`, `src/lib/auth-cookies.ts`, `src/lib/auth-public-origin.ts`, `src/lib/email-components.ts`, `src/lib/env-validation.ts`, `src/lib/notification-providers.ts`, `src/lib/request-host.ts`, `src/lib/status-page-resolver.ts`, `src/lib/status-pages/status-auth.ts`, `src/middleware.ts`, `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `NEXT_PUBLIC_APP_VERSION`

Sources: `src/lib/version.ts`

## `NEXT_PUBLIC_ENABLE_WEB_VITALS`

Sources: `src/components/WebVitalsReporter.tsx`

## `NEXT_PUBLIC_SOURCE_CODE_URL`

Sources: `src/components/LegalSourceNotice.tsx`

## `NEXT_PUBLIC_VAPID_PUBLIC_KEY`

Sources: `src/app/api/system/vapid-public-key/route.ts`, `src/lib/push.ts`

## `NEXT_RUNTIME`

Sources: `src/instrumentation.ts`

## `NEXTAUTH_COOKIE_SECURE`

Sources: `src/lib/auth-cookies.ts`, `src/lib/request-host.ts`

## `NEXTAUTH_SECRET`

Sources: `src/app/(app)/settings/system/page.tsx`, `src/lib/secret-manager.ts`, `src/lib/user-notification-endpoints.ts`, `src/lib/voice/token.ts`, `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/kubernetes/helm/opsknight/templates/deployment.yaml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`

## `NEXTAUTH_URL`

Sources: `src/app/(app)/services/[id]/page.tsx`, `src/app/(app)/settings/system/page.tsx`, `src/app/api/prefer-desktop/route.ts`, `src/app/api/settings/app-url/route.ts`, `src/app/api/slack/oauth/callback/route.ts`, `src/app/setup/actions.ts`, `src/app/setup/page.tsx`, `src/lib/admin-health.ts`, `src/lib/app-config.ts`, `src/lib/app-url.ts`, `src/lib/auth-cookies.ts`, `src/lib/auth-public-origin.ts`, `src/lib/email-components.ts`, `src/lib/env-validation.ts`, `src/lib/notification-providers.ts`, `src/lib/request-host.ts`, `src/lib/sla-breach-monitor.ts`, `src/lib/status-page-resolver.ts`, `src/lib/status-pages/status-auth.ts`, `src/middleware.ts`, `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `NODE_ENV`

Sources: `src/app/(app)/settings/system/page.tsx`, `src/app/api/health/route.ts`, `src/app/api/jira/webhook/route.ts`, `src/app/api/microsoft-teams/messages/route.ts`, `src/app/api/search/route.ts`, `src/app/api/slack/oauth/route.ts`, `src/app/providers.tsx`, `src/app/setup/page.tsx`, `src/components/DashboardRealtimeWrapper.tsx`, `src/components/WebVitalsReporter.tsx`, `src/components/ui/ErrorBoundary.tsx`, `src/lib/admin-health.ts`, `src/lib/api-keys.ts`, `src/lib/app-url.ts`, `src/lib/auth-cookies.ts`, `src/lib/auth-public-origin.ts`, `src/lib/encryption.ts`, `src/lib/env-validation.ts`, `src/lib/incident-collaboration/meeting-store.ts`, `src/lib/logger.ts`, `src/lib/microsoft-teams/auth.ts`, `src/lib/monitoring/sentry.ts`, `src/lib/provider-admission.ts`, `src/lib/retention-policy.ts`, `src/lib/secret-manager.ts`, `src/middleware.ts`

## `NONCE_COOKIE_NAME`

Sources: `src/lib/auth.ts`

## `NOTIFICATION_AGING_FLOOR`

Sources: `src/lib/notification-control-plane.ts`

## `NOTIFICATION_CONTROL_PLANE_PERSONAL`

Sources: `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `NOTIFICATION_CONTROL_PLANE_STRICT`

Sources: `src/app/api/health/route.ts`

## `NOTIFICATION_PROVIDER_FEEDBACK_SECRET`

Sources: `src/app/api/webhooks/notifications/provider-feedback/route.ts`

## `OIDC_CONFIG_CACHE_TTL_MS`

Sources: `src/lib/oidc-config.ts`

## `OIDC_CONFIG_RECORD_CACHE_TTL_MS`

Sources: `src/lib/oidc-config.ts`

## `OIDC_REQUIRE_EMAIL_VERIFIED_STRICT`

Sources: `src/lib/auth.ts`

## `OPSKNIGHT_CUSTOM_CA_SECRET`

Sources: `deploy/swarm/docker-stack.ca.integrated.yml`, `deploy/swarm/docker-stack.ca.split.yml`, `deploy/swarm/docker-stack.pgbouncer-ca.yml`

## `OPSKNIGHT_DATABASE_URL`

Sources: `deploy/compose/docker-compose.external-db.yml`, `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`

## `OPSKNIGHT_DATABASE_URL_SECRET`

Sources: `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `OPSKNIGHT_DEPLOYMENT_ID`

Sources: `src/lib/version.ts`

## `OPSKNIGHT_DIRECT_DATABASE_URL_SECRET`

Sources: `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `OPSKNIGHT_ENCRYPTION_KEY_SECRET`

Sources: `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `OPSKNIGHT_IMAGE`

Sources: `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `OPSKNIGHT_NEXTAUTH_SECRET_SECRET`

Sources: `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.yml`

## `OPSKNIGHT_PGBOUNCER_DB_PASSWORD_SECRET`

Sources: `deploy/swarm/docker-stack.pgbouncer.yml`

## `OPSKNIGHT_PGBOUNCER_IMAGE`

Sources: `deploy/swarm/docker-stack.pgbouncer.yml`

## `OPSKNIGHT_PGBOUNCER_USERLIST_SECRET`

Sources: `deploy/swarm/docker-stack.pgbouncer.yml`

## `OPSKNIGHT_PROCESS_ROLE`

Sources: `src/lib/runtime-role.ts`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`

## `OPSKNIGHT_PROCESS_ROLES`

Sources: `src/lib/runtime-role.ts`

## `OPSKNIGHT_PULL_POLICY`

Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_SCHEDULER_PROFILE`

Sources: `src/lib/runtime-role.ts`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`

## `OPSKNIGHT_SCHEDULER_PROFILES`

Sources: `src/lib/runtime-role.ts`

## `OPSKNIGHT_SKIP_MIGRATIONS`

Sources: `deploy/kubernetes/helm/opsknight/templates/deployment.yaml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`

## `OPSKNIGHT_WEB_DATABASE_URL_SECRET`

Sources: `deploy/swarm/docker-stack.pgbouncer.yml`

## `OPSKNIGHT_WORKER_BATCH_SIZE`

Sources: `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`

## `OPSKNIGHT_WORKER_BATCH_SIZE_BULK`

Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_BATCH_SIZE_CRITICAL`

Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_BATCH_SIZE_PROJECTOR`

Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_BUSY_POLL_MS`

Sources: `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`

## `OPSKNIGHT_WORKER_BUSY_POLL_MS_BULK`

Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_BUSY_POLL_MS_CRITICAL`

Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_BUSY_POLL_MS_PROJECTOR`

Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_CONCURRENCY`

Sources: `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`

## `OPSKNIGHT_WORKER_CONCURRENCY_BULK`

Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_CONCURRENCY_CRITICAL`

Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_CONCURRENCY_PROJECTOR`

Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_ID`

Sources: `src/lib/notification-control-plane.ts`, `src/lib/provider-admission.ts`

## `OPSKNIGHT_WORKER_IDLE_POLL_MS`

Sources: `deploy/compose/docker-compose.split.yml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`, `deploy/kubernetes/kustomize/profiles/split/runtime-deployments.yaml`

## `OPSKNIGHT_WORKER_IDLE_POLL_MS_BULK`

Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_IDLE_POLL_MS_CRITICAL`

Sources: `deploy/compose/docker-compose.split.yml`

## `OPSKNIGHT_WORKER_IDLE_POLL_MS_PROJECTOR`

Sources: `deploy/compose/docker-compose.split.yml`

## `PAGE_HEIGHT`

Sources: `src/lib/status-pages/reports/uptime-report-generator.ts`

## `PAGE_WIDTH`

Sources: `src/lib/status-pages/reports/uptime-report-generator.ts`

## `PANEL_GLOBE_WIDTH`

Sources: `src/components/auth/LoginAnimation.tsx`

## `PASSWORD_MAX_LENGTH`

Sources: `src/lib/__tests__/passwords.test.ts`, `src/lib/password-strength.ts`, `src/lib/passwords.ts`

## `PASSWORD_MAX_UTF8_BYTES`

Sources: `src/lib/password-strength.ts`, `src/lib/passwords.ts`

## `PASSWORD_MIN_LENGTH`

Sources: `src/lib/__tests__/passwords.test.ts`, `src/lib/password-strength.ts`, `src/lib/passwords.ts`

## `PGBOUNCER_DB_HOST`

Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`

## `PGBOUNCER_DB_NAME`

Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`

## `PGBOUNCER_DB_PASSWORD`

Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`

## `PGBOUNCER_DB_PASSWORD_FILE`

Sources: `deploy/compose/docker-compose.pgbouncer.yml`

## `PGBOUNCER_DB_PORT`

Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`

## `PGBOUNCER_DB_USER`

Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`

## `PGBOUNCER_DEFAULT_POOL_SIZE`

Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`

## `PGBOUNCER_IMAGE`

Sources: `deploy/compose/docker-compose.pgbouncer.yml`

## `PGBOUNCER_MAX_CLIENT_CONN`

Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`

## `PGBOUNCER_POOL_MODE`

Sources: `deploy/swarm/docker-stack.pgbouncer.yml`

## `PGBOUNCER_RESERVE_POOL_SIZE`

Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`

## `PGBOUNCER_SERVER_TLS_CA_FILE`

Sources: `deploy/compose/docker-compose.pgbouncer.yml`

## `PGBOUNCER_SERVER_TLS_SSLMODE`

Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`

## `PGBOUNCER_TLS_CA_CERT`

Sources: `deploy/compose/docker-compose.pgbouncer-ca.yml`

## `PGDATA`

Sources: `deploy/kubernetes/helm/opsknight/templates/postgres-statefulset.yaml`, `deploy/kubernetes/kustomize/base/postgres-statefulset.yaml`

## `PKCE_CODE_VERIFIER_COOKIE_NAME`

Sources: `src/lib/auth.ts`

## `PORT`

Sources: `src/middleware.ts`

## `POSTGRES_DB`

Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/kubernetes/helm/opsknight/templates/postgres-statefulset.yaml`, `deploy/kubernetes/kustomize/base/postgres-statefulset.yaml`, `deploy/swarm/docker-stack.db.yml`

## `POSTGRES_INITDB_ARGS`

Sources: `deploy/kubernetes/helm/opsknight/templates/postgres-statefulset.yaml`, `deploy/kubernetes/kustomize/base/postgres-statefulset.yaml`

## `POSTGRES_PASSWORD`

Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/kubernetes/helm/opsknight/templates/postgres-statefulset.yaml`, `deploy/kubernetes/kustomize/base/postgres-statefulset.yaml`, `deploy/swarm/docker-stack.db.yml`

## `POSTGRES_PORT`

Sources: `deploy/compose/docker-compose.yml`

## `POSTGRES_USER`

Sources: `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/kubernetes/helm/opsknight/templates/postgres-statefulset.yaml`, `deploy/kubernetes/kustomize/base/postgres-statefulset.yaml`, `deploy/swarm/docker-stack.db.yml`

## `PRISMA_SLOW_QUERY_MS`

Sources: `src/lib/prisma.ts`

## `PROMETHEUS_SCRAPE_TOKEN`

Sources: `src/app/api/health/deep/route.ts`, `src/app/api/metrics/route.ts`, `deploy/compose/docker-compose.split.yml`, `deploy/compose/docker-compose.yml`, `deploy/kubernetes/helm/opsknight/templates/deployment.yaml`, `deploy/kubernetes/helm/opsknight/templates/split-deployments.yaml`

## `RECENT_DISPLAY_DAYS`

Sources: `src/components/status-page/v3/IncidentsV3.tsx`

## `REDIRECT_TO_CANONICAL_HOST`

Sources: `src/middleware.ts`

## `RENDER_GIT_COMMIT`

Sources: `src/lib/version.ts`

## `RESERVED_PREFIX`

Sources: `src/lib/microsoft-teams/delivery.ts`

## `REVOKED_PLATFORM_PREFIX`

Sources: `src/lib/session-registry.ts`

## `ROW_HEIGHT`

Sources: `src/lib/status-pages/reports/uptime-report-generator.ts`

## `SCHEDULER_HEALTH_MAX_INTERVAL_SECONDS`

Sources: `src/app/api/health/route.ts`

## `SCIM_BEARER_TOKEN`

Sources: `src/lib/scim.ts`

## `SENTRY_DSN`

Sources: `src/lib/monitoring/sentry.ts`

## `SENTRY_ENVIRONMENT`

Sources: `src/lib/monitoring/sentry.ts`

## `SENTRY_FORCE_ENABLE`

Sources: `src/lib/monitoring/sentry.ts`

## `SERVICE_WAR_ROOM_POLICY_PREFIX`

Sources: `src/lib/incident-collaboration/policy.ts`

## `SESSION_ACTIVITY_THROTTLE_MS`

Sources: `src/lib/session-registry.ts`

## `SESSION_DEVICE_PREFIX`

Sources: `src/lib/session-registry.ts`

## `SESSION_PLATFORM_PREFIX`

Sources: `src/lib/session-registry.ts`

## `SESSION_SECURITY_CACHE_TTL_MS`

Sources: `src/lib/session-security-projection.ts`

## `SESSION_TOKEN_COOKIE_NAME`

Sources: `src/lib/auth.ts`

## `SETUP_SECRET`

Sources: `src/app/setup/actions.ts`, `src/app/setup/page.tsx`

## `SINGLETON_ID`

Sources: `src/lib/cron-scheduler.ts`

## `SKIP_ENV_VALIDATION`

Sources: `src/lib/env-validation.ts`

## `SLA_ALERT_EMAIL`

Sources: `src/lib/sla-breach-monitor.ts`

## `SLACK_BOT_TOKEN`

Sources: `src/lib/slack.ts`

## `SLACK_CLIENT_ID`

Sources: `src/app/(app)/settings/slack-oauth/actions.ts`, `src/app/api/slack/oauth/callback/route.ts`, `src/app/api/slack/oauth/route.ts`

## `SLACK_CLIENT_SECRET`

Sources: `src/app/(app)/settings/slack-oauth/actions.ts`, `src/app/api/slack/oauth/callback/route.ts`, `src/app/api/slack/oauth/route.ts`

## `SLACK_REDIRECT_URI`

Sources: `src/app/api/slack/oauth/callback/route.ts`, `src/app/api/slack/oauth/route.ts`

## `SLACK_RESPONSE_ORIGIN`

Sources: `src/lib/slack-signature.ts`

## `SLACK_SIGNING_SECRET`

Sources: `src/app/(app)/settings/integrations/slack/page.tsx`, `src/lib/slack-signature.ts`

## `SLACK_WEBHOOK_URL`

Sources: `src/lib/slack.ts`

## `SOURCE_VERSION`

Sources: `src/lib/version.ts`

## `STATE_COOKIE_NAME`

Sources: `src/lib/auth.ts`

## `STATUS_BADGE_CLASS`

Sources: `src/components/settings/privacy/PrivacyRequestsBoard.tsx`

## `STATUS_PAGE_ANNOUNCEMENT_FANOUT_V1`

Sources: `src/app/api/settings/status-page/announcements/route.ts`

## `STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2`

Sources: `src/app/api/settings/status-page/announcements/route.ts`

## `STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2_PENDING`

Sources: `src/app/api/settings/status-page/announcements/route.ts`

## `STATUS_PAGE_DOMAIN_CACHE_TTL`

Sources: `src/middleware.ts`

## `STATUS_PAGE_EXTERNAL_SERVING_STORE`

Sources: `src/middleware.ts`

## `STATUS_PAGE_LIFECYCLE_LOCK`

Sources: `src/lib/status-pages/admin.ts`

## `STATUS_PAGE_PUBLIC_CSS`

Sources: `src/lib/status-page-preview-css.ts`

## `STATUS_PAGE_SERVING_STORE_TOKEN`

Sources: `src/lib/status-pages/serving-store.ts`, `src/middleware.ts`

## `STATUS_PAGE_SERVING_STORE_URL`

Sources: `src/lib/status-pages/serving-store.ts`, `src/middleware.ts`

## `STATUS_PAGE_SNAPSHOT_MAX_BYTES`

Sources: `src/lib/status-pages/snapshot.ts`

## `STATUS_PAGE_SURFACE_CLASS`

Sources: `src/lib/status-pages/public-css.ts`

## `STATUS_PAGE_SYNC_PUBLISH_BUDGET_MS`

Sources: `src/lib/status-pages/publish-configuration.ts`

## `STATUS_SESSION_COOKIE_NAME`

Sources: `src/app/status-auth/callback/route.ts`

## `STORAGE_KEY_PREFIX`

Sources: `src/components/DashboardWidgetToggle.tsx`

## `STORAGE_PREFIX`

Sources: `src/lib/mobile-principal-state.ts`

## `SWARM_NETWORK_NAME`

Sources: `deploy/swarm/docker-stack.db.yml`, `deploy/swarm/docker-stack.external-db.integrated.yml`, `deploy/swarm/docker-stack.external-db.yml`, `deploy/swarm/docker-stack.integrated.yml`, `deploy/swarm/docker-stack.pgbouncer.yml`, `deploy/swarm/docker-stack.yml`

## `SWARM_REPLICAS_BULK_WORKER`

Sources: `deploy/swarm/docker-stack.yml`

## `SWARM_REPLICAS_CRITICAL_WORKER`

Sources: `deploy/swarm/docker-stack.yml`

## `SWARM_REPLICAS_GENERAL_WORKER`

Sources: `deploy/swarm/docker-stack.yml`

## `SWARM_REPLICAS_SCHEDULER`

Sources: `deploy/swarm/docker-stack.yml`

## `SWARM_REPLICAS_STATUS_PROJECTOR`

Sources: `deploy/swarm/docker-stack.yml`

## `SWARM_REPLICAS_WEB`

Sources: `deploy/swarm/docker-stack.yml`

## `TILE_W`

Sources: `src/components/auth/LoginAnimation.tsx`

## `TRUST_PROXY_HEADERS`

Sources: `src/lib/request-host.ts`, `src/middleware.ts`

## `TRUSTED_PROXY_HOPS`

Sources: `src/lib/client-ip.ts`

## `TRUSTED_PWA_SESSION_DAYS`

Sources: `src/lib/pwa-session-policy.ts`

## `VAPID_PRIVATE_KEY`

Sources: `src/lib/push.ts`

## `VAPID_SUBJECT`

Sources: `src/lib/push.ts`

## `VERCEL_GIT_COMMIT_SHA`

Sources: `src/lib/version.ts`

## `VITEST`

Sources: `src/lib/provider-admission.ts`

## `VITEST_USE_REAL_DB`

Sources: `src/lib/incident-collaboration/meeting-store.ts`

## `VITEST_WORKER_ID`

Sources: `src/lib/provider-admission.ts`

## `VOICE_CALLBACK_SIGNING_SECRET`

Sources: `src/lib/voice/token.ts`

## `WEB_DATABASE_URL`

Sources: `src/lib/prisma-datasource.ts`, `deploy/compose/docker-compose.pgbouncer.yml`, `deploy/compose/docker-compose.split.yml`

## `WORKER_ID`

Sources: `src/lib/cron-scheduler.ts`, `src/lib/provider-admission.ts`

