---
order: 18
title: Scalability and capacity planning
description: Measure OpsKnight capacity, scale the shipped runtime safely, and prove workload limits before production.
---

# Scalability and capacity planning

OpsKnight v1.4 does not publish a universal user, incident, notification, or streaming-connection capacity. Throughput depends on application and PostgreSQL resources, replica count, incident fan-out, query history, external-provider latency, and the traffic shape. Treat any capacity number that was not measured on your deployment as an assumption, not a product guarantee.

This guide separates code-defined protective limits from measured capacity and provides a repeatable way to establish safe operating limits for your environment.

## Model the workload

Build a representative workload before choosing infrastructure. Record at least:

| Workload dimension   | Include in the model                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| Inbound events       | Sustained and burst rate, payload size, producer count, stable versus high-cardinality deduplication. |
| Incident processing  | Trigger/acknowledge/resolve mix, new versus correlated events, notes, watchers, and bulk actions.     |
| Notification fan-out | Recipients and channels per incident, escalation depth, retry rate, and provider response latency.    |
| Interactive use      | Concurrent desktop/mobile users, dashboard refreshes, analytics range, exports, and SSE connections.  |
| Scheduled work       | Due escalations, unsnoozes, failed-delivery retries, SLA checks, rollups, and retention cleanup.      |
| Stored data          | Incident/event history, notification history, audit/system logs, rollups, indexes, and growth rate.   |
| Failure recovery     | Producer retries, provider outages, database slowdown, replica restarts, and the resulting backlog.   |

Average traffic is insufficient for incident-management capacity planning. Test the alert storm, notification fan-out, and recovery burst you need to survive.

## Distinguish limits from capacity

The following v1.4 values are implementation guardrails. They prevent one path from consuming unlimited resources; they are not benchmark results or service-level objectives.

| Path                                  | Shipped behavior                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Published Events API                  | 120 requests per 60-second fixed window for the route's integration/API-key bucket.                                                                                             |
| Standard provider-integration handler | 100 requests per 60 seconds per integration by default; some provider-specific or legacy routes differ.                                                                         |
| PostgreSQL background jobs            | A scheduler cycle claims at most 100 due rows and processes them with concurrency 15. The dynamic scheduler normally runs every 15 seconds–2 minutes.                           |
| Immediate notification queue          | Each application process holds at most 5,000 pending items, takes batches of 50, and uses per-channel concurrency 10. A full queue drops new items.                             |
| Notification channel guards           | Per process and per minute: email 100, SMS 50, push 200, Slack 100, webhook 100, WhatsApp 30. Provider quotas can be lower.                                                     |
| Real-time dashboard stream            | Incident/service writes advance a durable change generation. Each replica polls that signal once per second and fans changes out to its local dashboard and widget subscribers. |
| Real-time cache                       | Process-local, generation-fenced projections coalesce equivalent refreshes. Cache entries are bounded; PostgreSQL carries the cross-replica change signal.                      |

See [API rate limiting](../api/rate-limiting) for the complete client-visible contract. Do not add the values above together to infer total notification or incident throughput. A slow provider, expensive query, or wide escalation fan-out can lower observed capacity significantly.

## Understand the scaling topology

One Next.js application serves the UI, API routes, provider webhooks, real-time streams, and the internal scheduler. PostgreSQL stores product state, rate-limit counters, scheduler coordination, and durable background jobs. Redis and a separately deployed worker service are not part of the v1.4 runtime.

Multiple application replicas can use the same PostgreSQL database. For every replica:

