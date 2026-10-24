---
title: Events API v2
description: Trigger, acknowledge, and resolve deduplicated events through the supported ingestion API.
type: reference
product_area: integrations
audience: [developer, operator, administrator]
verification:
  level: runtime
  verified_at: 2026-09-27
  evidence:
    - src/app/api/events/route.ts
    - src/lib/validation.ts
    - src/lib/events.ts
    - tests/docs/journeys/zz-api-contracts.spec.ts
    - generated/docs-certification/current.json
---

# Events API v2

`POST /api/events` accepts a normalized event and returns HTTP `202` after it is
committed to the durable ingestion inbox. Asynchronous processing is the default;
no `OPSKNIGHT_INGESTION_MODE` setting is required. The default quota is 120 requests
per minute per integration or API key. Administrators can configure shared refill
rates and burst limits in ingestion settings. These limits are admission policy,
not a certified throughput guarantee.

```bash
curl --request POST 'https://opsknight.example.com/api/events' \
  --header 'Authorization: Token token=REDACTED_ROUTING_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "event_action": "trigger",
    "dedup_key": "checkout-api:latency:prod-eu",
    "payload": {
      "summary": "Checkout API p95 latency above SLO",
      "source": "production-eu-observability",
      "severity": "critical",
      "custom_details": {"region": "eu-west", "runbook": "RB-104"}
    }
  }'
```

## Request contract

- `event_action` is `trigger`, `acknowledge`, or `resolve`.
- `dedup_key` is required and is 1–200 characters. Reuse it for every state
  transition of the same signal.
- `payload.summary` is required and is 1–500 characters.
- `payload.source` is required and is 1–200 characters.
- `payload.severity` is `critical`, `error`, `warning`, or `info`.
- `payload.custom_details` is optional and may contain provider-specific JSON.

When authenticating with a general API key, also provide `service_id` (or the
compatibility alias `serviceId`) at the top level. Integration-key requests get
the service from the integration and must not depend on that field.

A successful response uses the standard success envelope and contains
`data.status` equal to `success` plus `data.result`. Keep the returned
`requestId` for support correlation. Acknowledge and resolve actions must use a
`dedup_key` previously sent by the same integration/service context.

## Durable acceptance and retries

The default result is `{ "action": "accepted", "receiptId": "..." }` inside
`data.result`. HTTP `202` confirms durable acceptance; incident processing,
Service Automation evaluation and provider delivery may still be pending.
Inspect `GET /api/events/receipts/{receiptId}` using an API key with the same
service scope. Routing-key clients also supply their `integrationId` and its
current integration credential. Receipt status exposes processing evidence
without returning the raw alert payload.

Send a stable `Idempotency-Key` for retries of the same delivery. Retained
matching deliveries return the original receipt; changed content with the same
identity returns `409`. Without a delivery identity, retries can create more
raw Alerts while retaining logical incident deduplication. Quota exhaustion
returns `429`; overload or unavailable durable storage returns retryable `503`.
A lost HTTP response is ambiguous: retry the same identity instead of assuming
that no event was stored.

Explicit `OPSKNIGHT_INGESTION_MODE=sync` preserves the previous immediate-incident
response for compatibility or a coordinated rollback. The first upgrade from
synchronous images requires draining old producers before routing ingestion to
new asynchronous replicas; overlapping mixed-mode producers can reorder
lifecycle events. Drain accepted work before switching back to synchronous mode.
