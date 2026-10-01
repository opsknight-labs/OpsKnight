---
title: Scheduler is not processing maintenance
description: Diagnose missing ownership, stale progress, locks, and database failures.
type: troubleshooting
reader:
  status: READER_COMPLETE
  task: Diagnose, recover, and verify not processing.
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

Build a short timeline using UTC: last successful cycle, first missed cycle,
deployment/restart time, database error time, and next expected schedule. This
separates a time-zone misunderstanding from a stopped scheduler.

For Kubernetes, locate owners before restarting anything:

```bash
kubectl -n <namespace> get deploy,pod -o wide
kubectl -n <namespace> logs deploy/<scheduler-owner> --since=30m | tail -200
kubectl -n <namespace> get events --sort-by=.lastTimestamp | tail -50
```

For Compose, capture `docker compose ps` and `docker compose logs --since=30m
<scheduler-owner>`. Compare the deployed runtime-role settings with the selected
integrated or split topology. Zero owners stops progress; two owners can compete
for locks or duplicate enqueue work even when only one wins each cycle.

| Evidence | Follow next |
| --- | --- |
| no heartbeat or cycle start | process ownership, readiness, crash loop |
| cycle starts and DB call fails | database/TLS/permissions/lock owner |
| cycle succeeds but no jobs appear | schedule eligibility and time window |
| jobs appear but do not finish | worker lane and queue age |
| outcomes exist but UI is stale | projection/cache path, not scheduler |

If progress timestamps advance but outcomes do not, move downstream to queue and
worker diagnosis. If timestamps do not advance, repair scheduler ownership,
database connectivity, or the failing job before restarting the single owner.

Verify at least two expected cycles and one resulting SLA/objective update.
Escalate with topology, runtime role, heartbeat times, lock owner, failing job,
database error, and the oldest downstream queue age.
