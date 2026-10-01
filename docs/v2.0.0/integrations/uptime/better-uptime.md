---
title: Better Uptime
description: Connect Better Uptime alerts to OpsKnight incident ingestion.
type: integration
product_area: integrations
audience: [administrator, operator]
reader: { status: READER_COMPLETE, task: "Connect Better Uptime incident webhooks and verify recovery." }
keywords: ["Better Uptime webhook", "connect Better Uptime", "Better Uptime alerts", "Better Uptime integration"]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/integrations/better-uptime.ts
    - src/app/api/integrations/better-uptime/route.ts
---

# Better Uptime

## What it does

The Better Uptime adapter accepts inbound webhook events at
`/api/integrations/better-uptime`, validates them through its custom handler,
normalizes provider payloads, and submits lifecycle events to the configured
service.

## Prerequisites

- An OpsKnight service and enabled integration record.
- The integration identifier and generated integration key.
- Permission to configure webhooks in Better Uptime.
- A network path from the provider to the OpsKnight web runtime.

## Setup and configuration

1. In OpsKnight, open **Services → your service → Integrations**.
2. Select **Add integration → Better Uptime**, then save the integration.
3. Copy the webhook URL and integration key shown by OpsKnight.
4. In Better Stack, open **Uptime → Integrations → Exporting data**. Under
   **Outgoing webhooks**, select **Configure**, then add an **Incident webhook**.
5. Paste the complete OpsKnight URL. Select new/started, acknowledged, resolved,
   and reopened incident events as needed. If you customize the request body,
   preserve incident ID, name, cause, status, severity, and URL.
6. Save the webhook, then fail and restore a non-production monitor. Verify the
   deliveries use the same incident ID and update one OpsKnight incident.

Provider console labels can change independently of OpsKnight. Use the webhook
or notification configuration area in the provider rather than copying a URL
from another service. Treat keys and signature secrets as credentials; never
place them in logs or source control.

## Authentication and request verification

The endpoint requires the integration identifier and validates the integration key using a timing-safe comparison.
Signature verification is **not-declared** using the
`generic` verification contract.
The exact payload schema is defined by `src/app/api/integrations/better-uptime/route.ts` and `src/lib/integrations/better-uptime.ts`.

- Method: `POST`
- Integration identifier: query parameter
- Integration key transports: not statically resolved
- Schema: `shared provider schema`
- Body limit: 1048576 bytes (1 MiB)
- Rate limit: 100 requests per 60 seconds, per integration

## Event mapping and incident lifecycle

The adapter emits the lifecycle actions found in its current source:
- `trigger`
- `acknowledge`
- `resolve`
Correlation depends on the provider identity selected by the adapter.

## Recovery and deduplication

This route does not declare a durable provider delivery identifier.
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
- The incident source identifies Better Uptime.
- A repeat event updates or correlates according to the adapter identity.
- A recovery event resolves the correlated incident.

## Error reference

- This custom route does not expose the shared integration error contract.

## Troubleshooting

1. Confirm the integration is enabled and belongs to the intended service.
2. Verify the integration ID in the URL and rotate any key that may have been exposed.
3. Inspect **Settings → Integrations → Failures** for validation or signature errors.
4. Check for `413` before changing payload templates and `429` before retrying rapidly.
5. Confirm the provider sends a state supported by the event mapping above.
6. Preserve the provider delivery identifier and timestamp when escalating.

## Related pages

- [Integration troubleshooting](../../troubleshooting/integrations/webhook-rejected)
- [Incident lifecycle](../../concepts/incidents)
- [Services](../../concepts/services)
- [Events API](../../reference/api/events)

## Security

Use HTTPS, rotate exposed keys at both systems, configure signature verification
when supported, and restrict provider egress or ingress controls without blocking
legitimate retries.
