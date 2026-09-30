---
title: GitHub
description: Connect GitHub alerts to OpsKnight incident ingestion.
type: integration
reader:
  status: READER_COMPLETE
  task: Configure and verify a signed GitHub Actions webhook through failure and recovery.
product_area: integrations
audience: [administrator, operator]
keywords: ["GitHub webhook", "connect GitHub", "GitHub alerts", "GitHub integration"]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/integrations/github.ts
    - src/app/api/integrations/github/route.ts
---

# GitHub

## What it does

The GitHub adapter accepts inbound webhook events at
`/api/integrations/github`, validates them through its custom handler,
normalizes provider payloads, and submits lifecycle events to the configured
service.

## Prerequisites

- An OpsKnight service and enabled integration record.
- The integration identifier and generated integration key.
- Permission to configure webhooks in GitHub.
- A network path from the provider to the OpsKnight web runtime.

## Setup and configuration

1. In OpsKnight, open **Services → your service → Integrations**.
2. Select **Add integration → GitHub**, then save the integration.
3. Copy the webhook URL and integration key shown by OpsKnight.
4. In the GitHub repository, open **Settings → Webhooks → Add webhook**. Organization owners can use the equivalent organization webhook when the same routing is intentionally required across repositories.
5. Paste the complete OpsKnight URL as **Payload URL**, choose `application/json`, and enter the same high-entropy webhook **Secret** configured for the OpsKnight integration. Keep SSL verification enabled.
6. Select individual events used by the adapter: workflow runs, check runs, workflow jobs, and deployment/deployment-status activity as applicable. Do not select every event without an operational need.
7. Keep **Active** selected and add the webhook. GitHub sends a `ping`; inspect the delivery response, but use a real supported Actions/deployment event for lifecycle validation.
8. Run a controlled workflow that fails, then rerun/fix it to success. Verify the same OpsKnight incident converges.

Provider console labels can change independently of OpsKnight. Use the webhook
or notification configuration area in the provider rather than copying a URL
from another service. Treat keys and signature secrets as credentials; never
place them in logs or source control.

## Authentication and request verification

The endpoint requires the integration identifier and validates the integration key using a timing-safe comparison.
Signature verification is **conditional-when-secret-configured** using the
`github` verification contract and headers `x-hub-signature-256`.
The exact payload schema is defined by `src/app/api/integrations/github/route.ts` and `src/lib/integrations/github.ts`.

- Method: `POST`
- Integration identifier: query parameter
- Integration key transports: no separate key transport is required by this custom route; `integrationId` selects the record and the configured webhook secret validates `X-Hub-Signature-256`
- Schema: `shared provider schema`
- Body limit: 1048576 bytes (1 MiB)
- Rate limit: 100 requests per 60 seconds, per integration

## Event mapping and incident lifecycle

The adapter emits the lifecycle actions found in its current source:
- `trigger`
- `acknowledge`
- `resolve`
Workflow runs correlate by repository, workflow name/ID, and branch; check runs correlate by repository and check name/ID. Pending workflow/check states acknowledge, failure/cancel/timeout triggers, and completed success resolves. Deployment mapping follows the supported payload fields in the adapter.

## Recovery and deduplication

When signature verification runs, delivery identity is read from `x-github-delivery` and protected by the inbound-delivery fence.
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
- The incident source identifies GitHub.
- A repeat event updates or correlates according to the adapter identity.
- A recovery event resolves the correlated incident.

## Error reference

- This custom route does not expose the shared integration error contract.

## Troubleshooting

1. Confirm the integration is enabled, belongs to the intended service, and the GitHub webhook is Active with the correct URL/content type/events.
2. In **Settings → Webhooks → Recent deliveries**, inspect event name, `X-GitHub-Delivery`, request payload, response code/body, and redelivery status.
3. For `401`, confirm the same secret exists on both sides and the proxy preserves the raw body and `X-Hub-Signature-256`; rotate any exposed/mismatched secret.
4. For a successful ping but no incident, generate a supported workflow/check/deployment payload; ping is only connectivity evidence.
5. For failure creating one incident and success not resolving it, compare repository, workflow/check name, and branch used in the dedup key.
6. Inspect **Settings → Integrations → Failures** and check `413`, `429`, or `503` before redelivery. Preserve the GitHub delivery ID/timestamp when escalating.

## Related pages

- [Integration troubleshooting](../../troubleshooting/integrations/webhook-rejected)
- [Incident lifecycle](../../concepts/incidents)
- [Services](../../concepts/services)
- [Events API](../../reference/api/events)

## Security

Use HTTPS, rotate exposed keys at both systems, configure signature verification
when supported, and restrict provider egress or ingress controls without blocking
legitimate retries.
