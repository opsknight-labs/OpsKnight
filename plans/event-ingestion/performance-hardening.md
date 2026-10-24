# OpsKnight Enterprise Event Ingestion — Performance & Architecture Hardening

**Branch:** `feat/enterprise-event-ingestion`  
**Baseline:** `7d242636b`  
**Goal:** Sustain 600 accepted and completed events per second using PostgreSQL, without compromising correctness, durability, security or existing functionality.

Do not open a PR or merge anything until the certification gates pass.

## Phase 1 — Eliminate long-lived admission transactions (P0)

Investigate and optimize:

- `src/lib/ingestion/postgres.ts`
- `src/lib/ingestion/budget.ts`
- `src/lib/ingestion/append-batcher.ts`
- `src/lib/db-utils.ts`

**Confirmed issue:** Capacity reservation code performs scheduled sleeps/retries inside an open PostgreSQL transaction. Some database locks may already be held during these waits.

Required changes:

1. Instrument each admission stage: transaction acquisition, advisory locking, policy reads, Automation snapshot, reservation, receipt insertion and commit.
2. Remove all avoidable timers, backoffs and expensive CPU processing while holding database locks.
3. Move retries outside the transaction where possible. Roll back, release all locks, and retry the whole admission operation using the same idempotency identity.
4. Ensure normal admission transactions remain short and do not block incident completion unnecessarily.
5. Reevaluate lock acquisition order and batch grouping to prevent one contended identity from delaying unrelated events.
6. Preserve atomic capacity reservation, ordering, idempotency and durable acknowledgment.

**Exit criterion:** No avoidable application-side waiting under a lock-holding transaction. Demonstrate reduced transaction duration and lock contention through repeatable profiling.

## Phase 2 — Redesign capacity reservations and quota contention (P0)

Investigate:

- `src/lib/ingestion/budget.ts`
- `src/lib/ingestion/quota.ts`
- `src/lib/ingestion/quota-batch.ts`
- `src/lib/ingestion/request-gate.ts`

Current issues:

- Admission and completion update shared budget rows.
- Multiple requests for one authentication key compete for the same quota row.
- Admission batching can retain capacity locks while waiting for other operations.

Required changes:

1. Profile admission, release and same-shard budget contention independently.
2. Minimize the number of capacity rows locked and the duration of those locks.
3. Evaluate more efficient sharding and batch reservation algorithms.
4. Keep hard limits on unfinished events, retained bytes and critical-event reserve.
5. Optimize quota updates for high-traffic integrations without allowing policy reductions, concurrent requests or replica failover to overgrant quota.
6. Preserve the existing exhausted-quota idempotent replay contract.
7. Distinguish actual queue exhaustion from transient lock contention. Return explicit, retryable overload responses when capacity cannot be safely reserved.

Do not implement an eventually consistent capacity counter if it weakens the existing hard admission guarantees.

**Exit criterion:** No sustained hot-row contention at the next passing load level, with all quota and capacity invariants verified.

## Phase 3 — Optimize incident processing (P0)

Investigate:

- `src/lib/events.ts`
- `src/lib/automation/runtime.ts`
- Incident classification, escalation, SLA, Runbook and outbox modules
- `src/lib/ingestion/postgres.ts` receipt-completion path

Required changes:

1. Profile the complete incident transaction, including service reads, deduplication, classification, Automation, escalation, alert creation, timeline, outbox and receipt completion.
2. Remove redundant SQL queries and repeated reads.
3. Batch compatible operations and reduce Prisma/database round trips where safe.
4. Prepare immutable configuration outside the lock-sensitive section where possible, while preserving configuration-version and policy semantics.
5. Optimize the common new-incident path separately from deduplicated, acknowledged and resolved incidents.
6. Keep receipt completion atomic with incident and outbox persistence.
7. Ensure external notification delivery and Runbook execution never block the incident transaction.

**Exit criterion:** Lower p95/p99 incident-transaction latency, fewer database calls per event, no duplicate lifecycle effects and no regression in existing features.

## Phase 4 — Independently scale ingestion workers (P1)

Investigate:

- `src/lib/ingestion/worker.ts`
- Docker Compose and Swarm configuration
- PostgreSQL connection budgets and PgBouncer integration

Required changes:

