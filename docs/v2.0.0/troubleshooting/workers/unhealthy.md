---
title: Worker is unhealthy
description: Diagnose stalled claims, queue age, concurrency, and database capacity.
type: troubleshooting
product_area: operations
audience: [operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/jobs/queue.ts, src/lib/runtime-capacity.ts]
---

# Worker is unhealthy

Identify the process role and traffic class. Inspect readiness, oldest queued work,
claim leases, attempts, last error, database connections, provider latency, and
configured batch and concurrency. Check for a duplicate or missing owner. Scale
only after proving capacity; reclaim expired work through supported recovery logic
rather than modifying claim state manually.

