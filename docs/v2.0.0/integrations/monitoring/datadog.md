---
title: Datadog
description: Connect Datadog alerts to OpsKnight incident ingestion.
type: integration
reader:
  status: READER_COMPLETE
  task: Configure a Datadog Webhooks integration and verify monitor alert and recovery convergence.
product_area: integrations
audience: [administrator, operator]
keywords: ["Datadog webhook", "connect Datadog", "Datadog alerts", "Datadog integration"]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/integrations/datadog.ts
    - src/app/api/integrations/datadog/route.ts
---

# Datadog

## What it does

The Datadog adapter accepts inbound webhook events at
`/api/integrations/datadog`, validates them through its shared handler,
normalizes provider payloads, and submits lifecycle events to the configured
service.

## Prerequisites

- An OpsKnight service and enabled integration record.
- The integration identifier and generated integration key.
- Permission to configure webhooks in Datadog.
- A network path from the provider to the OpsKnight web runtime.

## Setup and configuration

1. In OpsKnight, open **Services → your service → Integrations**.
2. Select **Add integration → Datadog**, then save the integration.
3. Copy the webhook URL and integration key shown by OpsKnight.
4. In Datadog, open **Integrations → Integrations → Webhooks**, select **New**, and give the webhook a unique name such as `opsknight-payments-production`.
5. Paste the complete OpsKnight URL, including `integrationId`. Configure the integration key as a hidden custom variable and send it with one supported header, for example `x-integration-key`; do not put an unhidden secret in monitor text.
6. Keep encoding as JSON. Use a custom payload that supplies stable monitor identity and both alert/recovery state, for example:

```json
{
  "title": "$EVENT_TITLE",
  "text": "$TEXT_ONLY_MSG",
  "alert_type": "$ALERT_TYPE",
  "aggregation_key": "$ALERT_CYCLE_KEY",
  "host": "$HOSTNAME",
  "source_type_name": "datadog",
  "alert": {
    "id": "$ALERT_ID",
    "title": "$EVENT_TITLE",
    "status": "$ALERT_STATUS",
    "message": "$TEXT_ONLY_MSG"
  }
}
```

7. Save the webhook. Open the intended monitor and add `@webhook-opsknight-payments-production` to its notification message for the alert and recovery notifications you intend to send.
8. Use Datadog's webhook test where available, then transition a controlled monitor into alert and back to OK.

Provider console labels can change independently of OpsKnight. Use the webhook
or notification configuration area in the provider rather than copying a URL
from another service. Treat keys and signature secrets as credentials; never
place them in logs or source control.

## Authentication and request verification

The endpoint requires the integration identifier and validates the integration key using a timing-safe comparison.
Signature verification is **conditional-when-secret-configured** using the
`generic` verification contract.
The exact payload schema is defined by `src/app/api/integrations/datadog/route.ts` and `src/lib/integrations/datadog.ts`.

- Method: `POST`
- Integration identifier: query parameter
- Integration key transports: `Authorization: Bearer`, `Authorization: Token token=`, `x-integration-key`, `x-api-key`, `integrationKey query parameter`
- Schema: `shared provider schema`
- Body limit: 1048576 bytes (1 MiB)
- Rate limit: 100 requests per 60 seconds, per integration

## Event mapping and incident lifecycle

The adapter emits the lifecycle actions found in its current source:
- `trigger`
- `resolve`
`resolved`, `ok`, or a `success` alert type resolves; other states trigger. Correlation uses `aggregation_key`, then alert ID, then monitor ID, then a normalized-title hash. Prefer `$ALERT_CYCLE_KEY`/stable monitor identity so recovery updates the same incident.

## Recovery and deduplication

When signature verification runs, the shared handler attempts provider-specific delivery identity before claiming the inbound-delivery fence.
Incident convergence still depends on the adapter correlation key. Failed
deliveries are recorded for operational inspection without exposing secrets.

## Limits and testing

Per-integration rate limiting protects the ingestion path. Send a representative
trigger and recovery pair in a non-production service, verify that one incident
is created, and confirm that recovery updates that incident rather than creating
another.

## Verify the connection

After the test alert, confirm all of the following:

- One incident appears for the selected OpsKnight service.
- The incident source identifies Datadog.
- A repeat event updates or correlates according to the adapter identity.
- A recovery event resolves the correlated incident.

## Error reference

- `400` — Invalid request or payload validation failed.
- `401` — Integration is disabled, mismatched, or unauthorized.
- `404` — Integration record was not found.
- `413` — Payload exceeds the one MiB body limit.
- `429` — Per-integration request rate exceeded.
- `503` — A matching delivery is already being processed.

## Troubleshooting

1. Confirm the OpsKnight integration and Datadog webhook are enabled and that the monitor message mentions the correct `@webhook-<name>`.
2. Verify the complete URL, integration ID, hidden key/header, JSON encoding, and payload variable spelling.
3. Inspect **Settings → Integrations → Failures** and Datadog webhook/monitor notification history.
4. If alerts create incidents but OK does not resolve them, compare the alert/recovery correlation fields and `$ALERT_STATUS` value received.
5. Check for `413`, `429`, and 5xx. Datadog retries webhook delivery for its documented internal errors or 5xx responses; do not create a second webhook to force retry.
6. Preserve monitor ID, alert-cycle/aggregation key, state, webhook name, timestamp, and provider delivery evidence when escalating.

## Related pages

- [Integration troubleshooting](../../troubleshooting/integrations/webhook-rejected)
- [Incident lifecycle](../../concepts/incidents)
- [Services](../../concepts/services)
- [Events API](../../reference/api/events)

## Security

Use HTTPS, rotate exposed keys at both systems, configure signature verification
when supported, and restrict provider egress or ingress controls without blocking
legitimate retries.