1. Keep web admission and dedicated ingestion workers logically independent.
2. Improve continuous claim/refill behavior without busy polling.
3. Introduce bounded, adaptive worker concurrency informed by database latency, pool waits, lock contention and processing throughput.
4. Maintain protected critical-event capacity without starving ordinary traffic.
5. Prevent noisy services or blocked ordering identities from delaying unrelated incidents.
6. Scale replicas only when profiling demonstrates additional throughput.
7. Never exceed the safe database connection budget.

Preserve ordered event processing, retries, lease fencing, crash recovery and graceful shutdown.

**Exit criterion:** Increasing workers improves completed events/sec without increasing rejection rates or destabilizing PostgreSQL.

## Phase 5 — Full-stack load and correctness certification (P0)

Build a fresh immutable image from the final source. Use an isolated test database and controlled resources. No concurrent unrelated builds or load tests.

Run sequential capacity tests:

| Stage | Offered load | Duration |
|---|---:|---|
| Baseline | 50 RPS | 5 min |
| Baseline | 100 RPS | 5 min |
| Intermediate | 250 RPS | 10 min |
| Intermediate | 400 RPS | 10 min |
| Enterprise target | 600 RPS | 60 min |
| Burst | 1,000 RPS | 60 sec |

Only progress when the prior stage passes. Use an open-loop load generator and distinguish offered, sent, acknowledged, durably accepted and fully processed requests. Do not count dropped generator arrivals as successful requests.

Test a representative mixture of independent ordering identities, hot identities, duplicate deliveries, trigger/resolve/acknowledge events, active Service Automation and actual downstream jobs.

Measure:

- Accepted events/sec and completed events/sec
- HTTP p50/p95/p99
- Acceptance-to-completion p50/p95/p99
- PostgreSQL lock waits and transaction duration
- WAL writes/syncs and disk utilization
- Database pool wait time
- Web and worker CPU, memory and event-loop delay
- Backlog growth and recovery
- Rejections by reason: rate limit, capacity, contention, overload and errors
- Ambiguous acknowledgments and idempotent recovery

At the 600 RPS sustained certification target, require:

- At least 99.9% accepted under explicitly configured quotas and sufficient capacity
- At least 600 events/sec completed over the sustained interval
- HTTP acknowledgment p95 below 100 ms
- Acceptance-to-completion p95 below 1 second
- No continuously growing backlog
- No lost acknowledged events or duplicate lifecycle effects
- No unexplained response timeouts

The 1,000 RPS burst must be bounded and recoverable. If full acceptance is unavailable, reject excess work explicitly and safely rather than silently losing it.

## Phase 6 — Enterprise resilience certification (P0)

Repeat critical tests with Docker Swarm + PgBouncer and the supported Kubernetes deployment.

Certify:

- Worker SIGKILL during processing
- Web replica crash during durable append
- PostgreSQL connection interruption and failover
- PgBouncer restart
- Concurrent duplicate events
- Out-of-order trigger/resolve/acknowledge
- Critical-event prioritization
- Automation version consistency
- Notification and escalation dispatch
- Runbook execution and approval paths
- Dead-letter replay, archive and retention
- Queue saturation and recovery
- Rolling upgrade and safe rollback

Do not treat successful unit tests, synthetic SQL microbenchmarks or complete draining of the small accepted subset as proof of enterprise throughput.

## Engineering rules

- Preserve all existing functionality.
- Never acknowledge work before durable acceptance.
- No lost alerts, duplicate incidents or incorrect incident transitions.
- Never compromise authentication, quotas, auditability or Service Automation.
- No unbounded in-memory queues.
- No arbitrary concurrency or pool-size increases.
- Do not introduce Redis/Kafka without measurements demonstrating the need.
- Do not weaken locks or disable triggers to manipulate benchmark results.
- Keep changes maintainable, testable and backwards compatible with the supported upgrade procedure.
- Record source SHA, immutable image ID, exact test topology and complete evidence for every run.

## Final deliverables

Provide:

1. Root-cause report showing the original bottlenecks.
2. A component-by-component change summary with correctness justification.
3. Before/after transaction, SQL, lock and WAL measurements.
4. Full-stack capacity results for every successful and failed stage.
5. Enterprise fault and recovery certification.
6. Remaining limitations and a clear go/no-go release verdict.

**Success means 600 events/sec are durably accepted and fully processed for 60 minutes—not merely queued, acknowledged or eventually drained.**
