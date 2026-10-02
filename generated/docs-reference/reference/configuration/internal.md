---
title: Internal and tooling configuration inventory
description: Discovered build, test, documentation, and implementation variables that are not supported deployment configuration.
type: reference
product_area: configuration
audience: [developer, operator, administrator]
verification:
  level: source
  verified_at: 2026-10-02
  evidence:
    - src/
    - scripts/
    - tests/
---

# Internal and tooling configuration inventory

These names were discovered in source, build, test, or documentation tooling
but are not exposed by the supported deployment manifests or environment
template. They are inventory, not a normal production configuration contract.

## `ALLOWED_VERSIONS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/sync-docs-to-website.sh`

## `APP_HOST_ALIASES`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/middleware.ts`

## `APP_VERSION`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/components/Sidebar.tsx`, `src/lib/admin-health.ts`, `src/lib/version.ts`

## `AUTH_OPTIONS_CACHE_TTL_MS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `5000`
- Sources: `src/lib/auth.ts`

## `AUTH_TRUST_HOST`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/auth.ts`

## `AUTO_DISMISS_TIMEOUT_MS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/components/layout/GlobalIncidentBanner.tsx`

## `AWS_ACCESS_KEY_ID`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/email.ts`

## `BASE_APP_VERSION`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/constants.ts`

## `BASE_URL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `http://localhost:3000`
- Sources: `scripts/test-integrations.cjs`, `scripts/test-integrations.ts`

## `BOOTSTRAP_SECRET`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `src/app/setup/actions.ts`, `src/app/setup/page.tsx`

## `BUILD_DIR`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: build-time web bundle
- Deployment support: build
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `.next`
- Sources: `next.config.ts`

## `BUSINESS_HOURS_END`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/sla-server.ts`

## `BUSINESS_HOURS_START`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/sla-server.ts`

## `CALLBACK_URL_COOKIE_NAME`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/auth.ts`

## `CLAIM_TIMEOUT_MS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/notification-control-plane.ts`

## `CLEANUP_MUTEX_KEY`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/data-cleanup.ts`

## `COMPLIANCE_DRIFT_NOTIFICATIONS_ENABLED`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `false`
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: none discovered
- Sources: `src/lib/compliance/monitoring/config.ts`

## `COMPLIANCE_DRIFT_RENOTIFY_COOLDOWN_MINUTES`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/compliance/monitoring/config.ts`

## `COMPLIANCE_EVIDENCE_TYPES`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/app/api/compliance/controls/[id]/evidence/route.ts`, `src/app/api/compliance/evidence/route.ts`

## `COMPLIANCE_MONITOR_INTERVAL_MINUTES`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/compliance/monitoring/config.ts`

## `COMPLIANCE_MONITORING_ENABLED`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `false`
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: none discovered
- Sources: `src/lib/compliance/monitoring/config.ts`

## `COMPOSE_LOG`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/soak-test-2h.sh`

## `COMPOSE_PORT`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/soak-test-2h.sh`

## `COMPOSE_URL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `http://127.0.0.1:33000`
- Sources: `scripts/multi-stage-load-test-25m.js`, `scripts/single-image-load-test-10m.js`

## `CONTENT_WIDTH`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/status-pages/reports/uptime-report-generator.ts`

## `CORS_ALLOWED_ORIGINS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/middleware.ts`

## `CSRF_TOKEN_COOKIE_NAME`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `src/lib/auth.ts`

## `CUSTOM_FIELD_ORDER_LOCK`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/app/api/settings/custom-fields/route.ts`

## `DATABASE_POOL_SIZE`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/prisma.ts`

## `DATABASE_POOL_SIZE_INTEGRATED`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/prisma.ts`

## `DATABASE_POOL_SIZE_WORKER`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/prisma.ts`

## `DEFAULT_LIMIT`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/app/(public)/logs/LogsClient.tsx`

## `DEGRADED`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/components/settings/microsoft-teams/WarRoomOperationsSection.tsx`

## `DISABLE_PWA`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `true`
- Secret: no
- Runtime roles: build-time web bundle
- Deployment support: build
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: none discovered
- Sources: `next.config.ts`

