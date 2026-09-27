---
title: Health checks and metrics
description: Monitor readiness, deep health, queue work, and operational metrics.
type: deployment
product_area: observability
audience: [operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/app/api/health/route.ts
    - src/app/api/health/deep/route.ts
    - src/app/api/metrics/route.ts
---

# Health checks and metrics

Use readiness to decide whether a runtime should receive traffic. Use deep health
for operator diagnosis, not high-frequency load-balancer probes. Protect metrics
with the configured scrape token and restrict network access.

Monitor database reachability, migration state, runtime role, worker leases,
queue depth and age, scheduler progress, provider failures, status projection,
and connection capacity. An HTTP process can be alive while required background
work is unhealthy.

