---
title: PagerDuty Events API
description: Point a PagerDuty Events API v2-compatible sender at OpsKnight and preserve alert lifecycle correlation.
type: integration
product_area: integrations
audience: [administrator, operator]
reader: { status: READER_COMPLETE, task: "Connect PagerDuty lifecycle events and verify trigger acknowledge and resolve correlation." }
keywords: ["PagerDuty Events API webhook", "connect PagerDuty Events API", "PagerDuty Events API alerts", "PagerDuty Events API integration"]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/integrations/pagerduty.ts
    - src/app/api/integrations/pagerduty/route.ts
---

# PagerDuty Events API

## What it does

The adapter is an **Events API v2-compatible receiver**. It lets an alert sender
that already produces PagerDuty Events API v2 payloads send those events to
OpsKnight instead. It is useful during a PagerDuty migration or behind a relay
that targets more than one incident platform.

This is not a PagerDuty webhook-subscription endpoint. PagerDuty's own outbound
webhooks use a different payload contract and must be transformed by a relay
before they can be sent here.

## Prerequisites

- An OpsKnight service and enabled integration record.
- The integration identifier.
- Control of the monitoring tool, script, or relay that currently sends
  PagerDuty Events API v2 requests.
- A network path from the provider to the OpsKnight web runtime.

## Setup and configuration

1. In OpsKnight, open **Services → your service → Integrations**.
2. Select **Add integration → PagerDuty Events API**, then save the integration.
3. Copy the webhook URL and integration key shown by OpsKnight. Use the complete
   URL; it identifies the integration record.
4. In the sending monitor or relay, replace its PagerDuty Events API v2 target
   with the OpsKnight URL. Keep `POST` and `Content-Type: application/json`.
5. Put the OpsKnight integration key in `routing_key`. Alternatively, send it as
   `routingKey`, `key` or `token` in the query string, `X-Routing-Key`, or a
   bearer token. Do not send a real PagerDuty routing key to OpsKnight.
6. Keep a stable `dedup_key` for all states of one alert. Send `event_action` as
   `trigger`, `acknowledge`, or `resolve` and include `payload.summary`,
   `payload.source`, and a supported `payload.severity`.
7. Send a trigger from a non-production alert, acknowledge it, and resolve it.
   Verify that OpsKnight updates one incident rather than creating three.

Provider console labels can change independently of OpsKnight. Use the webhook
or notification configuration area in the provider rather than copying a URL
from another service. Treat keys and signature secrets as credentials; never
place them in logs or source control.

## Authentication and request verification

The endpoint requires the OpsKnight integration key. When the URL contains an
`integrationId`, the route compares the supplied key with the stored integration
key. Without an `integrationId`, it looks up the enabled PagerDuty integration by
the supplied key. There is no separate request-signature contract.
The exact payload schema is defined by `src/app/api/integrations/pagerduty/route.ts` and `src/lib/integrations/pagerduty.ts`.

- Method: `POST`
- Integration identifier: optional `integrationId` query parameter
- Integration key transports: JSON `routing_key` or `routingKey`; query `key` or
  `token`; `X-Routing-Key`; or `Authorization: Bearer …`
- Schema: `shared provider schema`
- Body limit: 1048576 bytes (1 MiB)
- Rate limit: 100 requests per 60 seconds, per integration

## Event mapping and incident lifecycle

The adapter emits the lifecycle actions found in its current source:
- `trigger`
- `acknowledge`
- `resolve`
Correlation uses `dedup_key` (or `dedupKey`). When neither is present, the
adapter derives a fallback from the summary. Explicitly sending a stable,
provider-owned key is safer because summary text can change.

## Recovery and deduplication

The route does not use a delivery ID. Retries and lifecycle updates converge on
the adapter correlation key. Reusing one key for unrelated alerts merges them;
changing it between trigger and resolve leaves the original incident open.

## Limits and testing

Per-integration rate limiting protects the ingestion path. Send a representative
trigger and recovery pair in a non-production service, verify that one incident
is created, and confirm that recovery updates that incident rather than creating
another.

## Verify the connection

After the test alert, confirm all of the following:

- One incident appears for the selected OpsKnight service.
- The incident source identifies PagerDuty Events API.
- A repeat event updates or correlates according to the adapter identity.
- A recovery event resolves the correlated incident.

## Error reference

- `202`: the event was accepted; the response includes the normalized
  `dedup_key`.
- `400`: invalid JSON, invalid schema, or no integration key.
- `401`: the key does not match the integration named in `integrationId`.
- `404`: the integration does not exist, is disabled, has another type, or no
  enabled PagerDuty integration matches the key.
- `413`: the request exceeds 1 MiB.
- `429`: more than 100 requests reached this integration in 60 seconds.
- `500`: processing failed after validation.

## Troubleshooting

1. Confirm the integration is enabled and belongs to the intended service.
2. Verify the integration ID in the URL and the OpsKnight key in
   `routing_key`; rotate any key that may have been exposed.
3. Inspect **Settings → Integrations → Failures** for validation or signature errors.
4. Check for `413` before changing payload templates and `429` before retrying rapidly.
5. Confirm the sender uses Events API v2 fields, not PagerDuty webhook
   subscription fields such as an `event` envelope.
6. Compare `dedup_key` across trigger and resolve payloads. They must be exactly
   equal.
7. Preserve a redacted payload, response status, normalized `dedup_key`, and
   timestamp when escalating.

## Related pages

- [Integration troubleshooting](../../troubleshooting/integrations/webhook-rejected)
- [Incident lifecycle](../../concepts/incidents)
- [Services](../../concepts/services)
- [Events API](../../reference/api/events)

## Security

Use HTTPS, rotate exposed keys at both systems, configure signature verification
when supported, and restrict provider egress or ingress controls without blocking
legitimate retries.
