---
title: Build a capacity and connection budget
description: Model alert, notification, user, realtime, status-fanout, and PostgreSQL demand without inventing limits.
type: deployment
product_area: deployment
audience: [operator]
keywords: [capacity sizing, database connection budget, alerts per second, SSE users, status fanout]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/lib/runtime-capacity.ts, deploy/scripts/validate-runtime-capacity.cjs]
---

# Build a capacity and connection budget

Size from workload shape and measured saturation. Until a matching benchmark is
**CERTIFIED**, do not convert a measured peak into a production promise.

## Describe the workload

Record peak and sustained alert ingestion, incident deduplication ratio,
notifications per incident, escalation rate, concurrent users, SSE streams,
status subscribers/fanout, and provider rate limits. Bursty fanout can constrain
workers even when average alert ingestion is modest.

## Budget PostgreSQL connections

Without PgBouncer, calculate the sum of each role's replicas multiplied by its
pool size, plus migrations, administration, monitoring, and safety headroom.
Validate the result with `deploy/scripts/validate-runtime-capacity.cjs` and keep
it below PostgreSQL `max_connections`.

With supported Split + PgBouncer, web traffic uses the transaction pool while
scheduler, workers, projector, and migrations retain direct connections. The
web contribution becomes PgBouncer replicas × (default pool + reserve pool), but
the direct-role pools must still be counted.

`DIRECT_DATABASE_URL` exists so migrations and roles requiring direct PostgreSQL
session behavior bypass transaction pooling. Do not point migration ownership at
the pooled URL.

## Verify after deployment

Run a representative synthetic load and observe the signals in
[Scaling signals](./scaling-signals/). Increase one constrained resource at a
time and repeat the same workload before changing the documented budget.

