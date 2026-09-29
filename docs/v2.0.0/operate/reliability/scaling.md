---
title: Scale OpsKnight
description: Scale each runtime role from measured demand while preserving database, queue, and provider headroom.
type: deployment
product_area: operations
audience: [operator]
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - src/lib/runtime-capacity.ts
    - deploy/scripts/validate-runtime-capacity.cjs
    - src/lib/job-worker.ts
    - src/lib/cron-scheduler.ts
---

# Scale OpsKnight

Scale the constrained runtime role, not the deployment as one undifferentiated unit. Web requests, critical/general/bulk jobs, scheduling, and status projection have different bottlenecks. Adding replicas without recalculating database demand can turn queue latency into connection exhaustion.

## Prerequisites

Before changing capacity, collect a representative baseline covering a normal peak and at least one failure/retry period:

- Request rate and p95/p99 web latency.
- Pending jobs and oldest-pending age by worker lane.
- Notification backlog, delivery latency, failure rate, and provider throttling.
- Scheduler last-success age and missed/stale work.
- Status projector backlog and publication latency.
- PostgreSQL active connections, wait time, CPU, I/O, locks, and maximum connections.
- Runtime CPU, memory, restarts, readiness, and event-loop pressure.

Confirm whether the installation is **integrated** or **split**, whether web traffic uses PgBouncer, and which roles connect directly to PostgreSQL. Review [Choose a deployment model](../capacity/choose-deployment.md) and [Sizing](../capacity/sizing.md).

## Choose what to scale

Use the symptom to identify the constrained role:

- Scale **web** for sustained request saturation or high request latency after excluding database contention.
- Scale **critical workers** when time-sensitive incident/escalation work ages while database and provider capacity remain healthy.
- Scale **general workers** for sustained ordinary background-job age.
- Scale **bulk workers** for export, maintenance, or other bulk backlog without consuming critical capacity.
- Scale **status projectors** when publication lag grows independently of web and worker health.
- Keep scheduler ownership within the supported topology. Do not add schedulers merely because scheduled work is late; first distinguish scheduler staleness from worker backlog.

If several lanes are slow and PostgreSQL is saturated, adding workers is the wrong first action. Reduce concurrency, repair expensive work, or add database capacity.

## Recalculate the connection budget

Set the proposed replica and pool values in the same environment used by the deployment, then run:

```bash
node deploy/scripts/validate-runtime-capacity.cjs
```

The validator fails closed on malformed booleans and non-positive numeric settings. Its model includes:

- Integrated replicas multiplied by `DATABASE_POOL_SIZE_WEB` in integrated mode.
- Web replicas multiplied by `DATABASE_POOL_SIZE_WEB` in split mode without PgBouncer.
- PgBouncer replicas multiplied by default plus reserve pool size for pooled web connections.
- Direct scheduler, general, critical, bulk, and projector replica/pool products in split mode.

The total must not exceed `DATABASE_MAX_CONNECTIONS` or `DATABASE_MAX_APPLICATION_CONNECTIONS`. Leave operational headroom for migrations, administrative sessions, failover overlap, and short bursts; passing at exactly the maximum is not a resilient target.

PgBouncer is supported only for web traffic in split runtime mode. Worker roles continue to use their direct database URL and remain part of the direct connection budget.

## Apply a controlled change

1. Record the baseline, hypothesis, old values, proposed values, and rollback threshold.
2. Change one constrained role or concurrency control at a time.
3. Run the capacity validator against the exact candidate environment.
4. Apply the topology-specific replica change using Compose, Kubernetes/Helm/Kustomize, or Swarm procedures.
5. Wait for new replicas to become ready and for old work to settle.
6. Observe at least one meaningful traffic/backlog interval before making another change.

For Kubernetes, preserve disruption budgets and topology spread during rollout. For Swarm, verify service convergence and task errors. Compose is primarily a single-host topology: more replicas still share the same host, network, and storage limits.

## Verify the result

Confirm:

1. `GET /api/health?mode=readiness` is healthy for every required role.
2. Deep health shows expected worker/scheduler state and decreasing oldest-pending ages.
3. The targeted backlog or latency improves without another lane regressing.
4. PostgreSQL connections and wait time remain below the planned budget.
5. Provider throttling and delivery failures do not increase.
6. CPU, memory, restarts, and tail latency remain stable during peak load.
7. One synthetic incident reaches acknowledgement, notification, and resolution normally.

Throughput alone is not success. A change that drains jobs faster while increasing duplicate work, failed deliveries, or database contention should be rolled back.

## Roll back a scaling change

Return to the recorded replica/concurrency values when database headroom falls below the approved threshold, tail latency or errors rise, readiness becomes unstable, or provider throttling increases. Wait for excess replicas to terminate cleanly, then confirm queue claims and scheduled work still have an active owner.

Do not reduce a worker role to zero unless that role is intentionally disabled and its work is owned elsewhere. Preserve at least one supported scheduler owner.

## Troubleshooting

### More workers made the backlog worse

Check database lock/connection wait, job retry rate, and provider throttling. Reduce concurrency to the last stable value before investigating slow or repeatedly failing jobs.

### Capacity validation fails

Correct malformed values first. If calculated demand exceeds the database budget, reduce replicas/pools, introduce supported web PgBouncer in split mode, or increase proven database capacity. Do not bypass the validator by hiding replica settings.

### Replicas are ready but throughput does not improve

The bottleneck may be serialized work, a single scheduler, a provider limit, database I/O, or an empty/incorrect worker lane. Compare lane-specific queue age and deep health rather than scaling every role.

### Queue depth is low but oldest age is high

A small number of stuck/retrying jobs may dominate age. Inspect job attempts and errors before adding broad capacity.

## Related pages

- [Scaling signals](../capacity/scaling-signals.md)
- [Capacity certification](../capacity/certification-methodology.md)
- [Health checks and metrics](health-and-metrics.md)
- [Split runtime](../deploy/split-runtime.md)
