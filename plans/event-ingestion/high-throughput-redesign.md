# OpsKnight High-Throughput Architecture Redesign

Deep code-path review + PostgreSQL architecture research · October 25, 2026

My conclusion: OpsKnight does not need Kafka or Redis as the next step. It needs a more efficient internal processing architecture.

The biggest opportunity isn't just making ingestion faster. It's reducing how much database and application work OpsKnight performs for every incoming event, incident and notification.

My recommended target is 600 events/sec sustained, with independently scalable processing and bounded 1,000 RPS bursts, using PostgreSQL as the durable source of truth.

## 1. What I found in OpsKnight

I reviewed the latest `feat/enterprise-event-ingestion` branch at commit [`1e88b3977`](https://github.com/opsknight-labs/OpsKnight/tree/1e88b3977c89b849a1509341a2372898eca93cd2?utm_source=chatgpt.com), tracing ingestion, deduplication, Service Automation, incident transactions, the outbox, background workers, notifications, runbooks and deployment configurations. I also checked PostgreSQL, Prisma, PgBouncer and AWS engineering documentation.

This is a substantial architectural code-path review, not a line-by-line audit of every file in the repository. I have not executed new benchmarks.

### Existing architecture

HTTP / Webhooks

Authentication → Quota → Validation

PostgreSQL admission

Budget reservation + ordering metadata + durable receipt

Ingestion workers

Claim receipt → Incident + Alert + Automation + SLA

BackgroundJob queue

Multiple tasks per incident and lifecycle transition

Paging

Webhooks

Runbooks

Status

This architecture already has several strengths: durable acknowledgment, idempotent replay, incident ordering, atomic outbox persistence, separate worker roles and crash recovery.

I would retain those guarantees rather than restart from scratch.

## 2. The most important findings

| Component             | Current observation                                               | Recommendation                                       |
| --------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| Admission             | Now demonstrates 50 RPS with low latency                          | Shorter, leaner transactions                         |
| Capacity reservations | Sharded budget rows still participate in admission and completion | Further isolate contention                           |
| Incident processing   | Multiple SQL reads and decisions inside a transaction             | Prepare outside locks; compact atomic writes         |
| Automation            | Versioned configuration and evaluation exist                      | Compile reusable immutable policy snapshots          |
| Event side effects    | Several background jobs per new incident                          | Configuration-aware durable dispatch                 |
| General workers       | Batch processing followed by another polling cycle                | Continuously refill bounded worker slots             |
| Job storage           | One large `BackgroundJob` table with varied workloads             | Isolate hot queues from historical jobs              |
| Deployment            | Split roles and PgBouncer already supported                       | Scale each lane according to its measured bottleneck |

### The largest hidden cost: downstream processing

In [`event-outbox.ts`](https://github.com/opsknight-labs/OpsKnight/blob/1e88b3977c89b849a1509341a2372898eca93cd2/src/lib/event-outbox.ts?utm_source=chatgpt.com), one incident creation can generate around four or five initial side-effect jobs, plus separate runbook evaluation and other lifecycle work.

The recorded side-effect profile shows approximately:

Queries per incident

# 105

Across sampled side-effect handlers

Host CPU per incident

# 40.7 ms

Isolated benchmark, not production

If those costs remained unchanged at 600 brand-new incidents/sec, side-effect handlers alone would imply roughly 63,000 queries/sec and 24 CPU-core-seconds of work per second, before other workloads. That's an extrapolation to show the scale of the problem, not a measured requirement.

The previous 100 RPS run also left more than 106,000 due side-effect jobs after receipt-drain and container cleanup. That snapshot does not by itself prove the steady-state drain rate, but clearly warrants proper downstream throughput measurement.

There is a second important design concern: the initial `TRIGGER_ESCALATION_NOTIFICATIONS` side effect is represented as a `SCHEDULED_TASK`, which the general job worker can claim. The critical worker separately owns escalation jobs and central notifications. We need to verify that a saturated general queue cannot delay the initial responder-notification planning.

This matters because 600 incidents created/sec is not the same achievement as 600 incidents created/sec with timely paging, notifications and runbook dispatch.

## 3. Recommended architecture

I recommend a PostgreSQL-first, three-stage architecture.

Stage A — Fast ingestion

Validate, enforce admission policy, durably append the event and acknowledge it. Do not evaluate the incident lifecycle or schedule unrelated work while holding admission locks.

Stage B — Incident engine

Dedicated workers perform ordering, deduplication, Automation, classification and incident changes. Keep the final write transaction as small as correctness permits.

Stage C — Effect dispatch

Independently scalable workers deliver critical paging, integrations, collaboration events, status updates and runbook operations. Generate only the necessary work while preserving every required effect.

The architectural principle here is supported by PostgreSQL and Prisma documentation: long-lived interactive transactions hurt concurrency, and PostgreSQL's `SKIP LOCKED` is useful for queue consumers, not a substitute for efficient queue design.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.prisma.io\&sz=32)

Prisma Documentation

+1



## 4. Detailed redesign plan

Prioritized for implementation by Antigravity

P0

Phase 0 — Measure four independently testable capacities

Before another architectural change, build four benchmark modes using the same immutable image and isolated machine:

- Admission-only: HTTP authentication, quota checks and durable receipt append, with consumers paused and a bounded test horizon.
- Incident-only: Process preloaded receipts with no HTTP load, while retaining real incident and outbox writes.
- Effects-only: Drain representative preloaded background jobs and measure every worker lane.
- Full-stack: All of those paths running simultaneously, including synthetic provider endpoints that record deliveries.

Each mode must report successful work/sec, CPU, queries per unit, pool waits, transaction times, WAL bytes and backlog growth.

This separates an admission problem from an incident-processing problem or an outbox problem. It also avoids incorrectly treating a benchmark that acknowledges events quickly as proof that downstream processing can sustain the same rate.

P0

Phase 1 — Make admission minimal and lock-efficient

Files: `src/lib/ingestion/postgres.ts`, `budget.ts`, `quota.ts`, `append-batcher.ts`, `admission-timing.ts`

The recent fix already moved retry delays outside transactions. Keep that.

Next, move serialization, envelope preparation and independent configuration reads before ordering/budget locks where feasible. Use revision checks to preserve policy semantics. Minimize the number of budget rows held, and avoid an admission batch holding an identity lock while preparing unrelated entries.

Investigate replacing frequent per-request quota-row updates with short-lived, PostgreSQL-backed quota credit leases. A replica would atomically obtain a small number of credits, spend them locally, and replenish when necessary. Credits must be bounded and pre-debited from the shared quota, with safe policy-revision invalidation and crash behavior. This is a candidate design, not an automatic replacement: it must prove that no replica can overgrant the configured rate.

Measure actual admission batch sizes before increasing the current 2 ms flush interval. At moderate traffic across multiple web replicas, some 32-event batch capacity may go unused.

Success: Minimal lock time, correct global quotas, no duplicate acknowledgments and reproducible admission throughput substantially above the desired 600 RPS processing rate.

P0

Phase 2 — Refactor the incident engine into prepare and commit

Files: `src/lib/events.ts`, `src/lib/automation/runtime.ts`, incident classification, SLA and escalation repositories

Today, `processEvent()` holds a transaction while reading service configuration, finding the incident, evaluating rules, creating alerts, creating the incident, initializing escalation and inserting outbox jobs.

Redesign it into two logical steps:

Prepare: Load immutable, versioned configuration and perform pure normalization, classification and Automation evaluation outside the write transaction when their semantics permit it.

Commit: Acquire the incident's deduplication fence; reread or validate mutable state; apply the correct lifecycle transition; atomically persist the incident, alert, Automation result, required outbox intents and receipt completion.

The preparation step must not make a final deduplication or lifecycle decision using stale state. Decisions depending on current incident status or emergency configuration remain protected by the commit transaction.

Optimize new incidents, deduplicated alerts, resolves and acknowledgments as separate hot paths. Use bulk SQL or nested writes only where they reduce actual database round trips, and verify resulting SQL counts.

Success: Considerably fewer reads and shorter transactions per incident without duplicate incident creation, stale Automation decisions or ordering regressions.

P0

Phase 3 — Redesign the side-effect execution engine

Files: `src/lib/event-outbox.ts`, `event-side-effects.ts`, `jobs/queue.ts`, notification modules

This is the change I would prioritize most after establishing the benchmark breakdown.

Introduce a configuration-aware effect planner. For each committed incident transition, determine which effects are actually required according to the applicable configuration and captured version.

For example, a service without an enabled status page or war room should not create unnecessary jobs merely to discover later that there is nothing to do. However, this optimization must preserve existing configuration-timing semantics and never discard an effect that was valid at the event boundary.

Next, simplify the execution work:

- Group shared incident/service/configuration reads instead of repeating them in every effect handler.
- Use one canonical transition identity so independent effects share the same event snapshot.
- Build recipient and provider delivery intents in batches, using deterministic idempotency keys.
- Keep genuinely independent provider operations separate so a slow webhook cannot block paging.
- Preserve mandatory lifecycle history, audit trails and notifications; allow coalescing only for explicitly defined latest-state projections.

Do not simply combine five jobs into one long-running job. That would introduce another head-of-line blocking problem. The goal is less redundant work with independent execution.

Follow the transactional-outbox principle: business-state changes and durable effect intents commit atomically, while downstream delivery is retryable and idempotent.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://docs.aws.amazon.com\&sz=32)

AWS Prescriptive Guidance



Success: Dramatically fewer jobs and queries per incident, and sustained outbox throughput that matches incoming event generation.

P0

Phase 4 — Protect critical paging from general-queue overload

Files: `src/lib/job-worker.ts`, `jobs/queue.ts`, `event-outbox.ts`, escalation and notification modules

Replace broad general-purpose claim behavior with explicit routing for incident effect lanes.

The priority should be:

Critical: Initial responder engagement, urgent escalation and critical notification intents.

Operational: Service notifications, webhooks and ordinary integrations.

Collaboration: War rooms, Teams/Slack coordination and related synchronization.

Bulk: Status subscribers, large notification fanout and exports.

Runbook: Execution and approvals, with separate capacity and policy controls.

Preserve per-incident/per-lane ordering. In particular, an acknowledgment must not overtake required initial engagement. The current `SCHEDULED_TASK` routing for initial escalation notification preparation needs focused testing and, if general-queue delays are confirmed, a safe lane migration.

Each lane should have its own concurrency budget, backlog metrics and failure isolation. Keep the existing critical, bulk and runbook deployments rather than introducing a different queue product.

Success: A large general/bulk backlog does not materially delay new critical pages.

P1

Phase 5 — Change workers from batch-and-poll to continuous processing

Files: `src/lib/job-worker.ts`, `src/lib/jobs/queue.ts`, `src/lib/ingestion/worker.ts`

The general worker currently claims a batch, runs it in concurrency-sized chunks, and schedules the next claim after that cycle finishes.

Introduce a bounded worker-slot scheduler that refills a completed slot immediately when work remains available, rather than waiting for an entire previously claimed batch.

Keep idle polling with jitter. PostgreSQL `LISTEN/NOTIFY` could optionally provide a wake-up hint, but the durable job rows must remain authoritative; notifications are not a replacement queue.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.postgresql.org\&sz=32)

postgresql.org



Add adaptive concurrency based on actual SQL pool waits, lock time, handler CPU and oldest job age. Avoid blindly increasing replicas or concurrency.

Success: Higher worker utilization and faster sustained draining without saturating PostgreSQL or notification providers.

P1

Phase 6 — Separate active queue state from history

Files: Prisma models/migrations, ingestion receipts, ordering links, background jobs and retention services

A future 600 RPS installation could generate millions of receipt records in hours. Each incident may also create multiple audit, timeline and outbox rows.

Evaluate a storage model that separates:

- Immutable accepted-event data and durable idempotency identity.
- Small, indexed active processing state.
- Completed receipt and job history.
- Long-term audit and retention data.

Keep the active claim indexes small, with relevant partial indexes. Measure table/index bloat, autovacuum progress and HOT-update rates. PostgreSQL specifically documents the benefits of HOT-friendly updates and partitioning for large historical tables.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.postgresql.org\&sz=32)

