---
title: API route inventory
description: Generated inventory of implemented HTTP API route modules.
type: reference
product_area: api
audience: [developer, operator, administrator]
verification:
  level: source
  verified_at: 2026-09-30
  evidence:
    - src/app/api/
---

# API route inventory

This page classifies route modules implemented under `src/app/api`. It is an
implementation inventory, not a public stability promise. Alert-ingestion
contracts live in the provider pages; webhook, health, metrics, SCIM, and OIDC
surfaces use their dedicated references. Everything in the internal section is
explicitly unsupported for third-party automation.

Supported general-purpose contracts are documented separately:

- [Authentication](./authentication)
- [Events API v2](./events)
- [Incidents API](./incidents)
- [Responses and errors](./errors)

## Application and internal UI endpoints

> These routes support the OpsKnight UI and are not a supported external API contract. Do not build external automation against them unless a dedicated contract page says otherwise.

- `GET /api/action-items/owners` — `src/app/api/action-items/owners/route.ts`
- `POST /api/admin/generate-reset-link` — `src/app/api/admin/generate-reset-link/route.ts`
- `POST /api/admin/incident-collaboration/meetings/[meetingId]/retry-cleanup` — `src/app/api/admin/incident-collaboration/meetings/[meetingId]/retry-cleanup/route.ts`
- `GET, POST /api/admin/incident-collaboration` — `src/app/api/admin/incident-collaboration/route.ts`
- `GET, PATCH /api/admin/notifications/capacity` — `src/app/api/admin/notifications/capacity/route.ts`
- `POST /api/admin/notifications/operations/[id]/retry` — `src/app/api/admin/notifications/operations/[id]/retry/route.ts`
- `GET /api/admin/notifications/operations` — `src/app/api/admin/notifications/operations/route.ts`
- `POST /api/admin/notifications/providers/[key]/test` — `src/app/api/admin/notifications/providers/[key]/test/route.ts`
- `POST /api/admin/rollups/backfill` — `src/app/api/admin/rollups/backfill/route.ts`
- `GET /api/admin/rollups/health` — `src/app/api/admin/rollups/health/route.ts`
- `DELETE /api/admin/rollups` — `src/app/api/admin/rollups/route.ts`
- `GET /api/admin/sla-drift` — `src/app/api/admin/sla-drift/route.ts`
- `GET /api/admin/sla-performance` — `src/app/api/admin/sla-performance/route.ts`
- `POST /api/admin/war-rooms/[warRoomId]/repair` — `src/app/api/admin/war-rooms/[warRoomId]/repair/route.ts`
- `GET /api/admin/war-rooms/[warRoomId]` — `src/app/api/admin/war-rooms/[warRoomId]/route.ts`
- `GET /api/admin/war-rooms` — `src/app/api/admin/war-rooms/route.ts`
- `GET /api/analytics/export` — `src/app/api/analytics/export/route.ts`
- `GET, POST /api/auth/[...nextauth]` — `src/app/api/auth/[...nextauth]/route.ts`
- `POST /api/auth/forgot-password` — `src/app/api/auth/forgot-password/route.ts`
- `GET /api/auth/oidc/logout-url` — `src/app/api/auth/oidc/logout-url/route.ts`
- `POST /api/auth/reset-password` — `src/app/api/auth/reset-password/route.ts`
- `GET /api/avatar` — `src/app/api/avatar/route.ts`
- `GET /api/compliance/control-center` — `src/app/api/compliance/control-center/route.ts`
- `GET /api/compliance/controls/[id]/evaluations` — `src/app/api/compliance/controls/[id]/evaluations/route.ts`
- `GET /api/compliance/controls/[id]/evidence` — `src/app/api/compliance/controls/[id]/evidence/route.ts`
- `GET /api/compliance/controls/[id]/framework-mappings` — `src/app/api/compliance/controls/[id]/framework-mappings/route.ts`
- `GET /api/compliance/controls` — `src/app/api/compliance/controls/route.ts`
- `POST /api/compliance/drift/[id]/acknowledge` — `src/app/api/compliance/drift/[id]/acknowledge/route.ts`
- `GET /api/compliance/drift/[id]` — `src/app/api/compliance/drift/[id]/route.ts`
- `GET /api/compliance/drift` — `src/app/api/compliance/drift/route.ts`
- `GET /api/compliance/encryption/retirement-readiness` — `src/app/api/compliance/encryption/retirement-readiness/route.ts`
- `GET, POST /api/compliance/encryption/runs/[id]` — `src/app/api/compliance/encryption/runs/[id]/route.ts`
- `GET, POST /api/compliance/encryption/runs` — `src/app/api/compliance/encryption/runs/route.ts`
- `GET /api/compliance/encryption/status` — `src/app/api/compliance/encryption/status/route.ts`
- `GET /api/compliance/evaluations/[id]/evidence` — `src/app/api/compliance/evaluations/[id]/evidence/route.ts`
- `POST /api/compliance/evaluations` — `src/app/api/compliance/evaluations/route.ts`
- `GET /api/compliance/evidence` — `src/app/api/compliance/evidence/route.ts`
- `POST /api/compliance/exports/preview` — `src/app/api/compliance/exports/preview/route.ts`
- `POST /api/compliance/exports` — `src/app/api/compliance/exports/route.ts`
- `GET /api/compliance/frameworks/[id]/requirements/[requirementId]` — `src/app/api/compliance/frameworks/[id]/requirements/[requirementId]/route.ts`
- `GET /api/compliance/frameworks/[id]/requirements` — `src/app/api/compliance/frameworks/[id]/requirements/route.ts`
- `GET /api/compliance/frameworks/[id]` — `src/app/api/compliance/frameworks/[id]/route.ts`
- `GET /api/compliance/frameworks` — `src/app/api/compliance/frameworks/route.ts`
- `GET /api/compliance/monitoring` — `src/app/api/compliance/monitoring/route.ts`
- `POST /api/compliance/monitoring/runs` — `src/app/api/compliance/monitoring/runs/route.ts`
- `GET /api/compliance/privacy-discovery` — `src/app/api/compliance/privacy-discovery/route.ts`
- `POST /api/compliance/privacy-requests/[id]/assign` — `src/app/api/compliance/privacy-requests/[id]/assign/route.ts`
- `POST /api/compliance/privacy-requests/[id]/erasure/execute` — `src/app/api/compliance/privacy-requests/[id]/erasure/execute/route.ts`
- `GET /api/compliance/privacy-requests/[id]/erasure/preview` — `src/app/api/compliance/privacy-requests/[id]/erasure/preview/route.ts`
- `GET /api/compliance/privacy-requests/[id]/export/[artifactId]/download` — `src/app/api/compliance/privacy-requests/[id]/export/[artifactId]/download/route.ts`
- `POST /api/compliance/privacy-requests/[id]/export` — `src/app/api/compliance/privacy-requests/[id]/export/route.ts`
- `GET /api/compliance/privacy-requests/[id]` — `src/app/api/compliance/privacy-requests/[id]/route.ts`
- `POST /api/compliance/privacy-requests/[id]/transition` — `src/app/api/compliance/privacy-requests/[id]/transition/route.ts`
- `GET, POST /api/compliance/privacy-requests` — `src/app/api/compliance/privacy-requests/route.ts`
- `GET /api/compliance/privacy-requests/subjects` — `src/app/api/compliance/privacy-requests/subjects/route.ts`
- `POST /api/compliance/retention-holds/[id]/release` — `src/app/api/compliance/retention-holds/[id]/release/route.ts`
- `GET /api/compliance/retention-holds/[id]` — `src/app/api/compliance/retention-holds/[id]/route.ts`
- `GET, POST /api/compliance/retention-holds` — `src/app/api/compliance/retention-holds/route.ts`
- `GET /api/dashboard/analytics` — `src/app/api/dashboard/analytics/route.ts`
- `GET /api/dashboard/metrics` — `src/app/api/dashboard/metrics/route.ts`
- `GET, PUT, DELETE /api/dashboards/[id]` — `src/app/api/dashboards/[id]/route.ts`
- `GET, POST /api/dashboards` — `src/app/api/dashboards/route.ts`
- `POST /api/events` — `src/app/api/events/route.ts`
- `GET /api/events/stream` — `src/app/api/events/stream/route.ts`
- `GET /api/incidents/[id]/collaboration` — `src/app/api/incidents/[id]/collaboration/route.ts`
- `GET /api/incidents/[id]/context` — `src/app/api/incidents/[id]/context/route.ts`
- `POST /api/incidents/[id]/custom-fields` — `src/app/api/incidents/[id]/custom-fields/route.ts`
- `GET, POST /api/incidents/[id]/meeting` — `src/app/api/incidents/[id]/meeting/route.ts`
- `GET, PATCH /api/incidents/[id]` — `src/app/api/incidents/[id]/route.ts`
- `POST, PATCH /api/incidents/[id]/status` — `src/app/api/incidents/[id]/status/route.ts`
- `POST /api/incidents/[id]/war-rooms/[roomId]/abandon` — `src/app/api/incidents/[id]/war-rooms/[roomId]/abandon/route.ts`
- `POST /api/incidents/[id]/war-rooms/[roomId]/close` — `src/app/api/incidents/[id]/war-rooms/[roomId]/close/route.ts`
- `POST /api/incidents/[id]/war-rooms/[roomId]/project` — `src/app/api/incidents/[id]/war-rooms/[roomId]/project/route.ts`
- `POST /api/incidents/[id]/war-rooms/[roomId]/reconcile` — `src/app/api/incidents/[id]/war-rooms/[roomId]/reconcile/route.ts`
- `POST /api/incidents/[id]/war-rooms/[roomId]/sync` — `src/app/api/incidents/[id]/war-rooms/[roomId]/sync/route.ts`
- `POST /api/incidents/[id]/war-rooms/microsoft-teams` — `src/app/api/incidents/[id]/war-rooms/microsoft-teams/route.ts`
- `GET, POST /api/incidents/[id]/war-rooms` — `src/app/api/incidents/[id]/war-rooms/route.ts`
- `POST /api/incidents/create` — `src/app/api/incidents/create/route.ts`
- `GET /api/incidents/export` — `src/app/api/incidents/export/route.ts`
- `GET, POST /api/incidents` — `src/app/api/incidents/route.ts`
- `POST /api/jira/test` — `src/app/api/jira/test/route.ts`
- `POST /api/jira/webhook` — `src/app/api/jira/webhook/route.ts`
- `POST /api/logs/ingest` — `src/app/api/logs/ingest/route.ts`
- `GET, POST, PATCH, DELETE /api/microsoft-teams/destinations` — `src/app/api/microsoft-teams/destinations/route.ts`
- `GET /api/microsoft-teams/discovery/channels` — `src/app/api/microsoft-teams/discovery/channels/route.ts`
- `GET /api/microsoft-teams/discovery/teams` — `src/app/api/microsoft-teams/discovery/teams/route.ts`
- `GET, POST /api/microsoft-teams/messages` — `src/app/api/microsoft-teams/messages/route.ts`
- `GET /api/microsoft-teams/package` — `src/app/api/microsoft-teams/package/route.ts`
- `POST /api/microsoft-teams/test` — `src/app/api/microsoft-teams/test/route.ts`
- `POST, PATCH /api/mobile/incidents/[id]/status` — `src/app/api/mobile/incidents/[id]/status/route.ts`
- `POST /api/mobile/refresh` — `src/app/api/mobile/refresh/route.ts`
- `GET /api/notifications/history` — `src/app/api/notifications/history/route.ts`
- `GET, PATCH /api/notifications` — `src/app/api/notifications/route.ts`
- `GET /api/notifications/stream` — `src/app/api/notifications/stream/route.ts`
- `POST /api/notifications/test-push` — `src/app/api/notifications/test-push/route.ts`
- `GET /api/prefer-desktop` — `src/app/api/prefer-desktop/route.ts`
- `GET /api/public-logs` — `src/app/api/public-logs/route.ts`
- `GET /api/realtime/stream` — `src/app/api/realtime/stream/route.ts`
- `GET /api/reports/metrics` — `src/app/api/reports/metrics/route.ts`
- `GET /api/schedules/[id]/calendar.ics` — `src/app/api/schedules/[id]/calendar.ics/route.ts`
- `GET /api/schedules/[id]/oncall` — `src/app/api/schedules/[id]/oncall/route.ts`
- `GET /api/schedules/[id]` — `src/app/api/schedules/[id]/route.ts`
- `GET /api/schedules` — `src/app/api/schedules/route.ts`
- `GET /api/search` — `src/app/api/search/route.ts`
- `GET /api/services/[id]` — `src/app/api/services/[id]/route.ts`
- `GET /api/services` — `src/app/api/services/route.ts`
- `GET, POST /api/settings/app-url` — `src/app/api/settings/app-url/route.ts`
- `GET, DELETE /api/settings/chatops/identities` — `src/app/api/settings/chatops/identities/route.ts`
- `PATCH, DELETE /api/settings/custom-fields/[id]` — `src/app/api/settings/custom-fields/[id]/route.ts`
- `GET, POST /api/settings/custom-fields` — `src/app/api/settings/custom-fields/route.ts`
- `GET /api/settings/email-providers` — `src/app/api/settings/email-providers/route.ts`
- `POST, DELETE /api/settings/microsoft-teams` — `src/app/api/settings/microsoft-teams/route.ts`
- `GET, POST /api/settings/notifications` — `src/app/api/settings/notifications/route.ts`
- `GET, POST, PUT /api/settings/retention` — `src/app/api/settings/retention/route.ts`
- `POST, DELETE /api/settings/slack-oauth` — `src/app/api/settings/slack-oauth/route.ts`
- `POST, PATCH, DELETE /api/settings/status-page/announcements` — `src/app/api/settings/status-page/announcements/route.ts`
- `POST, DELETE /api/settings/status-page/api-tokens` — `src/app/api/settings/status-page/api-tokens/route.ts`
- `POST /api/settings/status-page` — `src/app/api/settings/status-page/route.ts`
- `POST, PATCH /api/settings/status-pages/[pageId]/[section]` — `src/app/api/settings/status-pages/[pageId]/[section]/route.ts`
- `POST /api/settings/status-pages/[pageId]/make-default` — `src/app/api/settings/status-pages/[pageId]/make-default/route.ts`
- `POST /api/settings/status-pages/[pageId]/publish` — `src/app/api/settings/status-pages/[pageId]/publish/route.ts`
- `GET, POST, DELETE /api/settings/status-pages` — `src/app/api/settings/status-pages/route.ts`
- `GET /api/sidebar-stats` — `src/app/api/sidebar-stats/route.ts`
- `GET, PATCH, DELETE /api/sla-definitions/[id]` — `src/app/api/sla-definitions/[id]/route.ts`
- `GET, POST /api/sla-definitions` — `src/app/api/sla-definitions/route.ts`
- `GET /api/sla/compliance` — `src/app/api/sla/compliance/route.ts`
- `GET /api/sla/stream` — `src/app/api/sla/stream/route.ts`
- `POST /api/slack/actions` — `src/app/api/slack/actions/route.ts`
- `POST /api/slack/channels/leave` — `src/app/api/slack/channels/leave/route.ts`
- `GET, POST /api/slack/channels` — `src/app/api/slack/channels/route.ts`
- `POST /api/slack/commands` — `src/app/api/slack/commands/route.ts`
- `GET, POST, DELETE /api/slack/destinations` — `src/app/api/slack/destinations/route.ts`
- `DELETE /api/slack/disconnect` — `src/app/api/slack/disconnect/route.ts`
- `POST /api/slack/events` — `src/app/api/slack/events/route.ts`
- `GET /api/slack/oauth/callback` — `src/app/api/slack/oauth/callback/route.ts`
- `GET /api/slack/oauth` — `src/app/api/slack/oauth/route.ts`
- `POST /api/slack/test` — `src/app/api/slack/test/route.ts`
- `POST /api/slack/war-room` — `src/app/api/slack/war-room/route.ts`
- `GET /api/status-page/domains` — `src/app/api/status-page/domains/route.ts`
- `GET /api/status-page/logo/[id]` — `src/app/api/status-page/logo/[id]/route.ts`
- `POST /api/status-page/subscribe` — `src/app/api/status-page/subscribe/route.ts`
- `GET, DELETE /api/status-page/subscribers` — `src/app/api/status-page/subscribers/route.ts`
- `GET, POST, PATCH, DELETE /api/status-page/webhooks` — `src/app/api/status-page/webhooks/route.ts`
- `POST /api/status-page/webhooks/test` — `src/app/api/status-page/webhooks/test/route.ts`
- `GET /api/status/[slug]/history` — `src/app/api/status/[slug]/history/route.ts`
- `GET /api/status/[slug]` — `src/app/api/status/[slug]/route.ts`
- `GET /api/status/[slug]/rss` — `src/app/api/status/[slug]/rss/route.ts`
- `POST /api/status/[slug]/subscribe` — `src/app/api/status/[slug]/subscribe/route.ts`
- `GET /api/status/[slug]/uptime-export` — `src/app/api/status/[slug]/uptime-export/route.ts`
- `GET /api/status/history` — `src/app/api/status/history/route.ts`
- `GET /api/status` — `src/app/api/status/route.ts`
- `GET /api/status/rss` — `src/app/api/status/rss/route.ts`
- `POST /api/status/subscribe` — `src/app/api/status/subscribe/route.ts`
- `POST /api/status/subscriptions/unsubscribe` — `src/app/api/status/subscriptions/unsubscribe/route.ts`
- `POST /api/status/subscriptions/verify` — `src/app/api/status/subscriptions/verify/route.ts`
- `GET /api/status/uptime-export` — `src/app/api/status/uptime-export/route.ts`
- `GET /api/system/vapid-public-key` — `src/app/api/system/vapid-public-key/route.ts`
- `GET /api/teams/[id]/available-users` — `src/app/api/teams/[id]/available-users/route.ts`
- `POST, DELETE /api/user/push-subscription` — `src/app/api/user/push-subscription/route.ts`
- `POST /api/user/push-subscription/status` — `src/app/api/user/push-subscription/status/route.ts`
- `GET, POST, DELETE /api/user/sessions` — `src/app/api/user/sessions/route.ts`
- `GET /api/users/[id]/avatar` — `src/app/api/users/[id]/avatar/route.ts`
- `GET, PUT /api/v1/integrations/[id]/response-policy` — `src/app/api/v1/integrations/[id]/response-policy/route.ts`
- `GET, PUT /api/v1/response-policy/classification` — `src/app/api/v1/response-policy/classification/route.ts`
- `GET /api/v1/response-policy/diff` — `src/app/api/v1/response-policy/diff/route.ts`
- `GET /api/v1/response-policy/history` — `src/app/api/v1/response-policy/history/route.ts`
- `POST /api/v1/response-policy/preview` — `src/app/api/v1/response-policy/preview/route.ts`
- `POST /api/v1/response-policy/restore` — `src/app/api/v1/response-policy/restore/route.ts`
- `GET, PUT /api/v1/response-policy/sla` — `src/app/api/v1/response-policy/sla/route.ts`
- `GET, PUT /api/v1/response-policy/support-hours` — `src/app/api/v1/response-policy/support-hours/route.ts`
- `GET, PUT /api/v1/response-policy/workspace` — `src/app/api/v1/response-policy/workspace/route.ts`
- `GET /api/v1/service-objectives/[id]/evaluate` — `src/app/api/v1/service-objectives/[id]/evaluate/route.ts`
- `GET /api/v1/service-objectives/[id]/history` — `src/app/api/v1/service-objectives/[id]/history/route.ts`
- `GET, PATCH, DELETE /api/v1/service-objectives/[id]` — `src/app/api/v1/service-objectives/[id]/route.ts`
- `GET /api/v1/service-objectives/[id]/snapshots` — `src/app/api/v1/service-objectives/[id]/snapshots/route.ts`
- `GET /api/v1/service-objectives/[id]/versions` — `src/app/api/v1/service-objectives/[id]/versions/route.ts`
- `GET, POST /api/v1/service-objectives` — `src/app/api/v1/service-objectives/route.ts`
- `GET, PUT /api/v1/services/[id]/response-policy` — `src/app/api/v1/services/[id]/response-policy/route.ts`
- `GET /api/widgets/data` — `src/app/api/widgets/data/route.ts`
- `GET /api/widgets/stream` — `src/app/api/widgets/stream/route.ts`

