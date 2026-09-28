---
title: Scheduler is not processing maintenance
description: Diagnose missing ownership, stale progress, locks, and database failures.
type: troubleshooting
product_area: operations
audience: [operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/jobs/sla-scheduler.ts, src/jobs/service-objective-scheduler.ts]
---

# Scheduler is not processing maintenance

Confirm exactly one intended scheduler ownership model is active. Inspect runtime
role, readiness, scheduler profile, last successful progress, locks, database
errors, and queued downstream work. Verify clock and time-zone assumptions. Do not
run ad hoc duplicate schedulers against production to compensate for a broken
owner.

## Diagnostic sequence

1. Confirm the deployment topology and which runtime owns scheduling.
2. Check readiness and the last successful scheduler heartbeat/progress time.
3. Inspect database advisory locks and errors around the first missed interval.
4. Verify system time, configured time zones, and the affected schedule window.
5. Confirm downstream jobs are being enqueued and that their worker lane is healthy.

If progress timestamps advance but outcomes do not, move downstream to queue and
worker diagnosis. If timestamps do not advance, repair scheduler ownership,
database connectivity, or the failing job before restarting the single owner.

Verify at least two expected cycles and one resulting SLA/objective update.
Escalate with topology, runtime role, heartbeat times, lock owner, failing job,
database error, and the oldest downstream queue age.