postgresql.org

+1



Introduce partitioning only with a proven migration strategy. PostgreSQL partitioned unique constraints can complicate globally unique delivery keys, so idempotency may require a separate durable identity table. Never drop replay protection merely because old payloads are archived.

Success: Queue latency remains stable after millions of completed records, not just on a fresh database.

P1

Phase 7 — Dedicated capacity profiles and database isolation

Retain the same OpsKnight application image and runtime-role approach, but define an explicitly supported high-throughput deployment profile.

It should assign distinct CPU, memory and database budgets to HTTP admission, ingestion workers, critical paging, general effects, bulk fanout and runbooks.

Use existing PgBouncer support where compatible, accounting for both its pool size and direct worker connections. PgBouncer transaction pooling releases server connections after transactions, but does not reduce the amount of database computation or WAL required.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.pgbouncer.org\&sz=32)

pgbouncer.org

+1



Keep `synchronous_commit=on` for acknowledged ingestion records. Turning it off to improve a benchmark would weaken the crash-durability guarantee.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.postgresql.org\&sz=32)

postgresql.org



Success: An isolated lane can scale without exhausting shared database capacity or harming critical incident operations.

## 5. Proposed performance gates

All thresholds below are engineering targets, not capacities already demonstrated.

| Stage | Workload                   | Acceptance requirement                      |
| ----- | -------------------------- | ------------------------------------------- |
| 1     | 50 RPS for 5 min           | Clean repeatable pass                       |
| 2     | 100 RPS for 5 min          | No rejections or dropped scheduled arrivals |
| 3     | 250 RPS for 10 min         | Stable incident and downstream backlogs     |
| 4     | 400 RPS for 10 min         | Stable p95/p99 under realistic mix          |
| 5     | 600 RPS for 60 min         | ≥600 accepted and processed/sec sustained   |
| 6     | 1,000 RPS burst for 60 sec | Bounded admission, safe overload recovery   |

