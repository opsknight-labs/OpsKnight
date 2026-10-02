---
title: Operate the split runtime
description: Separate web, scheduler, worker, projector, and migration ownership.
type: concept
product_area: deployment
audience: [operator]
keywords: [HA install, high availability, split mode, split runtime, scale workers]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/runtime-capacity.ts
    - deploy/compose/docker-compose.split.yml
---

# Operate the split runtime

The split topology assigns one process role per workload: web serves requests;
the scheduler owns timed maintenance; general, critical, and bulk workers claim
their traffic classes; the status projector updates public projections; and the
migration job owns schema migration.

Do not run integrated and split owners for the same work accidentally. Budget
database connections across replicas, preserve idempotent claim boundaries, and
monitor stale leases, queue depth, oldest work, throughput, and readiness before
changing concurrency.

## Monitor each ownership boundary

Track queue depth, oldest pending critical notification, oldest general job,
per-lane throughput, provider retries and `429`/`503` responses, active database
connections, SSE latency, and status-projector lag. Map symptoms to a role with
[Scaling signals](../capacity/scaling-signals/).

PgBouncer is supported only with Split mode. It protects the web connection
budget; it does not remove direct scheduler, worker, projector, migration, or
administrative connections. Keep migration ownership on `DIRECT_DATABASE_URL`.

## Verify

Stop one non-critical worker and confirm critical paging continues. Restore it
and confirm its queue age falls. Restart the scheduler and verify single-owner
timed work. Scale one lane, rerun the same synthetic workload, and confirm the
database budget and unrelated lanes remain healthy.
