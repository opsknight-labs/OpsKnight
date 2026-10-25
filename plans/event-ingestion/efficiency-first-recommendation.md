## My recommendation: design OpsKnight for efficiency first, scale second

You're right about the economics. A self-hosted incident-management product should not need an expensive database cluster just to handle a moderate alert storm. Otherwise, one of the main reasons to choose open source disappears.

After reviewing the ingestion branch and PostgreSQL's performance guidance, I would keep PostgreSQL, retain the existing split-worker architecture, and redesign how incident side effects are planned and executed.

One important distinction changes the capacity target:

| Workload                 | Actual rate             |
| ------------------------ | ----------------------- |
| 300 new incidents/minute | 5 incidents/sec         |
| 600 new incidents/minute | 10 incidents/sec        |
| 300 incoming events/sec  | 18,000 events/minute    |
| 300 new incidents/sec    | 18,000 incidents/minute |

These are dramatically different workloads. We should certify them separately, because many incoming events may be deduplicated into existing incidents.

My proposed product targets are:

- Affordable self-hosted tier: At least 300 new incidents/minute sustained, with timely downstream processing.
- High-volume tier: 300 incoming events/sec sustained, including deduplication, Automation and realistic incident creation.
- Stress target: Increasing numbers of brand-new incidents/sec, measured separately rather than hidden inside a mostly deduplicated workload.

The latest benchmark already demonstrates approximately 33 brand-new incident units/sec in the isolated downstream test. That's well above 300 incidents/minute, but it does not establish affordable full-stack performance, since admission, incident writes and effects still compete for resources.

## The most valuable code finding

In the current [`event-outbox.ts`](https://github.com/opsknight-labs/OpsKnight/blob/b0447b6cfbfb89860de5c23ed980e0f7c5f55849/src/lib/event-outbox.ts?utm_source=chatgpt.com), new incidents create several jobs for webhooks, service notifications, status pages and war rooms.

Then [`war-room/engine.ts`](https://github.com/opsknight-labs/OpsKnight/blob/b0447b6cfbfb89860de5c23ed980e0f7c5f55849/src/lib/war-room/engine.ts?utm_source=chatgpt.com) enumerates both registered war-room providers and creates provider-delivery work, even though their adapters may subsequently determine that the feature isn't configured.

Likewise, other handlers query the database simply to discover that there are no status pages, recipients or integrations to notify.

That produces real PostgreSQL writes, reads, claims and completions for work that often has no external effect.

This is the first thing I would change—not the database size.

## 1. Redesign: generate work only when it's needed

Current

Incident → fixed effect jobs → database checks → often no-op

Proposed

Incident → evaluate configured capabilities → only necessary jobs

Create a lightweight `IncidentEffectPlanner` that evaluates the applicable configuration and produces a list of required work before outbox insertion.

For example, when there is no configured status page, webhook destination, Slack/Teams war room or other applicable integration, avoid scheduling the associated no-op processing.

The planner must use the service/configuration information already loaded where possible, not introduce another series of database queries. Publish immutable, versioned configuration snapshots for efficient reuse.

Crucial: Preserve existing configuration-change semantics. Events must not lose deliveries merely because settings changed while processing was queued. Unknown configuration should fail safely or use the existing execution path, not silently skip work.

This could eliminate a large portion of the synthetic workload's unnecessary jobs without weakening actual notification functionality.

## 2. Reduce database round trips per incident

The next optimization is to avoid loading the same incident and service repeatedly across independent effect handlers.

Today, multiple handlers separately retrieve incident status, service details, configuration and recipients.

I'd introduce a compact `IncidentEffectContext` containing the relevant transition identity, incident snapshot, service identity, routing version and generation.

The worker should reuse this context for processing while performing fresh authorization or lifecycle-fencing checks wherever required.

Also:

- Batch independent database writes into fewer statements.
- Reduce repeated Prisma object creation and response parsing on the hot path.
- Use parameterized SQL selectively for heavily executed, stable operations.
- Keep expensive preparation outside lock-sensitive database transactions.

The latest CPU profiles show appreciable Prisma parsing and garbage collection activity, but do not prove all of the overhead comes from Prisma. We should compare query count, CPU time and allocations before replacing ORM operations wholesale.

Prisma itself recommends short transactions and batch operations where appropriate.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.prisma.io\&sz=32)

Prisma Documentation

+1



## 3. Make the worker queue cheaper

I would keep the PostgreSQL-backed durable queue but evolve its internal layout.

Near-term: Retain the existing `SKIP LOCKED` claims, indexed ready ordering and bounded worker concurrency. The recent index and critical-lane changes have already improved performance.

Next: Simplify queue selection for ordinary effects. Currently `BackgroundJob` contains many job types, and ordering checks inspect JSON payload fields and look for earlier unfinished jobs. Investigate first-class indexed `incidentId`, `lane` and sequence metadata for the hot event-effect path, plus a cheap ready-head mechanism if profiling demonstrates a real benefit.

Later: Separate active queue state from completed history so millions of old records don't inflate the hot working set.

PostgreSQL explicitly supports `SKIP LOCKED` for multiple queue-like consumers, but it must be paired with efficient indexes and short transactions.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.postgresql.org\&sz=32)

