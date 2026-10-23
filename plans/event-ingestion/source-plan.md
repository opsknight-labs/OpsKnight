# OpsKnight: Enterprise-Scale Event Ingestion Architecture

My recommendation is to redesign OpsKnight's ingestion pipeline so it can accept large volumes of alerts without forcing every HTTP request to complete incident processing first.

The goal should be to support thousands of requests per second, survive major alert storms, and continue processing safely during application restarts, database slowdowns, and infrastructure failures.

I inspected the current OpsKnight repository, including `src/lib/events.ts`, the Events API, integration middleware, PostgreSQL job queue, and existing capacity documentation.

## 1. What is limiting OpsKnight today?

The important finding is that OpsKnight is partially asynchronous, but its ingestion path is still synchronous.

CURRENT ARCHITECTURE

Monitoring systems / Incoming webhooks

Next.js API

Authentication, validation, rate limits

Synchronous PostgreSQL transaction

Deduplication locks → Alert creation → Classification → Automation rules → Incident creation/update → Escalation and job scheduling

HTTP response

Only after the transaction finishes

Existing asynchronous workers

Notifications, webhooks, escalations and other background jobs

This matters because HTTP throughput is tied to database transaction latency, database connection availability, and processing complexity.

For example, `src/lib/events.ts` already uses transaction-scoped advisory locks to preserve incident deduplication correctness. That is good for correctness, but requests targeting the same incident can become serialized.

Also, the Events API currently sets a limit of 120 requests per minute per rate-limit key. That is a separate admission-control restriction that must be addressed before high-throughput use cases can work.

The existing architecture has useful foundations. We should preserve its incident-state correctness rather than replacing everything.

## 2. Capacity: where we stand and what we should target

OpsKnight's published September 2026 load-certification artifact contains these observed peaks:

| Deployment                       | Historical observed peak | Certification |
| -------------------------------- | ------------------------ | ------------- |
| Docker Compose + PgBouncer       | 230.5 RPS                | Not certified |
| Docker Swarm HA + PgBouncer      | 104.6 RPS                | Not certified |
| Kubernetes Helm + PgBouncer      | 95.5 RPS                 | Not certified |
| Kubernetes Kustomize + PgBouncer | 66.1 RPS                 | Not certified |

These are historical peak observations, not proven sustainable limits. The repository's newer capacity reference explicitly says none of those tested topologies completed full certification. I would not use the historical numbers as production guarantees.

