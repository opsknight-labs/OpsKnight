---
title: Integration webhook is rejected
description: Diagnose authentication, signature, replay, rate-limit, and payload failures.
type: troubleshooting
product_area: integrations
audience: [operator, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/integrations/handler.ts, src/lib/integrations/request-security.ts]
---

# Integration webhook is rejected

Record the provider, endpoint, status code, delivery identifier, and timestamp.
Confirm the integration exists, is enabled, and matches the route type. Then check
key resolution, signature secret and timestamp, replay claim, rate limit, content
type, and schema validation. Redact credentials and payload secrets before sharing
evidence. Replaying the same genuine delivery identifier may be intentionally
deduplicated.

## Interpret the response

- `400`: missing integration ID, malformed JSON, or provider schema mismatch.
- `401` or `403`: invalid key/signature, disabled integration, or type mismatch.
- `413`: request exceeds the ingestion body limit.
- `429`: per-integration rate limit; honor the returned retry guidance.
- `503`: an identical delivery is already being processed or a dependency is unavailable.

Reproduce with a provider-generated test event whenever possible. Preserve the raw
body bytes for signature debugging; parsing and reserializing JSON can change the
signed payload. Compare the exact provider page because headers, signatures,
actions, and delivery identifiers differ between adapters.

## Verify recovery

Send one trigger and its matching recovery event to a non-production service.
Confirm one incident is created, recovery updates that incident, and replaying the
same signed delivery does not create a second lifecycle mutation.
