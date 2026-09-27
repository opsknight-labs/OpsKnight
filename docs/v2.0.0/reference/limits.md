---
title: Runtime limits
description: Source-defined request, response, timeout, and delivery boundaries that operators must account for.
type: reference
product_area: operations
audience: [operator, administrator, developer]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/webhooks.ts
    - src/lib/rate-limit.ts
    - src/lib/notification-delivery.ts
---

# Runtime limits

Limits are enforced at several layers and can change independently. Treat the
generated [configuration reference](./configuration/) as authoritative for
environment-configurable values.

- Outbound webhooks default to a 10-second attempt timeout and three attempts.
- Webhook response bodies are capped at 64 KiB.
- Provider throttling can defer notification work; the generic fallback delay is
  60 seconds when no provider retry interval is supplied.
- Distributed request limits fail closed when their PostgreSQL coordination
  query fails, except for the health-check path needed by orchestration.
- Worker concurrency, polling, batch size, and database pool sizes are runtime
  configuration, not constants to copy from an older release.

Capacity limits are safety boundaries, not throughput promises. Validate the
chosen topology with representative incident and notification load before a
production rollout.