## Operator health and metrics endpoints

- `GET /api/health/deep` — `src/app/api/health/deep/route.ts`
- `GET /api/health` — `src/app/api/health/route.ts`
- `GET /api/metrics` — `src/app/api/metrics/route.ts`

## Alert ingestion endpoints

- `POST /api/integrations/appdynamics` — `src/app/api/integrations/appdynamics/route.ts`
- `POST /api/integrations/azure` — `src/app/api/integrations/azure/route.ts`
- `POST /api/integrations/better-uptime` — `src/app/api/integrations/better-uptime/route.ts`
- `POST /api/integrations/bitbucket` — `src/app/api/integrations/bitbucket/route.ts`
- `POST /api/integrations/cloudwatch` — `src/app/api/integrations/cloudwatch/route.ts`
- `POST /api/integrations/datadog` — `src/app/api/integrations/datadog/route.ts`
- `POST /api/integrations/dynatrace` — `src/app/api/integrations/dynatrace/route.ts`
- `POST /api/integrations/elastic` — `src/app/api/integrations/elastic/route.ts`
- `GET, POST /api/integrations/failures` — `src/app/api/integrations/failures/route.ts`
- `POST /api/integrations/github` — `src/app/api/integrations/github/route.ts`
- `POST /api/integrations/gitlab` — `src/app/api/integrations/gitlab/route.ts`
- `POST /api/integrations/google-cloud-monitoring` — `src/app/api/integrations/google-cloud-monitoring/route.ts`
- `POST /api/integrations/grafana` — `src/app/api/integrations/grafana/route.ts`
- `GET, POST /api/integrations/health` — `src/app/api/integrations/health/route.ts`
- `POST /api/integrations/honeycomb` — `src/app/api/integrations/honeycomb/route.ts`
- `POST /api/integrations/icinga` — `src/app/api/integrations/icinga/route.ts`
- `POST /api/integrations/manageengine` — `src/app/api/integrations/manageengine/route.ts`
- `POST /api/integrations/nagios` — `src/app/api/integrations/nagios/route.ts`
- `POST /api/integrations/newrelic` — `src/app/api/integrations/newrelic/route.ts`
- `POST /api/integrations/pagerduty` — `src/app/api/integrations/pagerduty/route.ts`
- `POST /api/integrations/pagerduty/v2/enqueue` — `src/app/api/integrations/pagerduty/v2/enqueue/route.ts`
- `POST /api/integrations/pingdom` — `src/app/api/integrations/pingdom/route.ts`
- `POST /api/integrations/prometheus` — `src/app/api/integrations/prometheus/route.ts`
- `POST /api/integrations/sentry` — `src/app/api/integrations/sentry/route.ts`
- `POST /api/integrations/splunk-observability` — `src/app/api/integrations/splunk-observability/route.ts`
- `POST /api/integrations/splunk-oncall` — `src/app/api/integrations/splunk-oncall/route.ts`
- `POST /api/integrations/uptime-kuma` — `src/app/api/integrations/uptime-kuma/route.ts`
- `POST /api/integrations/uptimerobot` — `src/app/api/integrations/uptimerobot/route.ts`
- `POST /api/integrations/vercel` — `src/app/api/integrations/vercel/route.ts`
- `POST /api/integrations/webhook` — `src/app/api/integrations/webhook/route.ts`
- `POST /api/integrations/zabbix` — `src/app/api/integrations/zabbix/route.ts`

## Identity protocol endpoints

- `GET, PUT, PATCH, DELETE /api/scim/v2/Users/[id]` — `src/app/api/scim/v2/Users/[id]/route.ts`
- `GET, POST, PATCH /api/scim/v2/Users` — `src/app/api/scim/v2/Users/route.ts`

## Provider callback and webhook endpoints

- `POST /api/webhooks/notifications/provider-feedback` — `src/app/api/webhooks/notifications/provider-feedback/route.ts`
- `POST /api/webhooks/notifications/twilio` — `src/app/api/webhooks/notifications/twilio/route.ts`
- `POST /api/webhooks/notifications/twilio/voice/gather` — `src/app/api/webhooks/notifications/twilio/voice/gather/route.ts`
- `POST /api/webhooks/notifications/twilio/voice/status` — `src/app/api/webhooks/notifications/twilio/voice/status/route.ts`