## `DOC_TOPICS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/app/(app)/help/page.tsx`

## `DOCS_BASE_URL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/docs/run-kubernetes-journeys.sh`

## `DOCS_DATABASE_URL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `scripts/docs/run-kubernetes-journeys.sh`

## `DOCS_EXPECTED_PRODUCT_REVISION`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/docs/certify.mjs`

## `DOCS_EXTERNAL_RUNTIME`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/docs/run-kubernetes-journeys.sh`

## `DOCS_IMAGE_PULL_POLICY`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `always`
- Sources: `scripts/docs/serve-test-image.sh`

## `DOCS_IMPACT_BASE`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `HEAD~1`
- Sources: `scripts/docs/check-impact.mjs`

## `DOCS_IMPACT_STRICT`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `true`
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: none discovered
- Sources: `scripts/docs/check-impact.mjs`

## `DOCS_OPSKNIGHT_IMAGE`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/docs/certify.mjs`

## `DOCS_SITE_BASE_URL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `http://127.0.0.1:15000`
- Sources: `scripts/docs/certify.mjs`, `scripts/docs/crawl-rendered-site.mjs`

## `DOCS_SITE_VERSION`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `v2.0.0`
- Sources: `scripts/docs/crawl-rendered-site.mjs`

## `DOCS_SYNC_INCLUDE_UPCOMING`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `true`
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: none discovered
- Sources: `scripts/sync-docs-to-website.sh`

## `DOCS_WEBSITE_DIR`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/docs/certify.mjs`, `scripts/docs/crawl-rendered-site.mjs`

## `DURATION_SECONDS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/soak-test-2h.sh`

## `ELAPSED`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/soak-test-2h.sh`

## `EMAIL_FROM`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/env-validation.ts`

## `ENABLE_INTERNAL_CRON`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `false`
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: none discovered
- Sources: `src/app/api/health/route.ts`, `src/lib/admin-health.ts`, `src/lib/cron-scheduler.ts`

## `ENCRYPTION_TARGETS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/compliance/evaluators/encryption.ts`

## `END_TIME`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/soak-test-2h.sh`

## `ESCALATION_LOCK_TIMEOUT_MS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/config.ts`

## `EVENT_TRANSACTION_MAX_ATTEMPTS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/config.ts`

## `EXPECTED_INCIDENTS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/perf/dashboard-benchmark.ts`

## `FADE_MS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/components/auth/HelloGreeting.tsx`

## `FAQS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/app/(app)/help/page.tsx`

## `GIT_COMMIT_SHA`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/version.ts`

## `GITHUB_REF_NAME`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/validate-release-tag.cjs`

## `GITHUB_SHA`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/docs/discover-capabilities.mjs`, `src/lib/version.ts`

## `IMAGE_DIGEST`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/version.ts`

## `INCIDENT_COUNT`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/perf/dashboard-seed.ts`

## `INSTALL_LOCK_ID`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/create-status-platform-online-indexes.cjs`

## `INTEGRATION_RATE_LIMIT`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `false`
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: none discovered
- Sources: `src/lib/integrations/handler.ts`

## `INTEGRATION_VERIFY_SIGNATURES`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `false`
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: none discovered
- Sources: `src/app/api/integrations/github/route.ts`, `src/app/api/integrations/grafana/route.ts`, `src/app/api/integrations/sentry/route.ts`, `src/lib/integrations/handler.ts`

## `INTERNAL_API_BASE`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/middleware.ts`

## `INTERNAL_API_URL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/middleware.ts`

## `INTERVAL_SECONDS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/soak-test-2h.sh`

## `JIRA_REQUEST_TIMEOUT_MS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/jira.ts`

## `JSON`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/compliance/validate-sbom.mjs`, `scripts/docs/audit-reader-completeness.mjs`, `scripts/docs/certify.mjs`, `scripts/docs/crawl-rendered-site.mjs`, `scripts/docs/discover-capabilities.mjs`, `scripts/docs/generate-capacity-reference.mjs`, `scripts/docs/generate-integrations.mjs`, `scripts/docs/generate-route-contract.mjs`, `scripts/test-integrations.ts`, `src/app/api/events/stream/route.ts`, `src/app/api/sla/stream/route.ts`, `src/app/api/widgets/stream/route.ts`, `src/lib/idempotency.ts`, `src/lib/logger.ts`, `src/lib/status-pages/publication-policy.ts`

