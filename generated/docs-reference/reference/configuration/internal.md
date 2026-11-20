---
title: Internal and tooling configuration inventory
description: Discovered build, test, documentation, and implementation variables that are not supported deployment configuration.
type: reference
product_area: configuration
audience: [developer, operator, administrator]
verification:
  level: source
  verified_at: 2026-10-27
  evidence:
    - src/
    - scripts/
    - tests/
---

# Internal and tooling configuration inventory

These names were discovered in source, build, test, or documentation tooling
but are not exposed by the supported deployment manifests or environment
template. They are inventory, not a normal production configuration contract.

## `ACK_STATUS`

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
- Sources: `scripts/certification/drill-app-recovery.sh`

## `ACTUAL_SHA`

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
- Sources: `scripts/build-agent-artifacts.sh`

## `ADMIN_ROW`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `AGENT_NONCE_RETENTION_MS`

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
- Sources: `src/lib/runbooks/nonce-cleanup.ts`

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

## `API_BASE_URL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `http://127.0.0.1:3900/api/v2`
- Sources: `scripts/certification/test-continuous-operational-chain.ts`

## `API_CAPABILITY_CATALOG`

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
- Sources: `scripts/certification/verify-discovery.ts`

## `API_SCOPE_REGISTRY`

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
- Sources: `src/lib/api-v2/openapi-finalize.ts`

## `API_V2_ALLOW_NON_EXPIRING_TOKENS`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `false`
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: not displayed
- Sources: `src/lib/api-v2/service-accounts.ts`

## `API_V2_CURSOR_SECRET`

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
- Sources: `src/lib/api-v2/incident-diagnostics.ts`, `src/lib/api-v2/pagination.ts`

## `API_V2_TOKEN_MAX_DAYS`

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
- Sources: `src/lib/api-v2/service-accounts.ts`

## `APP_BASE_URL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `http://127.0.0.1:3900`
- Sources: `scripts/certification/certify-all-routes-browsers.ts`, `scripts/certification/test-continuous-operational-chain.ts`

## `APP_CONTAINER`

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
- Sources: `scripts/certification/drill-app-recovery.sh`, `scripts/certification/drill-rollback-rehearsal.sh`, `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `APP_START`

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
- Sources: `scripts/certification/drill-app-recovery.sh`

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

## `ARCH`

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
- Sources: `scripts/build-agent-artifacts.sh`

## `ARTIFACT_PURGE_BATCH_SIZE`

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
- Sources: `src/lib/runbooks/artifact-cleanup.ts`

## `AUTH_DIAGNOSTIC_DEADLINE_MS`

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
- Sources: `scripts/prepare-authentication-diagnostics.cjs`

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

## `BACKUP_DUMP`

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
- Sources: `scripts/certification/drill-app-recovery.sh`

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
- Sources: `scripts/certification/certify-all-routes-browsers.ts`, `scripts/fault-recovery-drill.ts`, `scripts/swarm-capacity-tester.ts`, `scripts/test-integrations.cjs`, `scripts/test-integrations.ts`

## `BASH_SOURCE`

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
- Sources: `scripts/build-agent-artifacts.sh`

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
- Sources: `src/app/setup/actions.ts`

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

## `CAPTURED`

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
- Sources: `scripts/backfill-automation-source-classification.cjs`

## `CERT_ADMIN_EMAIL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `cert-browser-admin@opsknight.internal`
- Sources: `scripts/certification/certify-all-routes-browsers.ts`

## `CERT_ADMIN_PASSWORD`

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
- Sources: `scripts/certification/certify-all-routes-browsers.ts`

## `CIPHER_PAYLOAD`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `CIRCUIT_BREAKER_FAIL_THRESHOLD`

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
- Sources: `src/lib/runbooks/presentation/summaries.ts`

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

## `CREATE_RESP`

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
- Sources: `scripts/certification/drill-app-recovery.sh`

