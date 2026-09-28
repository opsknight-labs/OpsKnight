---
title: Scale from operational signals
description: Map queue, API, provider, database, realtime, and projection symptoms to the correct runtime role.
type: how-to
product_area: operations
audience: [operator]
keywords: [scale workers, queue depth, database connections, provider 429, projector lag, SSE latency]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/lib/runtime-capacity.ts, src/lib/notification-control-plane.ts, src/lib/jobs/queue.ts]
---

# Scale from operational signals

Scale the constrained subsystem. Adding every worker can increase database or
provider pressure and make the original symptom worse.

## Before you begin

Collect queue age and depth, per-role throughput, provider responses, active
database connections, SSE latency, and projector lag over the same time window.
Record the current replica, concurrency, pool, and provider-admission settings.

## Choose and verify one scaling action

1. Identify the first signal that departed its normal range.
2. Use the table below to identify the likely ownership boundary.
3. Check its downstream dependency—especially PostgreSQL and provider quota—so
   scaling does not move the bottleneck into that dependency.
4. Change one replica, concurrency, pool, or admission control at a time.
5. Repeat the same representative workload and compare queue age, throughput,
   errors, latency, and database connections with the recorded baseline.

| Signal | Likely constraint | First response |
|---|---|---|
| Oldest pending critical notification rises | Critical delivery lane | Scale critical workers; inspect DB and provider admission |
| Bulk queue grows while critical stays healthy | Bulk work | Scale bulk workers |
| General job age rises | General background work | Scale general workers |
| API latency rises while queues stay healthy | Web tier | Scale web replicas and inspect DB latency |
| Active DB connections approach budget | PostgreSQL pools | Reduce pools, add supported PgBouncer, or scale PostgreSQL |
| Provider `429` or retry hints rise | Provider quota | Reduce provider concurrency; honor retry timing |
| Provider `503` rises | Provider degradation | Preserve retries and critical-lane capacity; do not create a retry storm |
| Status projection lag rises | Status projector | Scale the projector and inspect its direct DB pool |
| SSE latency or disconnects rise | Web/realtime path | Scale web and inspect proxy/timeouts and DB pressure |

## Verification

After a change, confirm queue age trends downward, throughput increases without
new error growth, DB connections remain inside budget, and critical delivery is
not starved. See [Worker is unhealthy](../../troubleshooting/workers/unhealthy/)
for a symptom-first diagnostic path.