## `KEY_PREFIX`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/mobile-cache.ts`

## `KIND_LOG`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/soak-test-2h.sh`

## `KIND_PORT`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/soak-test-2h.sh`

## `KIND_URL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `http://127.0.0.1:30080`
- Sources: `scripts/multi-stage-load-test-25m.js`, `scripts/single-image-load-test-10m.js`

## `LATEST_RELEASE_TAG`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/validate-release-tag.cjs`

## `LOCK_ID`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/create-sla-scheduler-online-index.cjs`, `scripts/create-voice-attempt-online-indexes.cjs`

## `LOCK_TIMEOUT_MS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/cron-scheduler.ts`

## `LOG_BUFFER_MAX`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `500`
- Sources: `src/lib/logger.ts`

## `LOG_DIR`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/soak-test-2h.sh`

## `LOG_FORMAT`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/logger.ts`

## `LOG_LEVEL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/logger.ts`

## `MARGIN_X`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/status-pages/reports/uptime-report-generator.ts`

## `MAX_ARRAY_LENGTH`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/compliance/evidence/validate.ts`

## `MAX_BATCH_SIZE`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/incidents/lifecycle.ts`

## `MAX_DAYS_PER_CALL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/app/api/admin/rollups/backfill/route.ts`

## `MAX_DEDUP_KEY_LENGTH`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/incidents/creation.ts`

## `MAX_ESCALATION_DELAY_MINUTES`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/escalation/policy-validation.ts`

## `MAX_EVENT_MESSAGE_LENGTH`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/incidents/lifecycle.ts`

## `MAX_EVIDENCE_DRAFTS_PER_EVALUATION`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/compliance/evidence/validate.ts`

## `MAX_HISTORICAL_DAYS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/compliance/export/validation.ts`

## `MAX_IDEMPOTENCY_KEY_LENGTH`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/idempotency.ts`

## `MAX_INTEGRATION_BODY_BYTES`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/integrations/request-security.ts`

## `MAX_METADATA_BYTES`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/compliance/evidence/validate.ts`

## `MAX_METADATA_DEPTH`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/compliance/evidence/validate.ts`

## `MAX_RECONNECT_ATTEMPTS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/components/dashboard/WidgetProvider.tsx`

## `MAX_RESOLUTION_LENGTH`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/components/incident/ResolveIncidentModal.tsx`

## `MAX_RESOLUTION_NOTE_LENGTH`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/incidents/lifecycle.ts`

## `MAX_RESPONSE_BODY_BYTES`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/webhooks.ts`

## `MAX_SELECTED_CONTROLS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/compliance/export/validation.ts`

## `MAX_SNOOZE_REASON_LENGTH`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/incidents/lifecycle.ts`

## `MAX_STRING_LENGTH`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/compliance/evidence/validate.ts`

## `METRICS_CSV`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/multi-stage-load-test-25m.js`, `scripts/single-image-load-test-10m.js`

## `METRICS_FILE`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/soak-test-2h.sh`

## `MICROSOFT_TEAMS_APPLICATION_ID_URI`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/app/(app)/settings/integrations/microsoft-teams/page.tsx`, `src/app/api/microsoft-teams/package/route.ts`

## `MICROSOFT_TEAMS_INCLUDE_OPTIONAL_RSC`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `1`
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: none discovered
- Sources: `src/app/(app)/settings/integrations/microsoft-teams/page.tsx`

## `MICROSOFT_TEAMS_VALID_DOMAINS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/app/(app)/settings/integrations/microsoft-teams/page.tsx`, `src/app/api/microsoft-teams/package/route.ts`

## `MIGRATION_RECOVERY_MODE`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `aggressive`
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: none discovered
- Sources: `scripts/auto-recover-migrations.ts`

## `MIN_CLEAN_SHADOW_CHECKS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/app/(app)/settings/incident-sla/actions.ts`

