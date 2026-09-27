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

