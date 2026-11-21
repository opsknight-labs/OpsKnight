---
title: Incidents API
description: List, create, read, and update incidents through the supported REST contract.
type: reference
product_area: incidents
audience: [developer, operator, administrator]
keywords: [incident API, create incident API, list incidents API, REST API, idempotency]
verification:
  level: runtime
  verified_at: 2026-09-27
  evidence:
    - src/app/api/incidents/route.ts
    - src/app/api/incidents/[id]/route.ts
    - src/lib/validation.ts
    - tests/docs/journeys/zz-api-contracts.spec.ts
    - generated/docs-certification/current.json
---

# Incidents API

All incident endpoints require an [API key](./authentication). Authorization is
evaluated as the key owner, including team and incident visibility. The limit
is 60 requests per minute per key and operation; creation also enforces a burst
ceiling of 120.

## List and read

`GET /api/incidents?limit=50` returns the newest visible incidents. `limit`
defaults to 50, invalid or non-positive values fall back to 50, and values over
200 are capped at 200. `GET /api/incidents/{id}` returns one visible incident.

## Create

`POST /api/incidents` accepts:

```json
{
  "title": "Checkout API p95 latency above SLO",
  "description": "Payment completion is degraded in multiple regions.",
  "serviceId": "service_id",
  "urgency": "HIGH",
  "priority": "P1"
}
```

`title` (1–500 characters), `serviceId`, and `urgency` are required. Urgency is
`LOW`, `MEDIUM`, or `HIGH`; description is at most 10,000 characters and
priority at most 20. The service must exist and be accessible to the key owner.
Success returns HTTP `201` with `data.incident` and `data.outcome`.

Send a unique `Idempotency-Key` for retried create requests. Reusing the key for
the same command returns the original result and adds
`Idempotency-Replayed: true`; do not reuse it for a different command.

## Update

`PATCH /api/incidents/{id}` accepts at least one of:

```json
{
  "status": "ACKNOWLEDGED",
  "urgency": "HIGH",
  "assigneeId": "user_id"
}
```

Status is `OPEN`, `ACKNOWLEDGED`, `RESOLVED`, `SNOOZED`, or `SUPPRESSED`.
Set `assigneeId` to `null` to unassign. Updates also support
`Idempotency-Key`. Success returns HTTP `200` with `data.incident`.

Every success response includes both the canonical `data` object and legacy
top-level aliases. New clients should read `data`.
