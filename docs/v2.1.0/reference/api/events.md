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
accepted for processing. The limit is 120 requests per minute per integration
or API key.

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
