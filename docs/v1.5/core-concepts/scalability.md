---
order: 18
title: Scalability and capacity planning
description: Scale OpsKnight v1.5 web, worker, scheduler, PostgreSQL, and optional PgBouncer using measured capacity rather than fixed claims.
---

# Scalability and capacity planning

OpsKnight v1.5 does not publish a universal user, incident, notification, or request capacity. Safe throughput depends on application resources, PostgreSQL capacity, replica count, query shape, incident fan-out, external-provider latency, dataset size, and traffic mix.

Treat any capacity number that was not measured on your deployment as an assumption, not a product guarantee.

## Scaling architecture

v1.5 supports two Kubernetes runtime models.

### Integrated — compatibility mode

```text
web/API + scheduled work
          │
          ▼
   application replicas
          │
          ▼
      PostgreSQL
```

Integrated mode remains the Helm/root-Kustomize default for backward compatibility. It is not the recommended topology for new production Kubernetes deployments.

### Split — recommended for production

```text
users/integrations -> web pods -----------┐
                       ▲                  │
                  HPA 2 → 12              │
                                          │
background jobs ----> worker pods --------┼-> PostgreSQL
                                          │
scheduled work -----> scheduler ----------┘
```

Split mode separates public request handling, durable background-job processing, and scheduled-work ownership into independent deployments.

Default split shape:

- 2 baseline web replicas;
- web HPA enabled by default, 2→12 replicas;
- 70% CPU HPA target;
- web CPU request 250m and limit 1000m;
- 2 worker replicas;
- 1 scheduler replica;
- web pool 10 per pod;
- worker pool 10 per pod;
- scheduler pool 5;
- worker batch size 100;
- worker concurrency 15.

The baseline remains small for low-traffic installations while allowing the web tier to add capacity automatically. The HPA requires the Kubernetes resource Metrics API. If metrics are unavailable, the baseline replicas continue to run but automatic scaling cannot calculate desired replicas.

These defaults are starting values, not measured capacity recommendations.

## Optional PgBouncer

For measured web-side connection pressure, the Kubernetes packaging can place PgBouncer between web pods and PostgreSQL:

```text
web -> PgBouncer -> PostgreSQL
worker ----------> PostgreSQL
scheduler --------> PostgreSQL
```

Workers and scheduler remain direct to PostgreSQL. The bundled PgBouncer uses transaction pooling and is disabled by default.

PgBouncer can reduce the number of PostgreSQL backend sessions consumed by many web clients. It does not reduce query cost and cannot compensate for saturated CPU, slow storage, lock contention, missing query optimization, or inefficient application behavior.

## Model the workload

A representative capacity test should include the workload dimensions that matter to your installation:

| Dimension | Include |
| --- | --- |
| Inbound events | Sustained/burst rate, producer count, payload size, dedup-key cardinality. |
| Incident processing | New vs correlated events, acknowledge/resolve mix, bulk actions. |
| Notifications | Recipients, channels, escalation depth, retry rate, provider latency. |
| Interactive use | Concurrent dashboard users, incident lists/details, services, integrations, SSE. |
| Background jobs | Queue depth, due-job age, retries, provider failures, recovery backlog. |
| Scheduled work | Escalations, unsnoozes, maintenance/retention activity. |
| Stored data | Incident/event history, notification history, audit logs, indexes, growth. |
| Failure recovery | Producer retries, provider outage, database slowdown, pod restart, backlog drain. |

Average traffic is insufficient. Include the alert storm and recovery burst you need to survive.

## PostgreSQL connection budget

Connection limits are per process/pod. Budget the complete environment:

```text
(web replicas × web pool)
+ (worker replicas × worker pool)
+ (scheduler replicas × scheduler pool)
+ migration/admin reserve
+ monitoring/backup/other clients
< PostgreSQL max_connections
```

Split baseline:

```text
2 × 10 web
+ 2 × 10 worker
+ 1 × 5 scheduler
= 45 application connections
```

Without PgBouncer, also budget the HPA maximum. At 12 web replicas, the web tier can theoretically consume up to 120 direct PostgreSQL connections if every pool is full, before workers, scheduler, and operational reserve are added.

Do not allocate the entire PostgreSQL connection limit to application pools. Keep reserve for migrations, failover, health/monitoring clients, backup tooling, and emergency administration.

Increasing pool size does not automatically increase throughput. Once database CPU, memory, I/O, locks, or query execution become the bottleneck, more concurrent database work can increase latency and failure rate.

## What to measure

At minimum capture:

### Application/web

- request rate;
- HTTP success/error rate;
- p50/p90/p95/p99 latency;
- CPU and memory;
- HPA desired/current replicas;
- CPU throttling;
- restarts and readiness failures;
- event-loop or runtime saturation where available;
- SSE disconnect/reconnect behavior.

### Worker

- pending/processing/failed job counts;
- oldest due-job age;
- jobs processed per second;
- job duration;
- retry/exhaustion rate;
- worker CPU/memory;
- database transaction failures.

### Scheduler

- scheduler health/ownership;
- tick errors;
- failover behavior;
- due work advancing on time.

### PostgreSQL

- total, active, and idle connections;
- connections grouped by application role/process where available;
- pool wait/timeout symptoms;
- query latency and slow-query plans;
- locks/deadlocks/serialization conflicts;
- CPU, memory, storage latency, and I/O;
- table/index growth;
- backup/replication status where applicable.

### PgBouncer

When enabled, capture:

- client connections;
- server/backend connections;
- active/waiting clients;
- pool saturation;
- backend pool/reserve utilization;
- connection/query wait behavior.