## `MIN_RESOLUTION_NOTE_LENGTH`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/incidents/lifecycle.ts`

## `MOBILE_CACHE_PREFIX`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/mobile-cache-status.ts`, `src/lib/mobile-cache.principal-isolation.test.tsx`, `src/lib/mobile-cache.ts`

## `NEXT_PHASE`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `phase-production-build`
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: none discovered
- Sources: `src/instrumentation.ts`, `src/lib/cron-scheduler.ts`

## `NEXT_PUBLIC_APP_VERSION`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/version.ts`

## `NEXT_PUBLIC_ENABLE_WEB_VITALS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/components/WebVitalsReporter.tsx`

## `NEXT_PUBLIC_SOURCE_CODE_URL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/components/LegalSourceNotice.tsx`

## `NEXT_PUBLIC_VAPID_PUBLIC_KEY`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/notification-providers.ts`

## `NEXT_RUNTIME`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `edge`
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: none discovered
- Sources: `src/instrumentation.ts`

## `NEXTAUTH_COOKIE_SECURE`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `false`
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: none discovered
- Sources: `src/lib/auth-cookies.ts`, `src/lib/request-host.ts`

## `NODE_ENV`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `development`, `production`, `test`
- Secret: no
- Runtime roles: build-time web bundle
- Deployment support: build
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `development`
- Sources: `next.config.ts`, `src/app/(app)/settings/system/page.tsx`, `src/app/api/health/route.ts`, `src/app/api/jira/webhook/route.ts`, `src/app/api/microsoft-teams/messages/route.ts`, `src/app/api/search/route.ts`, `src/app/api/slack/oauth/route.ts`, `src/app/providers.tsx`, `src/app/setup/page.tsx`, `src/components/DashboardRealtimeWrapper.tsx`, `src/components/DatabaseOffline.tsx`, `src/components/WebVitalsReporter.tsx`, `src/components/ui/ErrorBoundary.tsx`, `src/lib/admin-health.ts`, `src/lib/api-keys.ts`, `src/lib/app-url.ts`, `src/lib/auth-cookies.ts`, `src/lib/auth-public-origin.ts`, `src/lib/encryption.ts`, `src/lib/env-validation.ts`, `src/lib/incident-collaboration/meeting-store.ts`, `src/lib/logger.ts`, `src/lib/microsoft-teams/auth.ts`, `src/lib/monitoring/sentry.ts`, `src/lib/provider-admission.ts`, `src/lib/retention-policy.ts`, `src/lib/secret-manager.ts`, `src/middleware.ts`

## `NONCE_COOKIE_NAME`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/auth.ts`

## `NOTIFICATION_AGING_FLOOR`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/notification-control-plane.ts`

## `NOTIFICATION_CONTROL_PLANE_STRICT`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `true`
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: none discovered
- Sources: `src/app/api/health/route.ts`

## `NOTIFICATION_PROVIDER_FEEDBACK_SECRET`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `src/app/api/webhooks/notifications/provider-feedback/route.ts`

## `NOW`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/soak-test-2h.sh`

## `OIDC_CONFIG_RECORD_CACHE_TTL_MS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `5000`
- Sources: `src/lib/oidc-config.ts`

## `OPSKNIGHT_DEPLOYMENT_ID`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/version.ts`

## `OPSKNIGHT_LOAD_TEST_ALLOW_HOSTS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/network-security.ts`

## `OPSKNIGHT_PROCESS_ROLES`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/runtime-role.ts`

## `OPSKNIGHT_SCHEDULER_PROFILES`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/runtime-role.ts`

## `OPSKNIGHT_TX_MAX_ATTEMPTS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/db-utils.ts`

## `OPSKNIGHT_TX_MAX_ATTEMPTS_HIGH_LOAD`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/db-utils.ts`

## `OPSKNIGHT_TX_MAX_WAIT_MS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/db-utils.ts`

## `OPSKNIGHT_TX_TIMEOUT_MS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/db-utils.ts`

## `OPSKNIGHT_WORKER_ID`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/notification-control-plane.ts`, `src/lib/provider-admission.ts`