Evidence: [Capacity benchmark results](https://github.com/opsknight-labs/OpsKnight/blob/main/docs/v2.1.0/operate/capacity/benchmark-results.md?utm_source=chatgpt.com) and [Event processing implementation](https://github.com/opsknight-labs/OpsKnight/blob/main/src/lib/events.ts?utm_source=chatgpt.com).

### Proposed performance targets

# 1,000

RPS

First milestone

# 5,000

RPS

Enterprise baseline

# 10,000

RPS

Large deployment goal

# 25,000+

RPS

Burst / stretch goal

These are engineering targets, not measured OpsKnight capabilities. We should separately certify the rate at which requests are durably accepted and the rate at which incidents are actually processed.

For a first enterprise release, I would aim for:

- Sustained 5,000 RPS ingestion under a documented workload.
- 25,000 RPS burst acceptance for 60 seconds, with bounded queue growth.
- Ingestion acknowledgment p95 under 100 ms in the same deployment region.
- New critical incidents materialized p95 under 2 seconds during normal, non-overloaded operation.
- Zero lost durably accepted alerts and zero duplicate logical incidents.
- Recovery from worker crashes and broker-node failures without losing accepted events.

At 5,000 RPS sustained, OpsKnight could receive 432 million events in one day. That means retention, partitioning, storage cost, and deduplication efficiency must be designed alongside ingestion speed.

## 3. Recommended architecture: Durable asynchronous ingestion

I would introduce a dedicated ingestion pipeline, while keeping OpsKnight's existing incident engine and PostgreSQL-based operational state.

PROPOSED HIGH-SCALE ARCHITECTURE

Prometheus · Datadog · Grafana · CloudWatch · Events API

Load balancer + ingestion gateway

Authentication · HMAC · Validation · Quotas · Backpressure

Scale horizontally

Durable ingestion queue / event log

Replicated · Persistent · Partitioned · Replayable

202 Accepted after durable append

Dedicated ingestion workers

Normalize → Deduplicate → Classify → Evaluate automation → Process incident

PostgreSQL + PgBouncer

Canonical incidents · Transactional outbox · Escalation state · Audit data

Critical notification workers

Runbook / automation workers

Status / realtime workers

The key change is that an HTTP request no longer waits for a complete incident transaction. It waits only for authentication, validation, and acknowledgment that its event has been durably stored.

One essential distinction: `202 Accepted` would mean durably accepted for processing, not incident successfully created. OpsKnight must expose processing status, failure status, and reconciliation tools separately.

### Which queue technology should OpsKnight use?

| Technology                 | Best use                         | My assessment                                                                                        |
| -------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| PostgreSQL inbox           | Small/self-hosted deployments    | Best compatibility and minimal infrastructure; limited very-high-scale headroom                      |
| Redis Streams              | Intermediate workloads           | Fast, but durability, failover, retention and pending-message recovery require careful configuration |
| Kafka / Redpanda           | High-volume enterprise ingestion | My preferred direction for sustained thousands of RPS with partitioning and replay                   |
| Managed SQS / cloud queues | Cloud-specific deployments       | Strong managed durability; ordering requires deliberate design                                       |

My choice: build a pluggable ingestion transport with PostgreSQL as the default and a Kafka-compatible transport for high-scale deployments.

This allows OpsKnight to remain easy to self-host, without requiring Redis or Kafka for every installation.

The transport abstraction must have explicit guarantees around durability, acknowledgment, ordering, retries and recovery—not merely a common `publish()` method.

## 4. The most important optimizations, based on the code

I found several specific areas that deserve attention beyond simply introducing a queue.

| Priority | Finding                                                              | Required change                                               |
| -------- | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| P0       | Requests wait for incident processing                                | Move processing behind durable ingestion                      |
| P0       | PostgreSQL rate-limit counter updates on each request                | Replace hot-row admission control                             |
| P0       | Fixed limits of 100–120 requests/minute per integration              | Introduce configurable tenant/integration quotas and bursts   |
| P0       | Provider delivery claims depend on PostgreSQL before processing      | Redesign claims around durable acceptance                     |
| P0       | No certified production throughput envelope                          | Establish real sustained-load certification                   |
| P1       | Deduplication uses advisory locks                                    | Preserve correctness while reducing contention                |
| P1       | Automation evaluation executes inside the incident transaction       | Reduce database work and safely cache immutable configuration |
| P1       | Raw alerts, incidents and background jobs share PostgreSQL resources | Separate capacity budgets and storage lifecycles              |
| P1       | Existing PostgreSQL workers poll for jobs                            | Add independent ingestion consumers with adaptive concurrency |

Relevant implementations: [Rate limiter](https://github.com/opsknight-labs/OpsKnight/blob/main/src/lib/rate-limit.ts?utm_source=chatgpt.com), [Integration middleware](https://github.com/opsknight-labs/OpsKnight/blob/main/src/lib/integrations/handler.ts?utm_source=chatgpt.com), [Automation runtime](https://github.com/opsknight-labs/OpsKnight/blob/main/src/lib/automation/runtime.ts?utm_source=chatgpt.com) and [Job queue](https://github.com/opsknight-labs/OpsKnight/blob/main/src/lib/jobs/queue.ts?utm_source=chatgpt.com).

### A. Eliminate PostgreSQL hot-row rate limiting

`src/lib/rate-limit.ts` increments a PostgreSQL counter using an `upsert`. Requests sharing a rate-limit key contend on that counter.

That can become a bottleneck even before actual incident processing starts.

Implement a distributed token-bucket or GCRA rate limiter with independent quotas for organizations, integrations and global overload. Redis can be useful for this limited purpose, although the architecture should not require Redis for durable event storage.

Also separate intentional `429` quota rejections from capacity failures. A performance benchmark must not increase its apparent success rate by counting rejected requests as successful ingestion.

### B. Shorten incident processing transactions

Currently, `prepareAutomation()` includes configuration retrieval, compiled-rule evaluation, policy lookup and responder-snapshot work in the broader incident transaction.

Optimize this by loading immutable, versioned configuration before the transaction where safe, without changing which configuration version or escalation decision is applied.

Move nonessential diagnostic and observation work outside the transaction. Retain every decision-critical operation that must be atomic.

Measure each query and lock wait. Don't blindly parallelize Prisma calls inside a single transaction or cache mutable configuration without revision-aware invalidation.

### C. Handle deduplication storms intelligently

An event storm could deliver 10,000 alerts that all represent the same infrastructure outage.

The desired outcome might be one incident with 10,000 associated signals, not 10,000 incidents.

Partition processing by a stable `(tenant, service, integration, deduplication key)` identity. Preserve order within each key, while processing independent keys concurrently.

Keep unique/idempotent processing receipts. Consider batching alert persistence and coalescing redundant updates, but only when raw alert retention and audit contracts remain satisfied.

Important: One extremely hot deduplication key cannot be arbitrarily parallelized without risking incorrect incident state. We must separately test same-key throughput and many-key throughput.

## 5. Fault tolerance and robustness

This is where an enterprise ingestion platform must be particularly careful.

Application crashes after accepting an event

Acknowledge only after durable persistence. The restarted consumer must replay pending work.

Worker crashes halfway through incident creation

Commit the incident change, processing receipt and transactional outbox together. Replay must be idempotent.

PostgreSQL becomes unavailable

Keep accepting only while the durable broker has safe capacity. Pause incident consumers and expose increasing processing lag.

Broker becomes unavailable

Reject new submissions with a retryable error instead of incorrectly returning HTTP 202.

A malformed event repeatedly crashes processing

Use bounded retries, failure classification, a dead-letter queue, and authorized replay after correction.

One noisy customer consumes all workers

Enforce tenant quotas, weighted-fair scheduling, bounded in-flight work and reserved critical-processing capacity.

A large recovery creates a retry storm

Use jitter, exponential backoff, circuit breakers and admission budgets. Do not replay everything simultaneously.

For Kafka-compatible enterprise deployments, use replicated storage, acknowledged writes to in-sync replicas, appropriate minimum in-sync replica settings, producer idempotence, and tested failover procedures.

Consumer processing should follow an at-least-once delivery + idempotent transaction model. Exactly-once external notifications cannot simply be assumed; notification delivery needs its own idempotency and reconciliation protections.

Another existing behavior deserves attention: `src/lib/events.ts` accommodates resolve-before-trigger events using a five-minute lookback. Under asynchronous processing, we should explicitly test whether that rule remains correct across delayed delivery, retries, replay and long broker outages.

## 6. Database and storage architecture

PostgreSQL should remain OpsKnight's source of truth for incident state. PgBouncer remains valuable, but PgBouncer alone cannot increase database write throughput indefinitely.

I recommend:

- Dedicated database connection budgets for ingestion consumers and the existing critical, general, bulk and projector workers.
- Partitioning and retention policies for high-volume alert history, after validating Prisma migrations, foreign keys and query plans.
- Appropriate indexes for deduplication, recent alert lookups and background-job claims, confirmed through real `EXPLAIN ANALYZE` evidence.
- Offloading older raw event history to durable object storage where configured.
- Avoiding unnecessary incident timeline writes for repeated identical events, provided users retain the required history and audit trail.
- Measuring WAL generation, disk IOPS, transaction duration, row-lock waits, vacuum pressure and replication lag.

At 5,000 events/second with an average payload of 10 KB, the incoming payload alone is about 4.32 TB per day before compression, replication, indexes or processing overhead.

Storage lifecycle design is therefore a requirement, not an optional later optimization.

## 7. Implementation plan

Phase 0

Measure and establish the baseline

Instrument API, validation, authentication, rate limiting, transaction stages, lock waits, queue age, database usage and real processing completion. Reproduce the current breaking point using existing k6 infrastructure.

Deliverable: Baseline bottleneck report and reproducible benchmark

Phase 1

Improve the existing synchronous path

Remove avoidable queries, reduce hot-row contention, improve caching, review expensive automation paths, optimize indexes and worker connection budgets. Preserve existing API behavior.

Deliverable: Low-risk optimization PR with before/after comparisons

Phase 2

Implement a durable PostgreSQL inbox

Introduce canonical event envelopes, ingestion receipts, idempotency records, a batch-capable consumer and processing status. Add crash-safe replay and transactionally consistent outbox behavior.

Deliverable: Default asynchronous ingestion, no new mandatory infrastructure

Phase 3

Introduce enterprise queue transport

Implement Kafka-compatible ingestion, partition-key ordering, replica-safe consumers, offset commits, dead-letter recovery, backpressure and admission controls.

Deliverable: Horizontally scalable ingestion gateway and consumers

Phase 4

Optimize downstream processing

Tune incident workers, deduplication, database writes, automation configuration handling, archival and fair workload scheduling. Keep critical notifications isolated from ingestion storms.

Deliverable: Bounded end-to-end processing lag at target workloads

Phase 5

Chaos testing and certification

Certify Swarm and Kubernetes topologies; test failures, restoration, replay, rolling upgrades, backwards compatibility and sustained capacity.

Deliverable: Published evidence-backed capacity envelope for each topology

Each phase should be delivered through separately reviewable PRs, with benchmark evidence and rollback instructions. I would not make the Kafka transport mandatory until the simpler inbox transport is demonstrated to be insufficient for the target profile.

## 8. Certification tests to add

OpsKnight already has useful L0–L9 load scenarios and provider emulators under [tests/load](https://github.com/opsknight-labs/OpsKnight/tree/main/tests/load?utm_source=chatgpt.com). Reuse them, but extend the tests to validate asynchronous behavior.

| Test               | Target                                        |
| ------------------ | --------------------------------------------- |
| 1,000 RPS          | Sustained, with full reconciliation           |
| 5,000 RPS          | Sustained for at least 60 minutes             |
| 10,000 RPS         | Large-scale candidate benchmark               |
| 25,000 RPS         | 60-second burst, with safe drain              |
| Hot-key storm      | No duplicate incidents or ordering violations |
| Worker termination | Zero lost accepted events                     |
| Database outage    | Controlled backlog and recovery               |
| Broker failover    | No false durable acknowledgments              |
| Provider 429/503   | Critical processing remains protected         |
| Replay test        | No duplicate incident transitions or effects  |
| Soak test          | 24-hour resource stability                    |
| Rolling upgrade    | Old and new producers/consumers interoperate  |

Every test must report both ingress RPS and completed-processing RPS, along with backlog growth, oldest-event age, p50/p95/p99 latency, DB load, retries and correctness violations.

One especially important test is stopping ingestion after a high-rate storm and verifying that the entire accepted backlog drains successfully. A system that accepts 10,000 RPS but only processes 500 RPS indefinitely is not a sustainable 10,000 RPS system.

## 9. Features OpsKnight administrators should be able to monitor

The existing System Health experience should gain an ingestion capacity section.

## Ingestion Health

Illustrative dashboard layout — not live data

Example

# 5,000

Accepted events / sec

# 4,950

Processed events / sec

# 12,400

Pending events

# 2.5s

Oldest pending age

Illustrative backlog during sustained 5,000 RPS input and 4,950 RPS processing

Accepted RPSProcessed RPS

01.5K3K4.5K6K0510152025

Illustrative data only

Essential administrative capabilities

Per-integration throughput

Queue age and depth

Worker health

Failure / DLQ inspection

Safe replay controls

Capacity and quota settings

I would include operator-controlled replay, pause/resume, tenant quota management and diagnostic tracing, with RBAC and audit logging. These should never allow an administrator to accidentally discard accepted events without an explicit, auditable action.

## 10. Final recommendation

I would build this as a first-class OpsKnight Ingestion Engine, separate from the existing Service Automation and Runbook engines but integrated with both.

The architecture should support three deployment profiles:

| Deployment        | Ingestion approach                                    | Intended use                                 |
| ----------------- | ----------------------------------------------------- | -------------------------------------------- |
| Standard          | PostgreSQL durable inbox                              | Lightweight, easy self-hosting               |
| High Availability | PostgreSQL inbox + dedicated workers                  | Medium deployments that pass their benchmark |
| Enterprise Scale  | Replicated event broker + dedicated ingestion workers | Thousands to tens of thousands of RPS        |

The most important design principle: Optimize for both fast acceptance and fast, correct incident processing. They are different performance problems, and both must pass certification.

We also need to preserve all existing integrations, API compatibility, service automation rules, deduplication, escalation scheduling, Runbook triggers, notification guarantees, and operational auditability during the migration.

My preferred sequence is first remove the avoidable database contention, then introduce the durable ingestion boundary, then scale its consumers and optimize PostgreSQL. Kafka/Redpanda should be an enterprise-scale transport option rather than an unnecessary dependency for every OpsKnight deployment.

This is a source-code and architecture review, not a new executed benchmark. The proposed RPS figures remain targets until they are proven under representative load and fault conditions.