1. Deploy the same application version and runtime configuration.
2. Use the same `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, public URL, and provider settings.
3. Connect to the same migrated PostgreSQL database.
4. Keep the scheduler enabled across instances. PostgreSQL coordinates scheduler ownership via `CronSchedulerState` distributed locks with 30-second heartbeats and 5-minute timeout. Standby replicas poll with randomized jitter (15–30s) to ensure automated leader failover if the active leader replica stops.
5. Allow long-lived SSE responses at the load balancer or reverse proxy and disable response buffering for them.
6. Drain traffic and in-flight work before stopping the process.

Horizontal application scaling does not turn process-local state into shared state. Each replica has its own immediate notification queue, projection cache, and circuit-breaker state. Realtime invalidation is an exception: transaction-level PostgreSQL triggers append to a bounded `RealtimeChange` signal, and every active replica observes that durable generation. A process exit can still lose items that have not reached durable storage. Review [Technical architecture](./technical-architecture) before choosing a high-availability topology.

### Realtime event control plane

Dashboard and widget streams do not run projection queries on a per-client timer. An incident or service mutation appends a generation in the same database transaction. Each application process runs at most one lightweight change-feed poll while it has subscribers, then fans an observed generation out locally. Generation-scoped cache keys singleflight equivalent authorization/filter projections across connections.

The feed is deliberately level-triggered: consumers need to know that state changed, not replay every mutation. PostgreSQL sequence values are not treated as commit ordering. The shared observer also emits a 30-second reconciliation epoch, which catches out-of-order concurrent commits and refreshes time-derived values such as rolling 24-hour metrics and SLA warning windows. This is one shared replica timer, not a per-client database poll. A bounded tail is retained, so disconnected replicas and newly connected clients load a current snapshot instead of replaying history. Thirty-second SSE heartbeats keep proxies alive; authorization is revalidated independently every minute. If the change-clock query temporarily fails, the stream stays connected, applies bounded retry backoff, and reports the failure through logs, deep health, and Prometheus.

Monitor `opsknight_realtime_subscribers`, `opsknight_realtime_observed_generation`, `opsknight_realtime_change_age_seconds`, and `opsknight_realtime_clock_errors_total`. A growing error counter or stale generation during active incident mutations indicates database/proxy trouble. This design requires every replica to use the same migrated PostgreSQL database, matching the enterprise HA values and the release topology in #382.

## Budget PostgreSQL connections

Do not copy a fixed `connection_limit`, `max_connections`, or memory setting from another deployment. Budget connections across the entire database environment:

```text
(application replicas × maximum application pool per replica)
+ migration and administrative reserve
+ monitoring, backup, and other client connections
≤ PostgreSQL connection capacity
```

Choose the application pool and database limit together. Leave reserve for migrations, health checks, recovery access, and expected failover behavior. Increasing a connection limit without sufficient PostgreSQL CPU, memory, I/O, and query capacity can increase contention instead of throughput.

During a load test, monitor active/waiting connections, pool wait time, transaction/query latency, locks, deadlocks, CPU, memory, storage latency, and WAL/replication lag where applicable. Change one variable at a time and retain the before/after evidence.

## Establish a capacity envelope

### 1. Define measurable objectives

Set objectives for the workflows users depend on, for example:

- accepted-event rate and HTTP p50/p95/p99 latency;
- time from accepted trigger to committed incident;
- time from trigger to first attempted and first successful notification;
- acknowledge/resolve success and latency during an alert storm;
- maximum age and count of due background jobs;
- interactive/API error rate and latency with concurrent SSE users;
- PostgreSQL utilization, connection headroom, lock time, and storage growth; and
- recovery time after a provider, database, or application fault.

Define an error budget and a minimum headroom target before testing. A test does not pass merely because requests eventually complete.

### 2. Build a production-like test environment

Use the intended application image, replica topology, PostgreSQL major version, connection path, proxy timeouts, and realistic data volume. Use synthetic or properly sanitized data. Never direct a capacity test at real responders, customer webhooks, or paid messaging channels without explicit safeguards.

Replace external providers with controlled test endpoints that can reproduce normal latency, throttling, timeouts, and failures. Preserve realistic notification fan-out and payload sizes.

### 3. Run progressive and failure tests

Run each test long enough to expose queue growth, cleanup, connection pressure, and storage effects:

1. Establish an idle and normal-traffic baseline.
2. Increase one workload dimension in steps and hold each step at steady state.
3. Test bursts at and beyond the expected peak without bypassing route rate limits accidentally.
4. Combine inbound load, responder activity, SSE connections, and scheduled work.
5. Add slow/throttled providers and confirm backlogs and retries remain bounded.
6. Restart and drain application replicas; verify the process-local queue boundary is understood.
7. Introduce PostgreSQL latency or a controlled disconnect; verify readiness, recovery, and producer behavior.
8. Exercise scheduler-owner loss and confirm another eligible process advances scheduled work after ownership becomes available.
9. Stop new load and measure backlog drain time and final delivery/error state.

Use stable `dedup_key` values when measuring correlation and unique keys when measuring incident creation. Mixing the two produces a misleading result.

### 4. Record the safe operating limit

The capacity envelope is the highest tested workload that meets every objective with the required headroom and without an unbounded queue, connection, latency, error, memory, or storage trend. Record:

- application/database/proxy versions and exact resources;
- replica and connection-pool settings;
- dataset size and retention configuration;
- workload generator, payload mix, fan-out, duration, and provider behavior;
- results, bottleneck, headroom, and failure/recovery observations; and
- the date, owner, and conditions that require a retest.

Retest after material changes to the application, schema/indexes, PostgreSQL, proxy, replicas, notification providers, retention, or expected traffic.

## Monitor saturation in production

Alert on trends before users experience an incident-delivery failure:

| Layer         | Watch                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| Application   | Readiness, restarts, CPU/memory, request errors/latency, event 429s, SSE disconnects, and instance churn.             |
| PostgreSQL    | Connections/pool waits, query latency, locks/deadlocks, CPU, storage/I/O, table/index growth, and backup/replication. |
| Scheduler     | Lock ownership/heartbeat, tick errors, oldest due job, pending/processing/failed counts, and retry exhaustion.        |
| Integrations  | Accepted/rejected requests, signature/auth failures, 429s, processing latency, and retry storms.                      |
| Notifications | Pending work, dropped/full-queue messages, failed history, retry age, provider latency/quotas, and circuit state.     |
| User paths    | Synthetic trigger-to-notification-to-resolve timing plus representative login, incident, and status-page checks.      |

The application includes health/readiness output, system logs, notification history, integration health, and an admin SLA-query performance page. These are useful evidence, but v1.4 does not publish a complete Prometheus-compatible capacity metrics endpoint. Collect platform and PostgreSQL telemetry independently.

## Respond to saturation

1. Identify whether ingress, application CPU/memory, PostgreSQL, scheduled work, or a provider is the first constrained layer.
2. Protect incident writes and acknowledgement/resolve paths before analytics, exports, or other expensive non-critical work.
3. Pace producers and respect `Retry-After`; use stable deduplication keys for idempotent event retries.
4. Reduce accidental fan-out or noisy-source traffic at its owner while preserving required alerts.
5. Scale or tune the constrained layer using a tested change. Adding application replicas cannot fix a saturated database or provider quota.
6. Confirm queues drain, latency returns to baseline, and synthetic delivery succeeds.
7. Preserve evidence, update the capacity envelope, and correct the monitoring threshold or architecture that allowed the surprise.

Do not disable rate limits or raise queue/database limits as a first response without understanding the next bottleneck and failure mode.

## Implementation map

- `src/lib/cron-scheduler.ts` — scheduler cadence, ownership, and job-cycle limits.
- `src/lib/jobs/queue.ts` — durable job claims, concurrency, retry, and statistics.
- `src/lib/notification-queue.ts` — process-local queue limits and channel guards.
- `src/lib/realtime-change-control-plane.ts` — one durable change observer and local subscriber fanout per replica.
- `src/lib/realtime-cache.ts` and `src/lib/widget-data-cache.ts` — bounded, generation-fenced projection caches.
- `src/app/api/realtime/stream/route.ts` and `src/app/api/widgets/stream/route.ts` — authenticated event-driven SSE projections.
- `src/lib/rate-limit.ts` and `src/lib/integrations/rate-limiter.ts` — database-backed request limits.
- `src/lib/admin-health.ts` — administrator health checks and SLA-query observations.

## Related topics

- [Technical architecture](./technical-architecture)
- [Architecture diagrams](../architecture/diagrams)
- [Monitoring](../deployment/monitoring)
- [Maintenance](../deployment/maintenance)
- [API rate limiting](../api/rate-limiting)
- [Kubernetes deployment](../deployment/kubernetes)
- [Troubleshooting](../troubleshooting)
