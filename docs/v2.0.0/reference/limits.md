---
title: Runtime limits
description: Generated limits, timeouts, rates, concurrency bounds, and retention constants.
type: reference
product_area: configuration
audience: [developer, operator, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - generated/docs-discovery/current.json
    - src/
---

# Runtime limits

This page is generated from named numeric constants and explicit maximum-value
messages in source. A discovered constant is not automatically a public promise;
use its source and owning feature to interpret scope. Scanner output is kept here
to prevent copied values from silently drifting.

## `DRAFT_MAX_AGE_MS`

- Value: `21600000`
- Source expression: `6 * 60 * 60 * 1000`
- Source: `src/app/(mobile)/m/incidents/create/client.tsx`

## `DEFAULT_LIMIT`

- Value: `200`
- Source expression: `200`
- Source: `src/app/(public)/logs/LogsClient.tsx`

## `MAX_DAYS_PER_CALL`

- Value: `366`
- Source expression: `366`
- Source: `src/app/api/admin/rollups/backfill/route.ts`

## `RATE_LIMIT_MAX`

- Value: `60`
- Source expression: `60`
- Source: `src/app/api/admin/sla-performance/route.ts`

## `RATE_LIMIT_WINDOW_MS`

- Value: `60000`
- Source expression: `60 * 1000`
- Source: `src/app/api/admin/sla-performance/route.ts`

## `MAX_DASHBOARDS_PER_QUERY`

- Value: `100`
- Source expression: `100`
- Source: `src/app/api/dashboards/route.ts`

## `MAX_WIDGETS_PER_DASHBOARD`

- Value: `50`
- Source expression: `50`
- Source: `src/app/api/dashboards/route.ts`

## `RATE_LIMIT_MAX`

- Value: `120`
- Source expression: `120`
- Source: `src/app/api/events/route.ts`

## `RATE_LIMIT_WINDOW_MS`

- Value: `60000`
- Source expression: `60_000`
- Source: `src/app/api/events/route.ts`

## `RATE_LIMIT_MAX`

- Value: `60`
- Source expression: `60`
- Source: `src/app/api/incidents/[id]/route.ts`

## `RATE_LIMIT_WINDOW_MS`

- Value: `60000`
- Source expression: `60_000`
- Source: `src/app/api/incidents/[id]/route.ts`

## `RATE_LIMIT_MAX`

- Value: `30`
- Source expression: `30`
- Source: `src/app/api/incidents/create/route.ts`

## `RATE_LIMIT_WINDOW_MS`

- Value: `60000`
- Source expression: `60_000`
- Source: `src/app/api/incidents/create/route.ts`

## `MAX_EXPORT_LIMIT`

- Value: `10000`
- Source expression: `10000`
- Source: `src/app/api/incidents/export/route.ts`

## `RATE_LIMIT_BURST`

- Value: `120`
- Source expression: `120`
- Source: `src/app/api/incidents/route.ts`

## `RATE_LIMIT_MAX`

- Value: `60`
- Source expression: `60`
- Source: `src/app/api/incidents/route.ts`

## `RATE_LIMIT_WINDOW_MS`

- Value: `60000`
- Source expression: `60_000`
- Source: `src/app/api/incidents/route.ts`

## `MAX_BODY_SIZE`

- Value: `51200`
- Source expression: `50 * 1024`
- Source: `src/app/api/logs/ingest/route.ts`

## `RATE_LIMIT_MAX`

- Value: `30`
- Source expression: `30`
- Source: `src/app/api/logs/ingest/route.ts`

## `RATE_LIMIT_WINDOW_MS`

- Value: `60000`
- Source expression: `60_000`
- Source: `src/app/api/logs/ingest/route.ts`

## `DB_COLLECTOR_TIMEOUT_MS`

- Value: `2000`
- Source expression: `2_000`
- Source: `src/app/api/metrics/route.ts`

## `TEAMS_CHANNELS_CAN_BE_LINKED_TO_A_SERVICE`

- Value: `3`
- Source expression: `maximum of 3 Teams channels can be linked to a service`
- Source: `src/app/api/microsoft-teams/destinations/route.ts`

## `RATE_LIMIT_MAX`

- Value: `30`
- Source expression: `30`
- Source: `src/app/api/sidebar-stats/route.ts`

## `RATE_LIMIT_WINDOW_MS`

- Value: `60000`
- Source expression: `60_000`
- Source: `src/app/api/sidebar-stats/route.ts`

## `BATCH_SIZE`

- Value: `100`
- Source expression: `100`
- Source: `src/app/api/sla/stream/route.ts`

## `RATE_LIMIT_MAX`

- Value: `30`
- Source expression: `30`
- Source: `src/app/api/sla/stream/route.ts`

## `RATE_LIMIT_WINDOW_MS`

- Value: `900000`
- Source expression: `15 * 60 * 1000`
- Source: `src/app/api/sla/stream/route.ts`

## `SLACK_CHANNELS_CAN_BE_LINKED_TO_A_SERVICE`

- Value: `3`
- Source expression: `maximum of 3 Slack channels can be linked to a service`
- Source: `src/app/api/slack/destinations/route.ts`

## `MAX_LOGO_BYTES`

- Value: `2097152`
- Source expression: `2 * 1024 * 1024`
- Source: `src/app/api/status-page/logo/[id]/route.ts`

## `MAX_RESULTS`

- Value: `50`
- Source expression: `50`
- Source: `src/app/api/teams/[id]/available-users/route.ts`

## `BOOTSTRAP_RATE_WINDOW_MS`

- Value: `900000`
- Source expression: `15 * 60 * 1000`
- Source: `src/app/setup/actions.ts`

## `ACTIVITY_THROTTLE_MS`

- Value: `120000`
- Source expression: `2 * 60 * 1000`
- Source: `src/components/auth/ActivityTracker.tsx`

## `MAX_AUTO_RELOADS`

- Value: `2`
- Source expression: `2`
- Source: `src/components/ChunkLoadErrorHandler.tsx`

## `RELOAD_WINDOW_MS`

- Value: `300000`
- Source expression: `5 * 60 * 1000`
- Source: `src/components/ChunkLoadErrorHandler.tsx`

## `MAX_RECONNECT_ATTEMPTS`

- Value: `10`
- Source expression: `10`
- Source: `src/components/dashboard/WidgetProvider.tsx`

## `MAX_RECONNECT_DELAY_MS`

- Value: `30000`
- Source expression: `30000`
- Source: `src/components/dashboard/WidgetProvider.tsx`

## `RECONNECT_BACKOFF_MULTIPLIER`

- Value: `2`
- Source expression: `2`
- Source: `src/components/dashboard/WidgetProvider.tsx`

## `MAX_RESOLUTION_LENGTH`

- Value: `1000`
- Source expression: `1000`
- Source: `src/components/incident/ResolveIncidentModal.tsx`

## `MIN_RESOLUTION_LENGTH`

- Value: `10`
- Source expression: `10`
- Source: `src/components/incident/ResolveIncidentModal.tsx`

## `ASSERTION_TIMEOUT_MS`

- Value: `15000`
- Source expression: `15_000`
- Source: `src/components/mobile/MobileBiometricGuard.tsx`

## `SERVICE_WORKER_READY_TIMEOUT_MS`

- Value: `8000`
- Source expression: `8_000`
- Source: `src/components/mobile/MobilePwaCoordinator.tsx`

## `MIN_QUERY_LENGTH`

- Value: `2`
- Source expression: `2`
- Source: `src/components/mobile/MobileQuickSwitcher.tsx`

## `RECENTS_MAX_AGE_MS`

- Value: `2592000000`
- Source expression: `30 * 24 * 60 * 60 * 1000`
- Source: `src/components/mobile/MobileQuickSwitcher.tsx`

## `SWIPE_MIN_DISTANCE`

- Value: `80`
- Source expression: `80`
- Source: `src/components/mobile/MobileSwipeNavigator.tsx`

## `REFRESH_TIMEOUT_MS`

- Value: `15000`
- Source expression: `15_000`
- Source: `src/components/mobile/PullToRefresh.tsx`

## `REQUEST_TIMEOUT_MS`

- Value: `12000`
- Source expression: `12_000`
- Source: `src/components/mobile/PushNotificationToggle.tsx`

## `SERVICE_WORKER_READY_TIMEOUT_MS`

- Value: `8000`
- Source expression: `8_000`
- Source: `src/components/mobile/PushNotificationToggle.tsx`

## `MAX_RECENT_SEARCHES`

- Value: `5`
- Source expression: `5`
- Source: `src/components/SidebarSearch.tsx`

## `MAX_EMAIL_LEN`

- Value: `254`
- Source expression: `254`
- Source: `src/components/status-page/StatusPageSubscribe.tsx`

## `AFFECTS_INLINE_LIMIT`

- Value: `3`
- Source expression: `3`
- Source: `src/components/status-page/v3/AnnouncementsV3.tsx`

## `AUTO_DISMISS_TIMEOUT_MS`

- Value: `120000`
- Source expression: `120 * 1000`
- Source: `src/contexts/IncidentAlertContext.tsx`

## `MAX_CACHE_SIZE`

- Value: `500`
- Source expression: `500`
- Source: `src/contexts/UserAvatarContext.tsx`

## `HEALTH_CACHE_TTL_MS`

- Value: `15000`
- Source expression: `15_000`
- Source: `src/lib/admin-health.ts`

## `MINUTE`

- Value: `60000`
- Source expression: `60_000`
- Source: `src/lib/admin-health.ts`

## `DEFAULT_MAX_AGE`

- Value: `2592000`
- Source expression: `30 * 24 * 60 * 60`
- Source: `src/lib/auth-jwt-encoder.ts`

## `MAX_CALLBACK_LENGTH`

- Value: `2048`
- Source expression: `2048`
- Source: `src/lib/auth-redirect.ts`

## `BOOTSTRAP_TTL_MS`

- Value: `1800000`
- Source expression: `30 * 60 * 1000`
- Source: `src/lib/bootstrap-security.ts`

## `MAX_TENANT_BREAKERS`

- Value: `20`
- Source expression: `20`
- Source: `src/lib/circuit-breaker.ts`

## `MAX_NOTIFICATIONS_PER_EPISODE`

- Value: `5`
- Source expression: `5`
- Source: `src/lib/compliance/drift/notifications.ts`

## `MAX_DRIFT_PROJECTION_BATCH`

- Value: `100`
- Source expression: `100`
- Source: `src/lib/compliance/drift/projector.ts`

## `MAX_ARRAY_LENGTH`

- Value: `100`
- Source expression: `100`
- Source: `src/lib/compliance/evidence/validate.ts`

## `MAX_EVIDENCE_DRAFTS_PER_EVALUATION`

- Value: `20`
- Source expression: `20`
- Source: `src/lib/compliance/evidence/validate.ts`

## `MAX_METADATA_BYTES`

- Value: `32768`
- Source expression: `32 * 1024`
- Source: `src/lib/compliance/evidence/validate.ts`

## `MAX_METADATA_DEPTH`

- Value: `8`
- Source expression: `8`
- Source: `src/lib/compliance/evidence/validate.ts`

## `MAX_STRING_LENGTH`

- Value: `2048`
- Source expression: `2 * 1024`
- Source: `src/lib/compliance/evidence/validate.ts`

## `MAX_EVIDENCE_RECORDS`

- Value: `10000`
- Source expression: `10_000`
- Source: `src/lib/compliance/export/validation.ts`

## `MAX_HISTORICAL_DAYS`

- Value: `366`
- Source expression: `366`
- Source: `src/lib/compliance/export/validation.ts`

## `MAX_SELECTED_CONTROLS`

- Value: `50`
- Source expression: `50`
- Source: `src/lib/compliance/export/validation.ts`

## `MAX_UNCOMPRESSED_PACKAGE_BYTES`

- Value: `52428800`
- Source expression: `50 * 1024 * 1024`
- Source: `src/lib/compliance/export/validation.ts`

## `DEFAULT_COOLDOWN_MINUTES`

- Value: `60`
- Source expression: `60`
- Source: `src/lib/compliance/monitoring/config.ts`

## `DEFAULT_INTERVAL_MINUTES`

- Value: `60`
- Source expression: `60`
- Source: `src/lib/compliance/monitoring/config.ts`

## `MAX_COOLDOWN_MINUTES`

- Value: `1440`
- Source expression: `1440`
- Source: `src/lib/compliance/monitoring/config.ts`

## `MAX_INTERVAL_MINUTES`

- Value: `1440`
- Source expression: `1440`
- Source: `src/lib/compliance/monitoring/config.ts`

## `MIN_COOLDOWN_MINUTES`

- Value: `5`
- Source expression: `5`
- Source: `src/lib/compliance/monitoring/config.ts`

## `MIN_INTERVAL_MINUTES`

- Value: `5`
- Source expression: `5`
- Source: `src/lib/compliance/monitoring/config.ts`

## `LOCK_TIMEOUT_MS`

- Value: `90000`
- Source expression: `90_000`
- Source: `src/lib/cron-scheduler.ts`

## `MAX_BACKFILL_PER_RUN`

- Value: `30`
- Source expression: `30`
- Source: `src/lib/cron-scheduler.ts`

## `MAX_DELAY_MS`

- Value: `120000`
- Source expression: `2 * 60_000`
- Source: `src/lib/cron-scheduler.ts`

## `MIN_DELAY_MS`

- Value: `15000`
- Source expression: `15_000`
- Source: `src/lib/cron-scheduler.ts`

## `FRESH_TTL_MS`

- Value: `30000`
- Source expression: `30_000`
- Source: `src/lib/dashboard/dashboard-analytics-cache.ts`

## `MAX_ENTRIES`

- Value: `500`
- Source expression: `500`
- Source: `src/lib/dashboard/dashboard-analytics-cache.ts`

## `STALE_TTL_MS`

- Value: `300000`
- Source expression: `5 * 60_000`
- Source: `src/lib/dashboard/dashboard-analytics-cache.ts`

## `FOCUS_LIMIT`

- Value: `5`
- Source expression: `5`
- Source: `src/lib/dashboard/dashboard-operational-snapshot.ts`

## `PREVIEW_LIMIT`

- Value: `20`
- Source expression: `20`
- Source: `src/lib/dashboard/dashboard-operational-snapshot.ts`

## `RECENT_LIMIT`

- Value: `15`
- Source expression: `15`
- Source: `src/lib/dashboard/dashboard-operational-snapshot.ts`

## `FRESH_TTL_MS`

- Value: `30000`
- Source expression: `30_000`
- Source: `src/lib/dashboard/responder-analytics-snapshot.ts`

## `MAX_CONCURRENT_CALCULATIONS`

- Value: `3`
- Source expression: `3`
- Source: `src/lib/dashboard/responder-analytics-snapshot.ts`

## `MAX_ENTRIES`

- Value: `300`
- Source expression: `300`
- Source: `src/lib/dashboard/responder-analytics-snapshot.ts`

## `STALE_TTL_MS`

- Value: `300000`
- Source expression: `5 * 60_000`
- Source: `src/lib/dashboard/responder-analytics-snapshot.ts`

## `FRESH_TTL_MS`

- Value: `20000`
- Source expression: `20_000`
- Source: `src/lib/dashboard/responder-dashboard-snapshot.ts`

## `MAX_CONCURRENT_CALCULATIONS`

- Value: `4`
- Source expression: `4`
- Source: `src/lib/dashboard/responder-dashboard-snapshot.ts`

## `MAX_ENTRIES`

- Value: `500`
- Source expression: `500`
- Source: `src/lib/dashboard/responder-dashboard-snapshot.ts`

## `STALE_TTL_MS`

- Value: `300000`
- Source expression: `5 * 60_000`
- Source: `src/lib/dashboard/responder-dashboard-snapshot.ts`

## `BATCH_SIZE`

- Value: `500`
- Source expression: `500`
- Source: `src/lib/data-cleanup.ts`

## `TRANSACTION_MAX_ATTEMPTS`

- Value: `3`
- Source expression: `3`
- Source: `src/lib/db-utils.ts`

## `TRANSACTION_MAX_ATTEMPTS_HIGH_LOAD`

- Value: `5`
- Source expression: `5`
- Source: `src/lib/db-utils.ts`

## `MAX_KEYRING_ENTRIES`

- Value: `64`
- Source expression: `64`
- Source: `src/lib/encryption-key-validation.ts`

## `MAX_KEYRING_LENGTH`

- Value: `16384`
- Source expression: `16_384`
- Source: `src/lib/encryption-key-validation.ts`

## `MAX_ESCALATION_DELAY_MINUTES`

- Value: `10080`
- Source expression: `7 * 24 * 60`
- Source: `src/lib/escalation/policy-validation.ts`

## `DEFAULT_LIMIT`

- Value: `200`
- Source expression: `200`
- Source: `src/lib/escalation/recovery.ts`

## `MAX_DEDUP_KEY_LENGTH`

- Value: `512`
- Source expression: `512`
- Source: `src/lib/events.ts`

## `MAX_DESCRIPTION_LENGTH`

- Value: `10000`
- Source expression: `10000`
- Source: `src/lib/events.ts`

## `MAX_STORED_ALERT_PAYLOAD_BYTES`

- Value: `65536`
- Source expression: `64 * 1024`
- Source: `src/lib/events.ts`

## `MAX_JIRA_OPERATION_ATTEMPTS`

- Value: `8`
- Source expression: `8`
- Source: `src/lib/external-operations.ts`

## `MAX_IDEMPOTENCY_KEY_LENGTH`

- Value: `200`
- Source expression: `200`
- Source: `src/lib/idempotency.ts`

## `MAX_PRINCIPAL_ID_LENGTH`

- Value: `200`
- Source expression: `200`
- Source: `src/lib/idempotency.ts`

## `MAX_INCIDENT_SLA_TARGET_MS`

- Value: `2073600000`
- Source expression: `24 * 24 * 60 * 60 * 1000`
- Source: `src/lib/incident-sla/policy-validation.ts`

## `MIN_CLEAN_SHADOW_CHECKS`

- Value: `3`
- Source expression: `3`
- Source: `src/lib/incident-sla/scheduler-control.ts`

## `MAX_DEDUP_KEY_LENGTH`

- Value: `200`
- Source expression: `200`
- Source: `src/lib/incidents/creation.ts`

## `MAX_ID_LENGTH`

- Value: `100`
- Source expression: `100`
- Source: `src/lib/incidents/creation.ts`

## `REOPEN_WINDOW_MS`

- Value: `1800000`
- Source expression: `30 * 60 * 1000`
- Source: `src/lib/incidents/creation.ts`

## `MAX_BATCH_SIZE`

- Value: `100`
- Source expression: `100`
- Source: `src/lib/incidents/lifecycle.ts`

## `MAX_EVENT_MESSAGE_LENGTH`

- Value: `2000`
- Source expression: `2000`
- Source: `src/lib/incidents/lifecycle.ts`

## `MAX_ID_LENGTH`

- Value: `100`
- Source expression: `100`
- Source: `src/lib/incidents/lifecycle.ts`

## `MAX_RESOLUTION_NOTE_LENGTH`

- Value: `1000`
- Source expression: `1000`
- Source: `src/lib/incidents/lifecycle.ts`

## `MAX_SNOOZE_REASON_LENGTH`

- Value: `1000`
- Source expression: `1000`
- Source: `src/lib/incidents/lifecycle.ts`

## `MIN_RESOLUTION_NOTE_LENGTH`

- Value: `10`
- Source expression: `10`
- Source: `src/lib/incidents/lifecycle.ts`

## `MAX_CERT_BYTES`

- Value: `32768`
- Source expression: `32 * 1024`
- Source: `src/lib/integrations/aws-sns-verification.ts`

## `MAX_INTEGRATION_METRICS`

- Value: `1000`
- Source expression: `1000`
- Source: `src/lib/integrations/metrics.ts`

## `MAX_TYPE_METRICS`

- Value: `50`
- Source expression: `50`
- Source: `src/lib/integrations/metrics.ts`

## `METRICS_TTL_MS`

- Value: `86400000`
- Source expression: `24 * 60 * 60 * 1000`
- Source: `src/lib/integrations/metrics.ts`

## `MAX_INTEGRATION_BODY_BYTES`

- Value: `1048576`
- Source expression: `1024 * 1024`
- Source: `src/lib/integrations/request-security.ts`

## `JIRA_ISSUE_MUTATION_FENCE_TIMEOUT_MS`

- Value: `15000`
- Source expression: `15_000`
- Source: `src/lib/jira-concurrency.ts`

## `JIRA_PROVIDER_FENCE_MAX_WAIT_MS`

- Value: `5000`
- Source expression: `5_000`
- Source: `src/lib/jira-concurrency.ts`

## `JIRA_PROVIDER_FENCE_TIMEOUT_MS`

- Value: `40000`
- Source expression: `40_000`
- Source: `src/lib/jira-concurrency.ts`

## `JIRA_REQUEST_TIMEOUT_MS`

- Value: `8000`
- Source expression: `8_000`
- Source: `src/lib/jira.ts`

## `DEFAULT_BATCH_SIZE`

- Value: `100`
- Source expression: `100`
- Source: `src/lib/job-worker.ts`

## `DEFAULT_BUSY_POLL_MS`

- Value: `100`
- Source expression: `100`
- Source: `src/lib/job-worker.ts`

## `DEFAULT_CONCURRENCY`

- Value: `15`
- Source expression: `15`
- Source: `src/lib/job-worker.ts`

## `DEFAULT_IDLE_POLL_MS`

- Value: `1000`
- Source expression: `1000`
- Source: `src/lib/job-worker.ts`

## `MAX_BATCH_SIZE`

- Value: `500`
- Source expression: `500`
- Source: `src/lib/job-worker.ts`

## `MAX_BUSY_POLL_MS`

- Value: `5000`
- Source expression: `5_000`
- Source: `src/lib/job-worker.ts`

## `MAX_CONCURRENCY`

- Value: `50`
- Source expression: `50`
- Source: `src/lib/job-worker.ts`

## `MAX_IDLE_POLL_MS`

- Value: `60000`
- Source expression: `60_000`
- Source: `src/lib/job-worker.ts`

## `MAX_RETRY_BACKOFF_MS`

- Value: `900000`
- Source expression: `15 * 60 * 1000`
- Source: `src/lib/jobs/queue.ts`

## `MINUTE_MS`

- Value: `60000`
- Source expression: `60_000`
- Source: `src/lib/metrics/domain/sla-target.ts`

## `BOT_JWKS_TTL_MS`

- Value: `3600000`
- Source expression: `60 * 60 * 1000`
- Source: `src/lib/microsoft-teams/auth.ts`

## `TOKEN_CACHE_MAX`

- Value: `50`
- Source expression: `50`
- Source: `src/lib/microsoft-teams/client.ts`

## `MAX_TEAMS_OPERATION_ATTEMPTS`

- Value: `8`
- Source expression: `8`
- Source: `src/lib/microsoft-teams/delivery.ts`

## `CHALLENGE_TTL_MS`

- Value: `600000`
- Source expression: `10 * 60 * 1000`
- Source: `src/lib/microsoft-teams/identity.ts`

## `DEFAULT_CACHE_MAX_AGE_MS`

- Value: `86400000`
- Source expression: `24 * 60 * 60 * 1000`
- Source: `src/lib/mobile-cache.ts`

## `CAPACITY_MAX_ENTRIES`

- Value: `512`
- Source expression: `512`
- Source: `src/lib/notification-capacity/cache.ts`

## `CAPACITY_TTL_MS`

- Value: `5000`
- Source expression: `5_000`
- Source: `src/lib/notification-capacity/cache.ts`

## `RUNTIME_TTL_MS`

- Value: `5000`
- Source expression: `5_000`
- Source: `src/lib/notification-capacity/cache.ts`

## `ADAPTIVE_MAX_ENTRIES`

- Value: `1024`
- Source expression: `1024`
- Source: `src/lib/notification-capacity/resolver.ts`

## `FEED_BATCH_SIZE`

- Value: `2000`
- Source expression: `2_000`
- Source: `src/lib/notification-change-clock.ts`

## `FEED_TTL_MS`

- Value: `2000`
- Source expression: `2_000`
- Source: `src/lib/notification-change-clock.ts`

## `MAX_PAGES_PER_REFRESH`

- Value: `5`
- Source expression: `5`
- Source: `src/lib/notification-change-clock.ts`

## `USER_VERSION_RETENTION_MS`

- Value: `300000`
- Source expression: `5 * 60_000`
- Source: `src/lib/notification-change-clock.ts`

## `CLAIM_TIMEOUT_MS`

- Value: `600000`
- Source expression: `10 * 60_000`
- Source: `src/lib/notification-control-plane.ts`

## `EXPIRED_NOTIFICATION_CLEANUP_BATCH_SIZE`

- Value: `100`
- Source expression: `100`
- Source: `src/lib/notification-control-plane.ts`

## `MAX_ENCRYPTED_PAYLOAD_BYTES`

- Value: `786432`
- Source expression: `768 * 1024`
- Source: `src/lib/notification-control-plane.ts`

## `MAX_ERROR_LENGTH`

- Value: `1000`
- Source expression: `1_000`
- Source: `src/lib/notification-control-plane.ts`

## `SYSTEM_NOTIFICATION_BATCH_SIZE`

- Value: `100`
- Source expression: `100`
- Source: `src/lib/notification-control-plane.ts`

## `SYSTEM_NOTIFICATION_CONCURRENCY`

- Value: `10`
- Source expression: `10`
- Source: `src/lib/notification-control-plane.ts`

## `UNKNOWN_CALLBACK_MAX_AGE_MS`

- Value: `900000`
- Source expression: `15 * 60_000`
- Source: `src/lib/notification-control-plane.ts`

## `CLAIM_TIMEOUT_MS`

- Value: `600000`
- Source expression: `10 * 60_000`
- Source: `src/lib/notification-fanout.ts`

## `LEGACY_RETRY_INTERVAL_MS`

- Value: `15000`
- Source expression: `15_000`
- Source: `src/lib/notification-recovery.ts`

## `MAX_BACKOFF_MS`

- Value: `300000`
- Source expression: `5 * 60 * 1000`
- Source: `src/lib/offline-queue.ts`

## `MAX_OPERATIONS_PER_FLUSH`

- Value: `32`
- Source expression: `32`
- Source: `src/lib/offline-queue.ts`

## `MAX_PARALLEL_LANES`

- Value: `4`
- Source expression: `4`
- Source: `src/lib/offline-queue.ts`

## `OFFLINE_HTTP_TIMEOUT_MS`

- Value: `15000`
- Source expression: `15_000`
- Source: `src/lib/offline-queue.ts`

## `TERMINAL_RETENTION_MS`

- Value: `86400000`
- Source expression: `24 * 60 * 60 * 1000`
- Source: `src/lib/offline-queue.ts`

## `OIDC_LINKING_APPROVAL_TTL_HOURS`

- Value: `168`
- Source expression: `168`
- Source: `src/lib/oidc-linking-approval.ts`

## `MAX_DISCOVERY_BYTES`

- Value: `262144`
- Source expression: `262_144`
- Source: `src/lib/oidc-validation.ts`

## `MAX_JWKS_BYTES`

- Value: `1048576`
- Source expression: `1_048_576`
- Source: `src/lib/oidc-validation.ts`

## `NEGATIVE_CACHE_TTL_MS`

- Value: `30000`
- Source expression: `30_000`
- Source: `src/lib/oidc-validation.ts`

## `RUNTIME_METADATA_TTL_MS`

- Value: `300000`
- Source expression: `300_000`
- Source: `src/lib/oidc-validation.ts`

## `STALE_METADATA_MAX_MS`

- Value: `3600000`
- Source expression: `3_600_000`
- Source: `src/lib/oidc-validation.ts`

## `SWR_BACKOFF_MS`

- Value: `30000`
- Source expression: `30_000`
- Source: `src/lib/oidc-validation.ts`

## `COMPLETION_WINDOW_MS`

- Value: `900000`
- Source expression: `15 * 60 * 1000`
- Source: `src/lib/password-reset.ts`

## `INIT_IDENTIFIER_WINDOW_MS`

- Value: `3600000`
- Source expression: `60 * 60 * 1000`
- Source: `src/lib/password-reset.ts`

## `INIT_IP_WINDOW_MS`

- Value: `900000`
- Source expression: `15 * 60 * 1000`
- Source: `src/lib/password-reset.ts`

## `RESET_TOKEN_TTL_MS`

- Value: `1800000`
- Source expression: `30 * 60 * 1000`
- Source: `src/lib/password-reset.ts`

## `PASSWORD_MAX_LENGTH`

- Value: `64`
- Source expression: `64`
- Source: `src/lib/passwords.ts`

## `PASSWORD_MAX_UTF8_BYTES`

- Value: `72`
- Source expression: `72`
- Source: `src/lib/passwords.ts`

## `PASSWORD_MIN_LENGTH`

- Value: `15`
- Source expression: `15`
- Source: `src/lib/passwords.ts`

## `PASSWORD_TRANSPORT_MAX_CODE_UNITS`

- Value: `256`
- Source expression: `256`
- Source: `src/lib/passwords.ts`

## `EXPORT_ARTIFACT_TTL_HOURS`

- Value: `72`
- Source expression: `72`
- Source: `src/lib/privacy/export/artifact.ts`

## `MAX_EXPORT_ARTIFACT_BYTES`

- Value: `209715200`
- Source expression: `200 * 1024 * 1024`
- Source: `src/lib/privacy/export/artifact.ts`

## `CONCURRENCY_CLAIM_SWEEP_INTERVAL_MS`

- Value: `5000`
- Source expression: `5_000`
- Source: `src/lib/provider-admission.ts`

## `MAX_SLOTS_PER_WORKER`

- Value: `5`
- Source expression: `5`
- Source: `src/lib/provider-admission.ts`

## `MAX_TRUSTED_PWA_DAYS`

- Value: `90`
- Source expression: `90`
- Source: `src/lib/pwa-session-policy.ts`

## `MIN_TRUSTED_PWA_DAYS`

- Value: `30`
- Source expression: `30`
- Source: `src/lib/pwa-session-policy.ts`

## `DEFAULT_TTL_MS`

- Value: `5000`
- Source expression: `5000`
- Source: `src/lib/realtime-cache.ts`

## `INCIDENT_TTL_MS`

- Value: `3000`
- Source expression: `3000`
- Source: `src/lib/realtime-cache.ts`

## `MAX_CACHE_SIZE`

- Value: `5000`
- Source expression: `5000`
- Source: `src/lib/realtime-cache.ts`

## `METRICS_TTL_MS`

- Value: `5000`
- Source expression: `5000`
- Source: `src/lib/realtime-cache.ts`

## `MAX_ERROR_BACKOFF_MS`

- Value: `10000`
- Source expression: `10_000`
- Source: `src/lib/realtime-change-control-plane.ts`

## `NORMAL_POLL_MS`

- Value: `1000`
- Source expression: `1_000`
- Source: `src/lib/realtime-change-control-plane.ts`

## `CACHE_TTL_MS`

- Value: `300000`
- Source expression: `5 * 60 * 1000`
- Source: `src/lib/retention-policy.ts`

## `RETENTION_RESOURCE_NAMESPACE`

- Value: `9141008`
- Source expression: `9141008`
- Source: `src/lib/retention/resource-lock.ts`

## `MAX_POSSIBLE_TOKEN_LIFETIME_MS`

- Value: `7776000000`
- Source expression: `90 * 24 * 60 * 60 * 1000`
- Source: `src/lib/session-registry.ts`

## `MAX_SESSION_RECORD_AGE_MS`

- Value: `8640000000`
- Source expression: `100 * 24 * 60 * 60 * 1000`
- Source: `src/lib/session-registry.ts`

## `DEFAULT_ACK_TARGET_MINUTES`

- Value: `15`
- Source expression: `15`
- Source: `src/lib/sla-server.ts`

## `DEFAULT_INCIDENT_DISPLAY_LIMIT`

- Value: `50`
- Source expression: `50`
- Source: `src/lib/sla-server.ts`

## `DEFAULT_RESOLVE_TARGET_MINUTES`

- Value: `120`
- Source expression: `120`
- Source: `src/lib/sla-server.ts`

## `MAX_TIMESTAMP_SKEW_SECONDS`

- Value: `300`
- Source expression: `300`
- Source: `src/lib/slack-signature.ts`

## `SECRET_CACHE_TTL_MS`

- Value: `60000`
- Source expression: `60_000`
- Source: `src/lib/slack-signature.ts`

## `DEFAULT_RATE_LIMIT_MAX`

- Value: `120`
- Source expression: `120`
- Source: `src/lib/status-api-auth.ts`

## `DEFAULT_RATE_LIMIT_WINDOW_SEC`

- Value: `60`
- Source expression: `60`
- Source: `src/lib/status-api-auth.ts`

## `BATCH_SIZE`

- Value: `25`
- Source expression: `25`
- Source: `src/lib/status-page-webhooks.ts`

## `MAX_STATUS_PAGES`

- Value: `1`
- Source expression: `1`
- Source: `src/lib/status-pages/admin.ts`

## `STATUS_PAGE_DISPLAY_FEED_LIMIT`

- Value: `200`
- Source expression: `200`
- Source: `src/lib/status-pages/display-feeds.ts`

## `MAX_LAST_ERROR_LENGTH`

- Value: `500`
- Source expression: `500`
- Source: `src/lib/status-pages/publish-configuration.ts`

## `MAX_ERROR_LENGTH`

- Value: `500`
- Source expression: `500`
- Source: `src/lib/status-pages/route-operations.ts`

## `DEFAULT_SNAPSHOT_MAX_BYTES`

- Value: `5242880`
- Source expression: `5 * 1024 * 1024`
- Source: `src/lib/status-pages/snapshot.ts`

## `VERIFICATION_TTL_MS`

- Value: `604800000`
- Source expression: `7 * 24 * 60 * 60 * 1000`
- Source: `src/lib/status-pages/subscriptions.ts`

## `FRESH_TTL_MS`

- Value: `20000`
- Source expression: `20_000`
- Source: `src/lib/status/internal-operational-status-snapshot.ts`

## `MAX_CONCURRENT_CALCULATIONS`

- Value: `4`
- Source expression: `4`
- Source: `src/lib/status/internal-operational-status-snapshot.ts`

## `MAX_ENTRIES`

- Value: `300`
- Source expression: `300`
- Source: `src/lib/status/internal-operational-status-snapshot.ts`

## `STALE_TTL_MS`

- Value: `300000`
- Source expression: `5 * 60_000`
- Source: `src/lib/status/internal-operational-status-snapshot.ts`

## `AMBIGUOUS_RECONCILIATION_WINDOW_MS`

- Value: `900000`
- Source expression: `15 * 60_000`
- Source: `src/lib/war-room/engine.ts`

## `AMBIGUOUS_RECONCILIATION_WINDOW_MS`

- Value: `900000`
- Source expression: `15 * 60_000`
- Source: `src/lib/war-room/providers/microsoft-teams/provision.ts`

## `AMBIGUOUS_RECONCILIATION_WINDOW_MS`

- Value: `900000`
- Source expression: `15 * 60_000`
- Source: `src/lib/war-room/providers/slack/provision.ts`

## `TERMINAL_DRIFT_MIN_RETRY_MS`

- Value: `300000`
- Source expression: `5 * 60_000`
- Source: `src/lib/war-room/terminal-cleanup.ts`

## `MAX_RESPONSE_BODY_BYTES`

- Value: `65536`
- Source expression: `64 * 1024`
- Source: `src/lib/webhooks.ts`

## `FRESH_TTL_MS`

- Value: `30000`
- Source expression: `30_000`
- Source: `src/lib/widget-data-cache.ts`

## `MAX_WIDGET_CACHE_ENTRIES`

- Value: `1000`
- Source expression: `1_000`
- Source: `src/lib/widget-data-cache.ts`

## `STALE_TTL_MS`

- Value: `300000`
- Source expression: `5 * 60_000`
- Source: `src/lib/widget-data-cache.ts`

## `DASHBOARD_ACK_ATTENTION_WINDOW_MS`

- Value: `900000`
- Source expression: `15 * 60 * 1000`
- Source: `src/lib/widget-data-provider.ts`

## `DASHBOARD_RESOLVE_ATTENTION_WINDOW_MS`

- Value: `1800000`
- Source expression: `30 * 60 * 1000`
- Source: `src/lib/widget-data-provider.ts`

## `STATUS_ROUTE_CACHE_MAX_ENTRIES`

- Value: `1000`
- Source expression: `1_000`
- Source: `src/middleware.ts`

## `STATUS_ROUTE_MAX_STALE_MS`

- Value: `300000`
- Source expression: `5 * 60_000`
- Source: `src/middleware.ts`

## `STATUS_ROUTE_NEGATIVE_TTL_MS`

- Value: `10000`
- Source expression: `10_000`
- Source: `src/middleware.ts`

## `STATUS_ROUTE_POSITIVE_TTL_MS`

- Value: `60000`
- Source expression: `60_000`
- Source: `src/middleware.ts`
