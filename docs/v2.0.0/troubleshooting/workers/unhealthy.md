---
title: Worker is unhealthy
description: Diagnose stalled claims, queue age, concurrency, and database capacity.
type: troubleshooting
reader:
  status: READER_COMPLETE
  task: Diagnose, recover, and verify unhealthy.
product_area: operations
audience: [operator]
keywords: [worker unhealthy, worker queue stalled, scale workers, queue age]
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

## Diagnose by lane

1. Identify `all`, `general`, `critical`, `bulk`, or `projector` and confirm that
   the deployment actually owns that lane.
2. Compare readiness, last success, oldest eligible job, active leases, and attempts.
3. Check PostgreSQL connection pressure before increasing concurrency or replicas.
4. Separate provider latency/admission pressure from database claim failures.
5. Look for duplicate owners, expired leases, poison jobs, and repeated process restarts.

Critical notification or escalation backlog requires incident handling; bulk and
projector lag may tolerate a controlled recovery window. Use supported retry or
lease-expiry behavior. Do not delete queue rows or rewrite job state directly.

After recovery, queue age must decrease across multiple polling cycles, leases
must turn over normally, and new work must complete. Preserve lane, runtime ID,
oldest job ID/type, attempt count, lease timestamps, database capacity, provider
latency, and the first causal error.