postgresql.org

+1



I would not implement a new queue schema immediately. First, measure the gains from removing unnecessary work; schema rewrites are more complex and riskier.

## 4. Scale efficiently, without requiring expensive infrastructure

These are proposed test budgets, not certified minimum hardware specifications.

| Deployment profile | Resource budget to test                                     | Purpose                                   |
| ------------------ | ----------------------------------------------------------- | ----------------------------------------- |
| Compact OSS        | 4 vCPU, 8 GB RAM total                                      | Single-machine app + PostgreSQL           |
| Growing team       | 8 vCPU, 16 GB RAM total                                     | Separate app/worker capacity and database |
| High-volume        | Selectively scaled app workers, modest dedicated PostgreSQL | 300 incoming events/sec target            |

The compact profile is the most important product milestone.

Start there, and make OpsKnight prove its capabilities under a strict CPU/memory/connection budget. Only increase resources when measurements demonstrate a real bottleneck.

For database efficiency:

- Set small, explicit connection pools for each runtime role.
- Keep critical paging resources protected from bulk work.
- Batch writes and avoid repeated status updates where safe.
- Monitor WAL bytes, lock waits, autovacuum and index bloat.
- Apply bounded retention and historical archiving while preserving required incident history, audit holds and idempotency.

PostgreSQL's statistics system provides the relevant counters, and partitioned retention can be useful once tables become large enough to justify it.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://www.postgresql.org\&sz=32)

postgresql.org

+1



One important economic point: 300 incidents/minute sustained for 24 hours means 432,000 incidents/day. Storage growth matters even if CPU throughput is excellent. Retention design belongs in the scalability plan, not as an afterthought.

## 5. Implementation order

P0

Cycle 1 — Eliminate unnecessary work

Implement configuration-aware effect planning, batch shared reads and remove confirmed no-op processing. Keep existing durable identities and recovery paths.

P0

Cycle 2 — Optimize worker CPU and database round trips

Benchmark each handler, simplify the common execution path, reduce avoidable Prisma overhead and optimize completion statements. Do not blindly increase worker replicas.

P1

Cycle 3 — Optimize the PostgreSQL queue if still necessary

Typed hot-path metadata, simpler claims, ready-head ordering, efficient retention and index maintenance—each introduced behind correctness tests.

P1

Cycle 4 — Certify under fixed infrastructure budgets

Establish the compact tier first, then measure how much additional throughput selectively scaling workers buys before PostgreSQL becomes the limiting resource.

## 6. What must be demonstrated

I would establish the following independent release gates:

| Test                          | Proposed success criterion                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 300 new incidents/minute      | 60 minutes, all lifecycle work completed, stable downstream backlog                                            |
| 600 new incidents/minute      | 30-minute stretch test on the same modest hardware                                                             |
| 50 incoming events/sec        | Fully end-to-end certified, not just receipt completion                                                        |
| 100 → 300 incoming events/sec | Incremental high-volume profile with a disclosed incident/deduplication mix                                    |
| Critical paging               | p95 below 1 second to durable notification handoff, with controlled local-provider capture separately measured |
| Reliability                   | Zero lost acknowledged events; no duplicate effects caused by retries                                          |

Real provider delivery should have separate targets because third-party rate limits are outside OpsKnight's control. The test must also preserve Service Automation, escalation, Runbooks and lifecycle-ordering behavior.

And we must explicitly test a newly enabled integration against queued events, disabled configurations, application crashes between stages, and mixed-version upgrades.

## Final recommendation

I would make the cost-efficient `IncidentEffectPlanner` plus shared-context optimization the next major engineering change.

It's the best current opportunity to cut unnecessary CPU, database I/O and background queue traffic simultaneously.

The target is not just reaching 300 RPS on a powerful machine. It's making OpsKnight capable of handling hundreds of incidents per minute on affordable infrastructure, with reliable paging and no continuously growing backlog.

After that, the 300-events/sec high-volume tier becomes a measurable scaling goal rather than an expensive architectural assumption.

The next implementation should be judged by throughput per vCPU, database statements per incident, storage written per incident, and end-to-end correctness—not just raw RPS.