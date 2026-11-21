---
title: Outbound webhook reference
description: Delivery, signing, retry, timeout, and receiver requirements for incident webhooks.
type: reference
product_area: integrations
audience: [administrator, developer]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/webhooks.ts
    - src/lib/network-security.ts
---

# Outbound webhook reference

OpsKnight sends JSON over `POST` by default. Every request includes
`Content-Type: application/json`, a user agent, and a stable
`X-OpsKnight-Delivery-Id` that receivers should store for idempotent processing.

When a signing secret is configured, verify the lowercase hexadecimal HMAC
SHA-256 in `X-OpsKnight-Signature`. The signed value is the exact
`X-OpsKnight-Timestamp`, a period, and the unmodified request body. Reject stale
timestamps before comparing signatures with a constant-time operation.

The default attempt timeout is 10 seconds and the default maximum is three
attempts. Retryable HTTP responses and network failures use backoff; `Retry-After`
is honored when present. A receiver response body is limited to 64 KiB.
Destinations are checked against outbound-network restrictions before every
attempt, so loopback, link-local, private, or otherwise restricted targets are
rejected unless the deployment's network policy explicitly supports them.
