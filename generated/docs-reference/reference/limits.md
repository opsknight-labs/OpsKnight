---
title: Runtime limits
description: Generated limits, timeouts, rates, concurrency bounds, and retention constants.
type: reference
product_area: configuration
audience: [developer, operator, administrator]
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - generated/docs-discovery/current.json
    - src/
---

# Runtime limits

This page is generated from named numeric constants and explicit maximum-value
messages in source. A discovered constant is not automatically a public promise;
use its source and owning feature to interpret scope. Scanner output is kept here
to prevent copied values from silently drifting.

## `RATE_LIMIT_MAX`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `60`
- Source expression: `60`
- Source: `src/app/api/admin/sla-performance/route.ts`

## `RATE_LIMIT_WINDOW_MS`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `60000`
- Source expression: `60 * 1000`
- Source: `src/app/api/admin/sla-performance/route.ts`

## `RATE_LIMIT_MAX`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `120`
- Source expression: `120`
- Source: `src/app/api/events/route.ts`

## `RATE_LIMIT_WINDOW_MS`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `60000`
- Source expression: `60_000`
- Source: `src/app/api/events/route.ts`

## `RATE_LIMIT_MAX`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `60`
- Source expression: `60`
- Source: `src/app/api/incidents/[id]/route.ts`

## `RATE_LIMIT_WINDOW_MS`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `60000`
- Source expression: `60_000`
- Source: `src/app/api/incidents/[id]/route.ts`

## `RATE_LIMIT_MAX`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `30`
- Source expression: `30`
- Source: `src/app/api/incidents/create/route.ts`

## `RATE_LIMIT_WINDOW_MS`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `60000`
- Source expression: `60_000`
- Source: `src/app/api/incidents/create/route.ts`

## `RATE_LIMIT_BURST`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `120`
- Source expression: `120`
- Source: `src/app/api/incidents/route.ts`

## `RATE_LIMIT_MAX`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `60`
- Source expression: `60`
- Source: `src/app/api/incidents/route.ts`

## `RATE_LIMIT_WINDOW_MS`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `60000`
- Source expression: `60_000`
- Source: `src/app/api/incidents/route.ts`

## `RATE_LIMIT_MAX`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `30`
- Source expression: `30`
- Source: `src/app/api/logs/ingest/route.ts`

## `RATE_LIMIT_WINDOW_MS`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `60000`
- Source expression: `60_000`
- Source: `src/app/api/logs/ingest/route.ts`

## `TEAMS_CHANNELS_CAN_BE_LINKED_TO_A_SERVICE`

- Classification: `PUBLIC_CONTRACT`
- Value: `3`
- Source expression: `maximum of 3 Teams channels can be linked to a service`
- Source: `src/app/api/microsoft-teams/destinations/route.ts`

## `RATE_LIMIT_MAX`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `30`
- Source expression: `30`
- Source: `src/app/api/sidebar-stats/route.ts`

## `RATE_LIMIT_WINDOW_MS`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `60000`
- Source expression: `60_000`
- Source: `src/app/api/sidebar-stats/route.ts`

## `RATE_LIMIT_MAX`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `30`
- Source expression: `30`
- Source: `src/app/api/sla/stream/route.ts`

## `RATE_LIMIT_WINDOW_MS`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `900000`
- Source expression: `15 * 60 * 1000`
- Source: `src/app/api/sla/stream/route.ts`

## `SLACK_CHANNELS_CAN_BE_LINKED_TO_A_SERVICE`

- Classification: `PUBLIC_CONTRACT`
- Value: `3`
- Source expression: `maximum of 3 Slack channels can be linked to a service`
- Source: `src/app/api/slack/destinations/route.ts`

## `BOOTSTRAP_RATE_WINDOW_MS`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `900000`
- Source expression: `15 * 60 * 1000`
- Source: `src/app/setup/actions.ts`

## `REQUEST_TIMEOUT_MS`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `12000`
- Source expression: `12_000`
- Source: `src/components/mobile/PushNotificationToggle.tsx`

## `MAX_STORED_ALERT_PAYLOAD_BYTES`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `65536`
- Source expression: `64 * 1024`
- Source: `src/lib/events.ts`

## `MAX_INTEGRATION_BODY_BYTES`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `1048576`
- Source expression: `1024 * 1024`
- Source: `src/lib/integrations/request-security.ts`

## `JIRA_REQUEST_TIMEOUT_MS`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `8000`
- Source expression: `8_000`
- Source: `src/lib/jira.ts`

## `TOKEN_CACHE_MAX`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `50`
- Source expression: `50`
- Source: `src/lib/microsoft-teams/client.ts`

## `ADAPTIVE_MAX_ENTRIES`