For the 600 RPS gate, I'd additionally target acknowledgment p95 below 100 ms and incident-processing p95 below one second for the certified workload. Notification delivery needs separate latency and throughput criteria because external provider limits and the number of recipients vary.

Run at least two different traffic profiles: a realistic mix containing duplicates and lifecycle updates, and an adversarial profile with mostly brand-new incidents, active Automation and heavy notification fanout.

## 6. Essential enterprise verification

The most important non-performance tests are:

- Duplicate and out-of-order events, especially legacy/canonical multi-identity cases.
- Worker SIGKILL between incident persistence, receipt completion and effect dispatch.
- Admission failure after a durable commit but before the HTTP response.
- Automation configuration changes while events are queued.
- Critical paging during a deliberately saturated general and bulk queue.
- Runbook execution, manual approval and cancellation during incident storms.
- PgBouncer disruption, database recovery, rolling upgrade and rollback.
- Continuous backlog measurement, retention, autovacuum and long-running soak testing.

Amazon's engineering guidance emphasizes bounded queues, controlled overload, prioritized processing and isolation. The goal is high useful throughput, rather than allowing a system to accept unlimited work and become unresponsive.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://aws.amazon.com\&sz=32)

aws.amazon.com

+2



## 7. What should Antigravity do first?

Recommended first implementation cycle

1\. Produce admission-only, incident-only and downstream-only baselines using the current branch.

2\. Trace the full initial-escalation notification path and verify whether the general-worker backlog delays paging.

3\. Profile every side-effect handler by actual database queries, CPU usage and generated child jobs.

4\. Implement the smallest safe configuration-aware dispatch and shared-read optimizations.

5\. Improve continuous worker refilling, then repeat 50 and 100 RPS tests with downstream drain included.

Only after that should it proceed to deeper receipt-state, quota and storage redesigns. Otherwise, each new database migration risks increasing complexity without addressing the actual bottleneck.

### Final verdict

I believe 600 RPS on PostgreSQL is a reasonable target to attempt, without Kafka. But it's not guaranteed—and the architecture must be validated on the hardware and workload you're actually willing to support.

I would not rewrite OpsKnight into microservices or introduce a new broker. Instead:

Make admission cheap, make incident transactions short, generate fewer unnecessary background jobs, isolate critical paging, and make workers continuously efficient.

That is the redesign most directly supported by the current OpsKnight code, benchmarks and external engineering research.