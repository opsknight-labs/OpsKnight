---
title: Scale OpsKnight
description: Scale runtime roles without exceeding database or queue capacity.
type: deployment
product_area: operations
audience: [operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/runtime-capacity.ts
    - deploy/scripts/validate-runtime-capacity.cjs
---

# Scale OpsKnight

Measure the constrained workload before adding replicas. Web, worker traffic
classes, scheduler, and projector have different ownership and concurrency
contracts. Validate the resulting aggregate database connection budget and use
PgBouncer where the supported topology requires it.

After a change, compare throughput, oldest queued work, claim contention,
provider limits, database saturation, and tail latency. More worker concurrency
can reduce reliability when the database or provider is already constrained.