## `PAGE_HEIGHT`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/status-pages/reports/uptime-report-generator.ts`

## `PAGE_WIDTH`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/status-pages/reports/uptime-report-generator.ts`

## `PANEL_GLOBE_WIDTH`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/components/auth/LoginAnimation.tsx`

## `PASSWORD_MAX_LENGTH`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `src/lib/__tests__/passwords.test.ts`, `src/lib/password-strength.ts`, `src/lib/passwords.ts`

## `PASSWORD_MAX_UTF8_BYTES`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `src/lib/password-strength.ts`, `src/lib/passwords.ts`

## `PASSWORD_MIN_LENGTH`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `src/lib/__tests__/passwords.test.ts`, `src/lib/password-strength.ts`, `src/lib/passwords.ts`

## `PERF_SEED_CONFIRM`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/perf/dashboard-seed.ts`

## `PERF_SERVICE_ID`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/perf/dashboard-benchmark.ts`

## `PKCE_CODE_VERIFIER_COOKIE_NAME`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/auth.ts`

## `PORT`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/middleware.ts`

## `PRISMA_SLOW_QUERY_MS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `500`
- Sources: `src/lib/prisma.ts`

## `RECENT_DISPLAY_DAYS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/components/status-page/v3/IncidentsV3.tsx`

## `REDIRECT_TO_CANONICAL_HOST`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `false`
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: none discovered
- Sources: `src/middleware.ts`

## `RENDER_GIT_COMMIT`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/version.ts`

## `RESERVED_PREFIX`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/microsoft-teams/delivery.ts`

## `REVOKED_PLATFORM_PREFIX`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/session-registry.ts`

## `ROOT_DIR`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/sync-docs-to-website.sh`

## `ROW_HEIGHT`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/status-pages/reports/uptime-report-generator.ts`

## `SBOM_SOURCE_REF`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/compliance/validate-sbom.mjs`

## `SBOM_SOURCE_SHA`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/compliance/validate-sbom.mjs`

## `SCHEDULER_HEALTH_MAX_INTERVAL_SECONDS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/app/api/health/route.ts`

## `SENTRY_DSN`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/monitoring/sentry.ts`

## `SENTRY_ENVIRONMENT`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/monitoring/sentry.ts`

## `SENTRY_FORCE_ENABLE`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `true`
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: none discovered
- Sources: `src/lib/monitoring/sentry.ts`

## `SERVICE_WAR_ROOM_POLICY_PREFIX`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/incident-collaboration/policy.ts`

## `SESSION_ACTIVITY_THROTTLE_MS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `120000`
- Sources: `src/lib/session-registry.ts`

## `SESSION_DEVICE_PREFIX`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/session-registry.ts`

## `SESSION_PLATFORM_PREFIX`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/session-registry.ts`

## `SESSION_SECURITY_CACHE_TTL_MS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `5000`
- Sources: `src/lib/session-security-projection.ts`

## `SESSION_TOKEN_COOKIE_NAME`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `src/lib/auth.ts`

## `SETUP_SECRET`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `src/app/setup/actions.ts`, `src/app/setup/page.tsx`

## `SINGLE_COMPOSE_URL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `http://127.0.0.1:34000`
- Sources: `scripts/single-image-load-test-10m.js`

## `SINGLE_KIND_URL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `http://127.0.0.1:34080`
- Sources: `scripts/single-image-load-test-10m.js`

## `SINGLETON_ID`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/cron-scheduler.ts`

## `SKIP_ENV_VALIDATION`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/env-validation.ts`

## `SLA_ALERT_EMAIL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/sla-breach-monitor.ts`

## `SLACK_CLIENT_ID`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `workspace-credentials`
- Sources: `src/app/(app)/settings/slack-oauth/actions.ts`, `src/app/api/slack/oauth/callback/route.ts`, `src/app/api/slack/oauth/route.ts`

## `SLACK_REDIRECT_URI`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/app/api/slack/oauth/callback/route.ts`, `src/app/api/slack/oauth/route.ts`

## `SLACK_RESPONSE_ORIGIN`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/slack-signature.ts`

## `SLACK_WEBHOOK_URL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/slack.ts`