- Classification: `OPERATOR_TUNABLE`
- Value: `1024`
- Source expression: `1024`
- Source: `src/lib/notification-capacity/resolver.ts`

## `USER_VERSION_RETENTION_MS`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `300000`
- Source expression: `5 * 60_000`
- Source: `src/lib/notification-change-clock.ts`

## `MAX_ENCRYPTED_PAYLOAD_BYTES`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `786432`
- Source expression: `768 * 1024`
- Source: `src/lib/notification-control-plane.ts`

## `TERMINAL_RETENTION_MS`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `86400000`
- Source expression: `24 * 60 * 60 * 1000`
- Source: `src/lib/offline-queue.ts`

## `COMPLETION_WINDOW_MS`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `900000`
- Source expression: `15 * 60 * 1000`
- Source: `src/lib/password-reset.ts`

## `INIT_IDENTIFIER_WINDOW_MS`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `3600000`
- Source expression: `60 * 60 * 1000`
- Source: `src/lib/password-reset.ts`

## `INIT_IP_WINDOW_MS`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `900000`
- Source expression: `15 * 60 * 1000`
- Source: `src/lib/password-reset.ts`

## `RESET_TOKEN_TTL_MS`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `1800000`
- Source expression: `30 * 60 * 1000`
- Source: `src/lib/password-reset.ts`

## `PASSWORD_MAX_LENGTH`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `64`
- Source expression: `64`
- Source: `src/lib/passwords.ts`

## `PASSWORD_MAX_UTF8_BYTES`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `72`
- Source expression: `72`
- Source: `src/lib/passwords.ts`

## `PASSWORD_MIN_LENGTH`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `15`
- Source expression: `15`
- Source: `src/lib/passwords.ts`

## `PASSWORD_TRANSPORT_MAX_CODE_UNITS`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `256`
- Source expression: `256`
- Source: `src/lib/passwords.ts`

## `MAX_TRUSTED_PWA_DAYS`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `90`
- Source expression: `90`
- Source: `src/lib/pwa-session-policy.ts`

## `MIN_TRUSTED_PWA_DAYS`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `30`
- Source expression: `30`
- Source: `src/lib/pwa-session-policy.ts`

## `CACHE_TTL_MS`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `300000`
- Source expression: `5 * 60 * 1000`
- Source: `src/lib/retention-policy.ts`

## `RETENTION_RESOURCE_NAMESPACE`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `9141008`
- Source expression: `9141008`
- Source: `src/lib/retention/resource-lock.ts`

## `MAX_POSSIBLE_TOKEN_LIFETIME_MS`

- Classification: `OPERATOR_TUNABLE`
- Value: `7776000000`
- Source expression: `90 * 24 * 60 * 60 * 1000`
- Source: `src/lib/session-registry.ts`

## `MAX_SESSION_RECORD_AGE_MS`

- Classification: `OPERATOR_TUNABLE`
- Value: `8640000000`
- Source expression: `100 * 24 * 60 * 60 * 1000`
- Source: `src/lib/session-registry.ts`

## `DEFAULT_RATE_LIMIT_MAX`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `120`
- Source expression: `120`
- Source: `src/lib/status-api-auth.ts`

## `DEFAULT_RATE_LIMIT_WINDOW_SEC`

- Classification: `SECURITY_OR_PUBLIC_BOUND`
- Value: `60`
- Source expression: `60`
- Source: `src/lib/status-api-auth.ts`

## `MAX_LAST_ERROR_LENGTH`

- Classification: `OPERATOR_TUNABLE`
- Value: `500`
- Source expression: `500`
- Source: `src/lib/status-pages/publish-configuration.ts`

## `DEFAULT_SNAPSHOT_MAX_BYTES`

- Classification: `OPERATOR_TUNABLE`
- Value: `5242880`
- Source expression: `5 * 1024 * 1024`
- Source: `src/lib/status-pages/snapshot.ts`

## `STATUS_ROUTE_CACHE_MAX_ENTRIES`

- Classification: `OPERATOR_TUNABLE`
- Value: `1000`
- Source expression: `1_000`
- Source: `src/middleware.ts`

## `STATUS_ROUTE_MAX_STALE_MS`

- Classification: `OPERATOR_TUNABLE`
- Value: `300000`
- Source expression: `5 * 60_000`
- Source: `src/middleware.ts`

## `STATUS_ROUTE_NEGATIVE_TTL_MS`

- Classification: `OPERATOR_TUNABLE`
- Value: `10000`
- Source expression: `10_000`
- Source: `src/middleware.ts`

## `STATUS_ROUTE_POSITIVE_TTL_MS`

- Classification: `OPERATOR_TUNABLE`
- Value: `60000`
- Source expression: `60_000`
- Source: `src/middleware.ts`
