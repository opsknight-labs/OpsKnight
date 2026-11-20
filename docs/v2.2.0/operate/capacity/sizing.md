---
title: Build a capacity and connection budget
description: Model alert, notification, user, realtime, status-fanout, and PostgreSQL demand without inventing limits.
type: deployment
product_area: deployment
audience: [operator]
keywords: [capacity sizing, database connection budget, alerts per second, SSE users, status fanout]
reader:
  status: READER_COMPLETE
  task: Build, test, and maintain a workload and PostgreSQL connection budget.
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/lib/runtime-capacity.ts, deploy/scripts/validate-runtime-capacity.cjs]
---

# Build a capacity and connection budget

Size from workload shape and measured saturation. Until a matching benchmark is
**CERTIFIED**, do not convert a measured peak into a production promise.

## Prerequisites

Collect a normal peak and incident-storm sample. Record alert rate, deduplication ratio, notifications per incident, concurrent users/SSE streams, status fanout, provider quotas, replica counts, concurrency, pools, and the PostgreSQL ceiling.

## Configure the workload model

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

## Run a representative load

Use a non-production environment with the same topology, resource requests, PostgreSQL class, and provider emulators. Increase one load dimension at a time and stop on correctness failure, sustained queue-age growth, connection exhaustion, or provider admission failure.

## Validation after deployment

Run a representative synthetic load and observe the signals in
[Scaling signals](./scaling-signals/). Increase one constrained resource at a
time and repeat the same workload before changing the documented budget.

## Production considerations

Reserve connections for migrations, administration, monitoring, and failover. Treat retry storms and notification fanout separately from average alert rate, and review the budget after topology, pool, concurrency, or provider changes.

## Troubleshooting

**Calculated demand exceeds the database ceiling:** reduce pools/concurrency, add transaction pooling where supported, or increase the database ceiling only after database validation.

**Average load passes but storms fail:** size from oldest queue age and correctness during the storm, not daily average throughput.

**More workers reduce throughput:** inspect locks, connections, provider throttling, and job-claim contention before adding capacity.
