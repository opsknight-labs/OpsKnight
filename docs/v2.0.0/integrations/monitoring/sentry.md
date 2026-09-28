---
title: Sentry
description: Connect Sentry alerts to OpsKnight incident ingestion.
type: integration
product_area: integrations
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/integrations/sentry.ts
    - src/app/api/integrations/sentry/route.ts
---

# Sentry

## What it does

The Sentry adapter accepts inbound webhook events at
`/api/integrations/sentry`, validates them through its custom handler,
normalizes provider payloads, and submits lifecycle events to the configured
service.

## Prerequisites

- An OpsKnight service and enabled integration record.
- The integration identifier.
- Permission to configure webhooks in Sentry.
- A network path from the provider to the OpsKnight web runtime.

## Setup and configuration

Create the integration from the service integration settings. Configure the
provider to send events to the endpoint shown by OpsKnight. Treat the integration
key and any signature secret as credentials; do not place them in logs or source
control.

## Authentication and request verification

The endpoint requires the integration identifier.
Signature verification is **conditional-when-secret-configured** using the
`sentry` verification contract and headers `sentry-hook-signature`.
The exact payload schema is defined by `src/app/api/integrations/sentry/route.ts` and `src/lib/integrations/sentry.ts`.

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

## Troubleshooting

Check integration enabled state, key resolution, signature verification, rate
limits, payload validation, and the integration failure view. Preserve the
provider delivery identifier and timestamp when escalating a problem.

## Security

Use HTTPS, rotate exposed keys at both systems, configure signature verification
when supported, and restrict provider egress or ingress controls without blocking
legitimate retries.
