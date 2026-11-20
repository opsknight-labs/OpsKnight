---
title: Troubleshoot workers
description: Diagnose an unhealthy worker or a queue that is not draining.
type: concept
product_area: workers
audience: [operator]
verification: { level: source, verified_at: 2026-10-02, evidence: [src/lib/runtime-role.ts, src/lib/notification-control-plane.ts] }
---

# Troubleshoot workers

Use [Worker is unhealthy](./unhealthy). Identify the runtime role and lane, then check health, queue age/depth, claim leases, database connections, provider latency, concurrency, and recent logs. Scale only after identifying the actual bottleneck.