## `CSRF_TOKEN`

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
- Sources: `scripts/certification/drill-app-recovery.sh`, `scripts/certification/drill-rollback-rehearsal.sh`, `scripts/certification/drill-upgrade-v20-to-v21.sh`

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

## `DASHBOARD_FIXTURE_PASSWORD`

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
- Sources: `scripts/dev/seed-dashboard-live.ts`

## `DASHBOARD_FIXTURE_PREFIX`

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
- Sources: `scripts/dev/seed-dashboard-live.ts`

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

## `DB_CONTAINER`

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
- Sources: `scripts/certification/drill-app-recovery.sh`, `scripts/certification/drill-rollback-rehearsal.sh`, `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `DB_NAME`

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
- Sources: `scripts/certification/drill-app-recovery.sh`, `scripts/certification/drill-rollback-rehearsal.sh`, `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `DB_PASS`

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
- Sources: `scripts/certification/drill-app-recovery.sh`, `scripts/certification/drill-rollback-rehearsal.sh`, `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `DB_PORT`

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
- Sources: `scripts/certification/drill-app-recovery.sh`, `scripts/certification/drill-rollback-rehearsal.sh`, `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `DB_USER`

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
- Sources: `scripts/certification/drill-app-recovery.sh`, `scripts/certification/drill-rollback-rehearsal.sh`, `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `DECRYPT_RESULT`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

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

## `DEFAULT_STEP_TIMEOUT_SECONDS`

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
- Sources: `src/components/runbooks/builder/StepEditor.tsx`

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

## `DISPOSABLE_CERT_TARGET`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `1`
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `0`
- Sources: `scripts/certification/certify-all-routes-browsers.ts`, `scripts/certification/drill-app-recovery.sh`, `scripts/certification/drill-rollback-rehearsal.sh`, `scripts/certification/drill-upgrade-v20-to-v21.sh`, `scripts/certification/test-continuous-operational-chain.ts`

## `DIST_DIR`

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
- Sources: `scripts/build-agent-artifacts.sh`

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

## `DOTENV_CONFIG_PATH`

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
- Sources: `scripts/certification/browser-setup.mjs`, `scripts/certification/certify-all-routes-browsers.ts`, `scripts/certification/certify-authorization-isolation.ts`, `scripts/certification/certify-multi-replica.ts`, `scripts/certification/certify-ui-api-state-parity.ts`, `scripts/certification/certify-ui-responsive.ts`, `scripts/certification/mint-key-pool.ts`, `scripts/certification/mint-limited-pool.ts`, `scripts/certification/reconcile-all-workflows.ts`, `scripts/certification/run-matrix-certification.ts`, `scripts/certification/seed-extended-fixtures.ts`, `scripts/certification/seed-fixtures.ts`, `scripts/certification/test-auth-flood-admission.ts`, `scripts/certification/test-continuous-operational-chain.ts`, `scripts/certification/test-create-status-page-live.ts`

## `DURATION`

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
- Sources: `scripts/sustained-ceiling-validator.ts`

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

## `ENC_INTEGRATIONS`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

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
- Sources: `scripts/certification/drill-app-recovery.sh`, `scripts/soak-test-2h.sh`

## `ERROR_TYPE_PREFIX`

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
- Sources: `src/lib/api-v2/response.ts`

## `ESBUILD_CMD`

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
- Sources: `scripts/build-agent-artifacts.sh`

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

## `EXPECTED_SHA`

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
- Sources: `scripts/build-agent-artifacts.sh`

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

## `FLEET_BASE_PATH`

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
- Sources: `src/components/runbooks/agents/fleet-routes.ts`

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

## `GITHUB_EVENT_NAME`

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
- Sources: `scripts/ci/runbook-change-gates.cjs`

## `GITHUB_EVENT_PATH`

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
- Sources: `scripts/ci/runbook-change-gates.cjs`

## `GITHUB_OUTPUT`

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
- Sources: `scripts/ci/runbook-change-gates.cjs`

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
- Sources: `src/lib/version.ts`

## `HUMAN_INTERVENTION_PREFIX`

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
- Sources: `src/lib/runbooks/recovery.ts`

## `IDEM_KEY`

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
- Sources: `scripts/certification/drill-app-recovery.sh`

## `IDEMPOTENCY_LABEL`

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
- Sources: `src/lib/api-v2/docs-render.ts`

## `IFS`

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
- Sources: `src/lib/runbooks/agent-setup-commands.ts`

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

## `INCIDENT_ID`

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
- Sources: `scripts/certification/drill-app-recovery.sh`

## `INCIDENT_NOT_OPEN`

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
- Sources: `src/lib/runbooks/orchestrator.ts`, `src/lib/runbooks/triggers.ts`

## `INCIDENT_ROW`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

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

## `INTEGRATION_KEY_ENC`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

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
- Sources: `src/app/api/events/route.ts`, `src/lib/integrations/handler.ts`

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
- Sources: `scripts/api-v2/generate-clients.ts`, `scripts/build-agent-release-manifest.mjs`, `scripts/certification/test-create-status-page-live.ts`, `scripts/certify-sso-upgrade.cjs`, `scripts/compliance/validate-sbom.mjs`, `scripts/test-integrations.ts`, `src/app/(app)/settings/system/scim-actions.ts`, `src/app/api/events/stream/route.ts`, `src/app/api/sla/stream/route.ts`, `src/app/api/widgets/stream/route.ts`, `src/components/settings/ApiExplorerPanel.tsx`, `src/lib/automation/diff.ts`, `src/lib/escalation/execution-health.ts`, `src/lib/escalation/job-query.ts`, `src/lib/idempotency.ts`, `src/lib/logger.ts`, `src/lib/runbooks/matcher.ts`, `src/lib/runbooks/pool-commands.ts`, `src/lib/runbooks/secret-usage.ts`, `src/lib/status-pages/publication-policy.ts`

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

## `KUBERNETES_SERVICE_HOST`

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
- Sources: `scripts/check-authentication-cutover.cjs`

## `KUBERNETES_SERVICE_PORT_HTTPS`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `443`
- Sources: `scripts/check-authentication-cutover.cjs`

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

## `LEGACY_NOTIFICATION_CLAIM_MS`

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
- Sources: `src/lib/notification-claim-lease.ts`

## `LIMITS`

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
- Sources: `src/components/automation/AutomationRules.tsx`, `src/components/automation/authoring/context-fields.tsx`

## `LOCATION`

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
- Sources: `scripts/certification/drill-app-recovery.sh`, `scripts/certification/drill-rollback-rehearsal.sh`, `scripts/certification/drill-upgrade-v20-to-v21.sh`

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
- Sources: `scripts/backfill-automation-source-classification.cjs`, `scripts/create-sla-scheduler-online-index.cjs`, `scripts/create-voice-attempt-online-indexes.cjs`, `scripts/prepare-authentication-diagnostics.cjs`

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

## `LOGIN_HEADERS`

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
- Sources: `scripts/certification/drill-app-recovery.sh`, `scripts/certification/drill-rollback-rehearsal.sh`, `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `LOGIN_STATUS`

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
- Sources: `scripts/certification/drill-app-recovery.sh`, `scripts/certification/drill-rollback-rehearsal.sh`, `scripts/certification/drill-upgrade-v20-to-v21.sh`

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