A connection-pooling test is incomplete if PostgreSQL reports unexplained sessions. Account for each application role plus administrative/monitoring clients.

## Progressive capacity test

Use short, controlled stages first. Long soak tests should come only after the basic bottleneck is understood.

A useful sequence is:

1. Record idle baseline and HPA state.
2. Run 100 representative dashboard users.
3. Run 250 users.
4. Run 500 users only if the previous stage is healthy.
5. Observe HPA response and per-pod CPU rather than fixing the replica count unless the test specifically requires it.
6. Repeat with PgBouncer only if connection pressure is observed.
7. Run a short inbound-event test while background work is active.
8. Stop load and confirm replicas, queues, and metrics return toward baseline.

Stop a stage when the system is clearly saturated. Continuing destructive load after the bottleneck is already proven produces little additional information.

## Dashboard capacity

Dashboard capacity is not determined by connection count alone. For realistic testing, include a mix such as:

- incident list;
- services;
- incident detail;
- integration/health views;
- SSE/realtime traffic where applicable.

Use realistic think time rather than sending every virtual user in a tight loop.

If latency degrades, determine which layer saturates first:

1. web CPU/event loop or HPA reaction;
2. PostgreSQL connection availability;
3. query execution/locks;
4. database CPU/I/O;
5. proxy/SSE limits;
6. another shared dependency.

Do not add indexes or caches based only on a load-test symptom. Capture the actual query and use `EXPLAIN (ANALYZE, BUFFERS)` or equivalent evidence before changing database structure.

## Worker scaling

Workers can be scaled independently in split mode. Scale them using backlog evidence, not the number of web replicas.

Useful worker signals:

- oldest pending/due job age;
- backlog growth vs drain rate;
- job execution latency;
- provider response time;
- PostgreSQL transaction latency/conflicts;
- worker CPU/memory.

If adding workers reduces drain time while database latency remains stable, additional workers may help. If adding workers increases database waits, conflicts, or provider throttling, the bottleneck is elsewhere.

The worker claim mechanism prevents simultaneous duplicate claims through PostgreSQL locking, but external side effects remain at-least-once. A crash after an external effect and before completion is recorded can result in a later retry. Capacity tests must not describe this behavior as exactly-once delivery.

## Scheduler scaling

The scheduler is not horizontally scaled for throughput by default. The split deployment uses one scheduler replica. Scheduler correctness/failover should be validated separately from worker throughput.

Do not use multiple scheduler replicas as a generic performance knob without proving a scheduler bottleneck and understanding lock/failover semantics.

## Inbound event capacity

The Events API includes database-backed rate limiting and returns `202` for accepted requests. Capacity tests must distribute integration keys correctly when measuring aggregate throughput; a synchronized or low-cardinality key generator can accidentally benchmark rate limiting instead of application capacity.

For event tests record:

- `202`, `429`, and `5xx` counts;
- p50/p95/p99 latency;
- dedup outcome;
- transaction/serialization failures;
- PostgreSQL connections and CPU;
- background-job growth caused by accepted events.

Do not bypass client-visible rate limits unless the test is explicitly labeled an internal concurrency test.

## Deduplication and transaction contention

High concurrency against the same active incident/deduplication key can create transaction contention even when logical uniqueness is preserved.

When testing this path, separate two questions:

1. Did the system create the correct number of active incidents?
2. Did every request complete successfully without transaction retry exhaustion?

A result can be correct on uniqueness and still be operationally unacceptable because too many requests fail under contention.

## Capacity acceptance criteria

Define objectives before testing. Example categories:

- maximum acceptable HTTP error rate;
- p95/p99 latency target;
- HPA scaling behavior and stabilization;
- maximum queue age;
- zero unexpected pool timeouts;
- PostgreSQL connection headroom;
- database CPU/I/O headroom;
- successful backlog recovery after a burst;
- expected scheduler behavior during pod loss.

The capacity envelope is the highest tested workload that satisfies every required objective with reserve and without an unbounded connection, queue, latency, error, memory, or storage trend.

Do not label a single-node benchmark as production capacity or high-availability proof.

## Record the result

For every meaningful benchmark record:

- OpsKnight commit/image;
- deployment profile and exact values/patches;
- web HPA min/max/target and observed replica count;
- worker/scheduler replica counts;
- per-role pool settings;
- PgBouncer settings if enabled;
- PostgreSQL version/resources/`max_connections`;
- dataset size;
- load mix/duration;
- result metrics;
- first bottleneck observed;
- changes tested and before/after evidence;
- test date and owner.

This makes later regression testing comparable instead of anecdotal.

## Respond to saturation

1. Identify the first constrained layer.
2. Confirm HPA has healthy metrics and enough node capacity to scale.
3. Protect incident writes, acknowledge/resolve, and required background delivery before expensive analytics/reporting work.
4. Respect client `Retry-After` and use stable deduplication keys for retries.
5. Scale only the constrained role/layer.
6. Recalculate PostgreSQL connection budgets before increasing web HPA bounds or worker replicas.
7. Use PgBouncer only for connection pressure, not as a substitute for query/database work.
8. Confirm replicas/queues/latency recover and synthetic incident delivery succeeds.
9. Preserve the evidence and update the operating limit/runbook.

Do not disable rate limits or raise queue/database limits as a first response without understanding the next bottleneck.

## Related topics

- [Deployment overview](../deployment/README)
- [Kubernetes deployment](../deployment/kubernetes)
- [Helm deployment](../deployment/helm)
- [Kustomize](../deployment/kustomize)
- [Monitoring](../deployment/monitoring)
- [API rate limiting](../api/rate-limiting)
- [Troubleshooting](../troubleshooting)