## `SOAK_DURATION_SECONDS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `7200`
- Sources: `scripts/soak-test-2h.sh`

## `SOAK_INTERVAL_SECONDS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `60`
- Sources: `scripts/soak-test-2h.sh`

## `SOAK_LOG_DIR`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `./artifacts/soak-test`
- Sources: `scripts/soak-test-2h.sh`

## `SOURCE_VERSION`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/version.ts`

## `SRC_DIR`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/sync-docs-to-website.sh`

## `START_TIME`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/soak-test-2h.sh`

## `STATE_COOKIE_NAME`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/auth.ts`

## `STATUS_BADGE_CLASS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/components/settings/privacy/PrivacyRequestsBoard.tsx`

## `STATUS_PAGE_ANNOUNCEMENT_FANOUT_V1`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/app/api/settings/status-page/announcements/route.ts`

## `STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/app/api/settings/status-page/announcements/route.ts`

## `STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2_PENDING`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/app/api/settings/status-page/announcements/route.ts`

## `STATUS_PAGE_DOMAIN_CACHE_TTL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/middleware.ts`

## `STATUS_PAGE_EXTERNAL_SERVING_STORE`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `true`
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: none discovered
- Sources: `src/middleware.ts`

## `STATUS_PAGE_LIFECYCLE_LOCK`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/status-pages/admin.ts`

## `STATUS_PAGE_PUBLIC_CSS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/status-page-preview-css.ts`

## `STATUS_PAGE_SERVING_STORE_TOKEN`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `src/lib/status-pages/serving-store.ts`, `src/middleware.ts`

## `STATUS_PAGE_SERVING_STORE_URL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/status-pages/serving-store.ts`, `src/middleware.ts`

## `STATUS_PAGE_SNAPSHOT_MAX_BYTES`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/status-pages/snapshot.ts`

## `STATUS_PAGE_SURFACE_CLASS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/status-pages/public-css.ts`

## `STATUS_PAGE_SYNC_PUBLISH_BUDGET_MS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/status-pages/publish-configuration.ts`

## `STATUS_SESSION_COOKIE_NAME`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/app/status-auth/callback/route.ts`

## `STORAGE_KEY_PREFIX`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/components/DashboardWidgetToggle.tsx`

## `STORAGE_PREFIX`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/mobile-principal-state.ts`

## `SUMMARY_FILE`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/soak-test-2h.sh`

## `SUMMARY_MD`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/multi-stage-load-test-25m.js`, `scripts/single-image-load-test-10m.js`

## `TEAMS_E2E_DESTINATION_ID`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/ci/microsoft-teams-live-smoke.mjs`

## `TEAMS_E2E_INCIDENT_ID`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/ci/microsoft-teams-live-smoke.mjs`

## `TEAMS_E2E_MESSAGE_GENERATION`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `1`
- Sources: `scripts/ci/microsoft-teams-live-smoke.mjs`

## `TILE_W`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/components/auth/LoginAnimation.tsx`

## `TIMESTAMP`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/soak-test-2h.sh`

## `TOTAL_DURATION_SEC`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/multi-stage-load-test-25m.js`, `scripts/single-image-load-test-10m.js`

## `TRUSTED_PWA_SESSION_DAYS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/pwa-session-policy.ts`

## `VAPID_PRIVATE_KEY`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: not displayed
- Sources: `src/lib/notification-providers.ts`

## `VAPID_SUBJECT`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/notification-providers.ts`

## `VERCEL_GIT_COMMIT_SHA`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/version.ts`

## `VERSIONS_FILE`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/sync-docs-to-website.sh`

## `VITEST`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `true`
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: none discovered
- Sources: `src/lib/provider-admission.ts`

## `VITEST_USE_REAL_DB`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `1`
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: none discovered
- Sources: `src/lib/incident-collaboration/meeting-store.ts`

## `VITEST_WORKER_ID`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/provider-admission.ts`

## `WEBSITE_DIR`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `scripts/sync-docs-to-website.sh`

## `WORKER_ID`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: incomplete
- Static default: none discovered
- Sources: `src/lib/cron-scheduler.ts`, `src/lib/provider-admission.ts`