## `MAX_ARTIFACTS_PER_ATTEMPT`

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
- Sources: `src/lib/runbooks/agent-claims.ts`

## `MAX_AUTOMATIC_POLICY_TARGETS`

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
- Sources: `src/lib/runbooks/binding-readiness.ts`, `src/lib/runbooks/policy-checks.ts`

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

## `MAX_ESCALATION_STEPS`

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
- Sources: `src/lib/automation/versioning.ts`, `src/lib/escalation/automation-snapshot.ts`

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

## `MAX_PAGE_LIMIT`

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
- Sources: `src/lib/api-v2/pagination.ts`

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

## `MAX_RESPONDER_SNAPSHOT_BYTES`

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
- Sources: `src/lib/escalation/automation-snapshot.ts`

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

## `MAX_RETENTION_DAYS`

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
- Sources: `src/components/settings/AutomationSettings.tsx`

## `MAX_RUNBOOK_STEPS`

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
- Sources: `src/lib/runbooks/schemas.ts`, `src/lib/runbooks/shared-definition.ts`

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

## `MIGRATION_DURATION`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

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

## `MIN_RETENTION_DAYS`

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
- Sources: `src/components/settings/AutomationSettings.tsx`

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

## `NETWORK_NAME`

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
- Sources: `scripts/certification/drill-app-recovery.sh`, `scripts/certification/drill-rollback-rehearsal.sh`, `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `NEW_TABLE_COUNT`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

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

## `NODE_DIST`

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
- Sources: `scripts/build-agent-artifacts.sh`

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
- Sources: `next.config.ts`, `scripts/seed-enterprise-runbooks.ts`, `scripts/seed-runbooks-dev.ts`, `src/app/(app)/settings/system/page.tsx`, `src/app/api/health/route.ts`, `src/app/api/jira/webhook/handler.ts`, `src/app/api/microsoft-teams/messages/route.ts`, `src/app/api/search/route.ts`, `src/app/api/slack/oauth/route.ts`, `src/app/providers.tsx`, `src/app/setup/page.tsx`, `src/components/ChunkLoadErrorHandler.tsx`, `src/components/DatabaseOffline.tsx`, `src/components/WebVitalsReporter.tsx`, `src/components/ui/ErrorBoundary.tsx`, `src/lib/admin-health.ts`, `src/lib/api-keys.ts`, `src/lib/api-v2/incident-diagnostics.ts`, `src/lib/api-v2/pagination.ts`, `src/lib/api-v2/service-accounts.ts`, `src/lib/app-url.ts`, `src/lib/auth-control/emergency.ts`, `src/lib/auth-control/oidc-revisions.ts`, `src/lib/auth-control/origin.ts`, `src/lib/auth-cookies.ts`, `src/lib/auth-public-origin.ts`, `src/lib/automation/runtime.ts`, `src/lib/client-ip.ts`, `src/lib/encryption.ts`, `src/lib/env-validation.ts`, `src/lib/incident-collaboration/meeting-store.ts`, `src/lib/logger.ts`, `src/lib/microsoft-teams/auth.ts`, `src/lib/monitoring/sentry.ts`, `src/lib/provider-admission.ts`, `src/lib/recovery-origin-pin.ts`, `src/lib/retention-policy.ts`, `src/lib/runbooks/agent-claims.ts`, `src/lib/runbooks/execution-signing.ts`, `src/lib/scim/protocol/origin.ts`, `src/lib/secret-manager.ts`, `src/middleware.ts`

## `NODE_SHASUMS_URL`

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
- Sources: `scripts/build-agent-artifacts.sh`

## `NODE_TAR`

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
- Sources: `scripts/build-agent-artifacts.sh`

## `NODE_URL`

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
- Sources: `scripts/build-agent-artifacts.sh`

## `NODE_VERSION`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `v24.21.0`
- Sources: `scripts/build-agent-artifacts.sh`

## `NON_GATING_DETAIL`

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
- Sources: `scripts/ci/sanitize-security-junit.cjs`

## `NON_GATING_MESSAGE`

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
- Sources: `scripts/ci/sanitize-security-junit.cjs`

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

## `NONCE_PURGE_BATCH_SIZE`

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
- Sources: `src/lib/runbooks/nonce-cleanup.ts`

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

## `OPSKNIGHT_AGENT_IMAGE_DIGEST`

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
- Sources: `scripts/build-agent-release-manifest.mjs`

## `OPSKNIGHT_AGENT_RELEASE_TAG`

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
- Sources: `src/lib/runbooks/distribution.ts`

## `OPSKNIGHT_ALLOW_INSECURE_AGENT_SECRETS`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `true`
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: not displayed
- Sources: `src/lib/runbooks/agent-claims.ts`

## `OPSKNIGHT_BACKFILL_BATCH_SIZE`

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
- Sources: `scripts/backfill-automation-source-classification.cjs`

## `OPSKNIGHT_CERT_TARGET`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `1`
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `0`
- Sources: `scripts/certification/certify-all-routes-browsers.ts`, `scripts/certification/drill-app-recovery.sh`, `scripts/certification/drill-rollback-rehearsal.sh`, `scripts/certification/drill-upgrade-v20-to-v21.sh`, `scripts/certification/test-continuous-operational-chain.ts`

## `OPSKNIGHT_DATABASE_READY_POLL_MS`

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
- Sources: `scripts/wait-for-database-ready.cjs`

## `OPSKNIGHT_DATABASE_READY_TIMEOUT_MS`

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
- Sources: `scripts/wait-for-database-ready.cjs`

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

## `OPSKNIGHT_REVISION`

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
- Sources: `scripts/build-agent-release-manifest.mjs`

## `OPSKNIGHT_RUNTIME_DATABASE_READY_TIMEOUT_MS`

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
- Sources: `scripts/wait-for-runtime-database.cjs`

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

## `OPSKNIGHT_VERSION`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `${PACKAGE_VERSION`
- Sources: `scripts/build-agent-artifacts.sh`, `scripts/build-agent-release-manifest.mjs`

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

## `ORPHAN_EVENTS`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `ORPHAN_INCIDENTS`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `PACKAGE_DIR`

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
- Sources: `scripts/build-agent-artifacts.sh`

## `PACKAGE_VERSION`

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
- Sources: `scripts/build-agent-artifacts.sh`

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

## `PHASES`

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
- Sources: `src/components/automation/AutomationRules.tsx`

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

## `POPULAR_TAG_LIMIT`

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
- Sources: `src/app/(app)/runbooks/page.tsx`

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

## `PORTABLE_RUNBOOK_FORMAT`

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
- Sources: `src/lib/runbooks/portable.ts`

## `PORTABLE_RUNBOOK_FORMAT_VERSION`

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
- Sources: `src/lib/runbooks/portable.ts`

## `POST_ACTIONS`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `POST_AUDIT_LOGS`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `POST_EVENTS`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `POST_INCIDENTS`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `POST_MIGRATIONS`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `POST_POSTMORTEMS`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `POST_SERVICES`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `POST_STATUS_PAGES`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `POST_TEAMS`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `POST_USERS`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `PRE_ACTIONS`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `PRE_AUDIT_LOGS`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `PRE_EVENTS`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `PRE_INCIDENTS`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `PRE_MIGRATIONS`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `PRE_POSTMORTEMS`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `PRE_SERVICES`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `PRE_STATUS_PAGES`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `PRE_TEAMS`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `PRE_UPGRADE_DUMP`

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
- Sources: `scripts/certification/drill-rollback-rehearsal.sh`

## `PRE_USERS`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `PREFIX`

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
- Sources: `src/lib/auth-control/emergency-password.ts`

## `PREV_IMAGE`

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
- Sources: `scripts/certification/drill-rollback-rehearsal.sh`

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

## `PRIVACY_CLEANUP_BATCH_SIZE`

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
- Sources: `src/lib/automation/privacy-cleanup.ts`

## `PROTECTED_STATUS`

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
- Sources: `scripts/certification/drill-app-recovery.sh`, `scripts/certification/drill-rollback-rehearsal.sh`, `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `RAW_VERSION`

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
- Sources: `scripts/build-agent-artifacts.sh`

## `REALTIME_CACHE_MAX_BYTES`

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
- Sources: `src/lib/realtime-cache.ts`

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

## `RECOVERY_IMAGE`

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
- Sources: `scripts/certification/drill-app-recovery.sh`

## `RELEASE_TAG`

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
- Sources: `scripts/build-agent-artifacts.sh`

## `RELEASE_VERSION`

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
- Sources: `scripts/build-agent-artifacts.sh`

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

## `RESOLUTION_RECOMMENDED_PREFIX`

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
- Sources: `src/lib/incidents/response-presentation.ts`, `src/lib/runbooks/recovery.ts`

## `RESPONSE_CONTEXT_SCHEMA_VERSION`

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
- Sources: `src/lib/automation/response-context.ts`

## `RESTORE_DURATION`

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
- Sources: `scripts/certification/drill-app-recovery.sh`

## `RESTORE_FINISH`

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
- Sources: `scripts/certification/drill-app-recovery.sh`, `scripts/certification/drill-rollback-rehearsal.sh`

## `RESTORE_START`

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
- Sources: `scripts/certification/drill-app-recovery.sh`, `scripts/certification/drill-rollback-rehearsal.sh`

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

## `ROLLBACK_END`

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
- Sources: `scripts/certification/drill-rollback-rehearsal.sh`

## `ROLLBACK_RTO`

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
- Sources: `scripts/certification/drill-rollback-rehearsal.sh`

## `ROLLBACK_START`

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
- Sources: `scripts/certification/drill-rollback-rehearsal.sh`

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
- Sources: `scripts/build-agent-artifacts.sh`, `scripts/sync-docs-to-website.sh`

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

## `RUNBOOK_TAG_MAX_COUNT`

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
- Sources: `src/components/runbooks/RunbookLibrary.tsx`

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

## `SCIM_ALLOW_INSECURE_HTTP`

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
- Sources: `src/lib/scim/protocol/origin.ts`

## `SCIM_ALLOW_PRIVATE_NETWORK`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `true`
- Secret: yes
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: not displayed
- Sources: `src/lib/scim/protocol/origin.ts`

## `SCIM_BASELINE_COMMIT`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `326f21685`
- Sources: `scripts/scim/certify-baseline.mjs`, `scripts/scim/certify-upgrade.mjs`

## `SCIM_CERT_DB_CONTAINER`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `opsknight-scim-cert-db`
- Sources: `scripts/scim/certify-snapshot-upgrade.mjs`, `scripts/scim/certify-upgrade.mjs`

## `SCIM_CERT_DOCKER`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `/Applications/Docker.app/Contents/Resources/bin/docker`
- Sources: `scripts/scim/certify-outage.mjs`, `scripts/scim/certify-snapshot-upgrade.mjs`, `scripts/scim/certify-upgrade.mjs`

## `SCIM_CERT_REPLICA_URLS`

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
- Sources: `scripts/scim/certify-outage.mjs`, `scripts/scim/certify-replicas.mjs`, `scripts/scim/certify-session-replicas.mjs`

## `SCIM_CONNECTOR_REQUESTS_PER_MINUTE`

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
- Sources: `src/lib/scim/security/credentials.ts`

## `SCIM_E2E_ADMIN_EMAIL`

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
- Sources: `scripts/scim/seed-certification.ts`

## `SCIM_E2E_ADMIN_PASSWORD`

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
- Sources: `scripts/scim/seed-certification.ts`

## `SCIM_E2E_BASE_URL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `http://localhost:3028`
- Sources: `scripts/scim/certify-http-capacity.mjs`

## `SCRIPT_DIR`

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
- Sources: `scripts/build-agent-artifacts.sh`

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

## `SERVICE_ACCOUNT_DOMAIN`

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
- Sources: `src/app/(app)/settings/api-keys/page.tsx`, `src/app/api/v2/service-accounts/route.ts`, `src/lib/api-v2/service-accounts.ts`, `src/lib/service-account-identity.ts`, `src/lib/service-account-inventory.ts`

## `SERVICE_ROW`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

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

## `SESSION_BODY`

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
- Sources: `scripts/certification/drill-app-recovery.sh`, `scripts/certification/drill-rollback-rehearsal.sh`, `scripts/certification/drill-upgrade-v20-to-v21.sh`

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

## `SHASUMS_FILE`

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
- Sources: `scripts/build-agent-artifacts.sh`

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

## `SKIP_BUILD_TYPECHECK`

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

## `SOURCE_DUMP`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

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

## `SSO_CERT_AUTH_LOAD`

- Type: enum/string
- Required: conditional or optional; inspect cited source
- Allowed values: `1`
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: none discovered
- Sources: `scripts/certify-sso-upgrade.cjs`

## `SSO_CERT_BASE_URL`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `https://localhost:3005`
- Sources: `scripts/certify-authentication-http.cjs`

## `SSO_CERT_EXPECTED_POLICY_VERSION`

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
- Sources: `scripts/certify-authentication-http.cjs`

## `SSO_CERT_EXPECTED_USER_ID`

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
- Sources: `scripts/certify-authentication-http.cjs`

## `SSO_CERT_SESSION_STATE`

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
- Sources: `scripts/certify-authentication-http.cjs`

## `SSO_UPGRADE_BASELINE`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: operator command or startup script
- Deployment support: operation
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `097f4916a38ddcc6d1512f71b72bde36abbeb171`
- Sources: `scripts/certify-sso-upgrade.cjs`

## `SSO_UPGRADE_ENCRYPTED_SECRET`

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
- Sources: `scripts/certify-sso-upgrade.cjs`

## `SSO_UPGRADE_EXISTING_JWT`

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
- Sources: `scripts/certify-sso-upgrade.cjs`

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
- Sources: `scripts/certification/drill-app-recovery.sh`, `scripts/soak-test-2h.sh`

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

## `STEP_CATALOG`

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
- Sources: `src/components/runbooks/builder/StepNavigator.tsx`

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

## `SUSTAINED_RATE`

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
- Sources: `scripts/sustained-ceiling-validator.ts`

## `SYNTHETIC_VERIFIED`

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
- Sources: `scripts/certification/drill-app-recovery.sh`

## `TARBALL_NAME`

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
- Sources: `scripts/build-agent-artifacts.sh`

## `TARGET_IMAGE`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `TEAM_ROW`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

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

## `TEMP_NODE_DIR`

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
- Sources: `scripts/build-agent-artifacts.sh`

## `TEST_EMAIL`

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
- Sources: `scripts/certification/certify-all-routes-browsers.ts`

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

## `TIMELINE_EVENT_COUNT`

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
- Sources: `scripts/certification/drill-app-recovery.sh`

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

## `TITLES`

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
- Sources: `scripts/dev/seed-dashboard-live.ts`

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

## `TOTAL_RTO`

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
- Sources: `scripts/certification/drill-app-recovery.sh`

## `TRIGGER_LABELS`

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
- Sources: `src/app/(app)/runbooks/executions/[id]/page.tsx`

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

## `UPGRADE_FINISH`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `UPGRADE_START`

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
- Sources: `scripts/certification/drill-upgrade-v20-to-v21.sh`

## `URGENT_NOTIFICATION_CLAIM_MS`

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
- Sources: `src/lib/notification-claim-lease.ts`

## `V2_OPERATIONS`

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
- Sources: `scripts/certification/run-matrix-certification.ts`, `scripts/certification/verify-discovery.ts`

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
- Sources: `src/lib/provider-admission.ts`, `src/lib/runbooks/agent-claims.ts`

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

## `WORKER_CONTAINER`

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
- Sources: `scripts/certification/drill-app-recovery.sh`

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

## `WORKER_LOGS`

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
- Sources: `scripts/certification/drill-app-recovery.sh`

## `WORKER_RUNNING`

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
- Sources: `scripts/certification/drill-app-recovery.sh`

## `XDG_RUNTIME_DIR`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `/run/user/\$(id -u)`
- Sources: `src/lib/runbooks/agent-setup-commands.ts`

## `XDG_STATE_HOME`

- Type: string
- Required: conditional or optional; inspect cited source
- Allowed values: not statically complete
- Secret: no
- Runtime roles: web or integrated runtime
- Deployment support: runtime
- Apply behavior: restart required
- Deprecated: no
- Extraction confidence: derived
- Static default: `$HOME/.local/state`
- Sources: `src/lib/runbooks/agent-setup-commands.ts`

