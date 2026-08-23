---
order: 6
title: Monitoring OpsKnight
description: Monitor health, database readiness, logs, resources, scheduled work, and synthetic incident delivery.
---

# Monitoring OpsKnight

Monitor OpsKnight as part of the incident-delivery path. A reachable login page alone does not prove that database work, integrations, escalation, or outbound notifications operate correctly.

## Health endpoint

```bash
curl --fail https://ops.example.com/api/health
curl --fail 'https://ops.example.com/api/health?mode=readiness'
```

The default `liveness` mode reports process metadata and memory and returns HTTP 200. `readiness` also runs a PostgreSQL `SELECT 1` with a five-second timeout and returns HTTP 503 when that dependency is unhealthy.

The JSON includes `status`, `mode`, `timestamp`, checks, process uptime, application version, environment, and a per-process instance ID. Treat the response shape as operational output, not a long-term metrics API.

Use liveness to detect a stuck/dead process and readiness to remove an instance that cannot reach PostgreSQL. Do not route production traffic based only on liveness.

## Signals to collect

| Layer         | Minimum signals                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| Application   | readiness failures, restarts, request errors/latency, memory/CPU, instance changes.                           |
| PostgreSQL    | availability, connections, query latency, locks, storage, WAL/replication and backup status where applicable. |
| Jobs          | scheduler start/tick/failure logs, escalation backlog, rollup and cleanup errors.                             |
| Integrations  | inbound non-2xx/rate limits/signature failures and provider-specific rejection patterns.                      |
| Notifications | failed Notification History records and email/SMS/push/WhatsApp/Slack/webhook provider errors.                |
| Platform      | ingress/TLS expiry, DNS, pod/container state, node/volume capacity.                                           |

Set `LOG_FORMAT=json` for structured collection and choose `LOG_LEVEL` deliberately. Avoid debug logging continuously in production; provider payloads and error context can contain sensitive operational data.

The source contains optional Sentry initialization controls (`SENTRY_DSN`, `SENTRY_ENVIRONMENT`, and `SENTRY_FORCE_ENABLE`), but the standard v1.3 dependency set does not include `@sentry/nextjs`. Do not rely on Sentry in the published image unless your maintained custom build installs and verifies that package. Web Vitals outside production can be enabled with `NEXT_PUBLIC_ENABLE_WEB_VITALS`; these controls do not replace server and database monitoring.

## Synthetic validation

Run a controlled synthetic workflow on a dedicated service and recipient:

1. Trigger a uniquely keyed event.
2. Confirm one incident is created and assigned to the expected on-call target.
3. Confirm the intended external notification leaves OpsKnight.
4. Resolve using the same deduplication key.
5. Confirm the incident and any chosen service/status webhook update.

Alert when any step breaches the expected time. Do not use a production customer service or noisy on-call destination for frequent probes.

## Alerting priorities

- Page for sustained readiness/database failure, total ingestion failure, or confirmed paging-path failure.
- Create urgent work for rapid database/storage growth, repeated migration/job failures, certificate expiry, or broad provider rejection.
- Ticket isolated recipient/configuration errors with the affected owner unless they indicate a systemic outage.

Avoid routing an OpsKnight-self outage solely through the same OpsKnight installation. Keep an independent monitoring and emergency-contact path.

## Related topics

- [Deployment](./README)
- [Notifications](../administration/notifications)
- [Troubleshooting](../troubleshooting)
- [Event log](../core-concepts/event-logs)
