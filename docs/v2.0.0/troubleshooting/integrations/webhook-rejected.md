---
title: Integration webhook is rejected
description: Diagnose authentication, signature, replay, rate-limit, and payload failures.
type: troubleshooting
reader:
  status: READER_COMPLETE
  task: Diagnose, recover, and verify webhook rejected.
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

Do not assume every route uses every status in this list. Open the provider page
for its exact key transport, signature headers, body limit, rate limit, and error
contract. Then trace one delivery in this order:

1. Confirm the provider sent the exact OpsKnight URL and did not follow a stale
   integration after key rotation.
2. Match the request time and provider delivery ID to the integration failure
   record under **Settings → Integrations → Failures**.
3. For a signature error, compare raw request bytes, timestamp units, signing
   secret revision, and signature header. Do not pretty-print JSON first.
4. For a schema error, compare the rejected field path with a current provider
   sample. Confirm `Content-Type: application/json` and lifecycle value casing.
5. For `429`, stop manual retries and honor the response headers. Reduce noisy
   test traffic or wait for the provider's normal retry.

| Symptom | Likely boundary | Proof |
| --- | --- | --- |
| provider sees DNS/TLS timeout | public routing before OpsKnight | ingress/proxy access log has no request |
| OpsKnight returns key/signature error | request authentication | failure record names the verification stage |
| trigger succeeds, recovery creates another incident | correlation | trigger and recovery keys differ |
| retries create duplicate effects | delivery ID or dedup key changes | compare the provider delivery records |
| only large events fail | request body limit | response is `413` and smaller representative payload succeeds |

Reproduce with a provider-generated test event whenever possible. Preserve the raw
body bytes for signature debugging; parsing and reserializing JSON can change the
signed payload. Compare the exact provider page because headers, signatures,
actions, and delivery identifiers differ between adapters.

## Verify recovery

Send one trigger and its matching recovery event to a non-production service.
Confirm one incident is created, recovery updates that incident, and replaying the
same signed delivery does not create a second lifecycle mutation.
