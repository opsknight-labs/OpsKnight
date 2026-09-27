---
title: Dynatrace
description: Connect Dynatrace alerts to OpsKnight incident ingestion.
type: integration
product_area: integrations
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/integrations/dynatrace.ts
    - src/app/api/integrations/dynatrace/route.ts
---

# Dynatrace

## What it does

The Dynatrace adapter accepts inbound webhook events at
`/api/integrations/dynatrace`, validates them through the shared integration handler,
normalizes provider payloads, and submits lifecycle events to the configured
service.

## Prerequisites

- An OpsKnight service and enabled integration record.
- The integration identifier and generated integration key.
- Permission to configure webhooks in Dynatrace.
- A network path from the provider to the OpsKnight web runtime.

## Setup and configuration

Create the integration from the service integration settings. Configure the
provider to send events to the endpoint shown by OpsKnight. Treat the integration
key and any signature secret as credentials; do not place them in logs or source
control.

## Authentication and request verification

The shared handler resolves the integration, verifies the integration key,
applies per-integration rate limiting, and uses provider signature verification
when a signature secret and supported provider contract are configured. The
exact accepted headers and payload schema are defined by `src/app/api/integrations/dynatrace/route.ts`
and `src/lib/integrations/dynatrace.ts`.

## Event mapping and incident lifecycle

The adapter maps provider states into normalized trigger, acknowledge, or resolve
events. Correlation depends on a stable provider identity; display names alone
are not reliable deduplication keys. Inspect the provider source before changing
its mapping contract.

## Recovery and deduplication

Deliveries with a genuine provider delivery identifier use the fenced inbound
delivery claim. Replayed events must converge on the same service and correlation
key. Failed deliveries are recorded for operational inspection without exposing
stored secrets.

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
