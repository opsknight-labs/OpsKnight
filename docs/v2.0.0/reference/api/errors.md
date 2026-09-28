---
title: API responses and errors
description: Interpret OpsKnight API envelopes, error codes, correlation IDs, and retries.
type: reference
product_area: api
audience: [developer, operator, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/api-response.ts
    - src/lib/errors/registry.ts
---

# API responses and errors

Supported APIs return JSON envelopes. Success responses contain `success: true`,
`data`, `dataState`, `requestId`, and `timestamp`. Errors contain
`success: false`, `dataState: unavailable`, a stable `code`, a safe `error`
message, `retryable`, `requestId`, and `timestamp`. Validation errors may add
`fields` or `meta.issues`.

Send a valid `X-Request-ID` (1–128 letters, digits, `.`, `_`, `:`, or `-`) to
carry your correlation ID through the response. Otherwise OpsKnight generates
one. Record it with the HTTP status and error code.

Common codes include:

- `API_KEY_INVALID` and `API_KEY_USER_INVALID`: replace or reactivate the
  credential; do not retry unchanged.
- `VALIDATION_FAILED` and `INVALID_JSON`: correct the body before retrying.
- `SERVICE_NOT_FOUND`, `INCIDENT_NOT_FOUND`, `SERVICE_ACCESS_DENIED`, and
  `INCIDENT_ACCESS_DENIED`: verify identifiers and the key owner's access.
- `RATE_LIMIT_EXCEEDED`: wait for the number of seconds in `Retry-After`, then
  retry with bounded exponential backoff and jitter.
- `PAYLOAD_TOO_LARGE`: reduce the request body.
- `INTEGRATION_KEY_INVALID`, `INTEGRATION_DISABLED`, and
  `INTEGRATION_AUTHENTICATION_FAILED`: verify the Events API v2 integration and
  use its routing key rather than a provider webhook key.

Retry only when `retryable` is true, for rate limiting as described above, or
after a confirmed transient transport failure. Use `Idempotency-Key` on
incident mutations so a retry cannot repeat the operation.
