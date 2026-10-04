---
title: Choose a deployment topology
description: Select Integrated Compose, Split Compose, Swarm, Helm, or Kustomize from operational requirements.
type: concept
product_area: deployment
audience: [operator, administrator]
keywords: [which deployment, integrated vs split, Swarm HA, Helm vs Kustomize, PgBouncer]
verification:
  level: source
  verified_at: 2026-10-02
  evidence: [deploy/compose/, deploy/swarm/, deploy/kubernetes/, src/lib/runtime-capacity.ts, tests/load/fixtures/users/index.ts, generated/docs-contracts/capacity.json]
---

# Choose a deployment topology

Do not select Split mode from an undocumented requests-per-second threshold.
Select it when independent scaling, failure isolation, or notification-lane
protection is an operational requirement.

## Deployment Planner

Use the closest profile as a conversation starter, then test your actual alert
and delivery mix. The profiles come directly from the current load-fixture
source; they are workload shapes, not certified capacity limits and not proof
that a topology will support every organization of that size.

| Profile | Users | Services | Integrations/service | SSE sessions | Status subscribers | Starting architecture to evaluate |
|---|---:|---:|---:|---:|---:|---|
| Small | 40 | 12 | 2 | 100 | 1,000 | Integrated Compose when one host and no HA are acceptable |
| Medium | 120 | 32 | 4 | 500 | Split Compose on one host, or Helm Split when Kubernetes/HA is required |
| Large | 400 | 80 | 5 | 2,500 | Helm/Kustomize Split with PgBouncer and external PostgreSQL |
| Storm | 1,000 | 200 | 5 | 5,000 | Multi-replica Split, PgBouncer, external HA PostgreSQL, and workload-specific certification |

### Small-profile starting point

Integrated Compose has the lowest operating cost: one runtime ownership model,
one host, and straightforward proxy and backup operations. Move to Split before
bulk work, provider delays, or independent worker scaling must be isolated from
critical paging. Forty users is not a Compose limit.

### Medium-profile starting point

Use Split Compose when a single host remains acceptable but notification lanes
need separate ownership. Use Helm Split when your organization already operates
Kubernetes or requires multi-node scheduling, disruption controls, and
independent replicas. Validate the PostgreSQL connection budget in either case.

### Large-profile starting point

Start evaluation with Split roles, PgBouncer transaction pooling, and an
external PostgreSQL service. Independent Web/worker scaling, connection control,
failure isolation, and disruption budgets usually matter more at this shape.
This is an operational recommendation, not a claim that 400 users require
Kubernetes.

### Storm or mission-critical starting point

Use multi-replica Split roles, PgBouncer, and external HA PostgreSQL, then run
the certification suite with your alert bursts, responder concurrency,
provider quotas, status fanout, retention, CPU/RAM, replicas, and database
pools. Do not derive a production RPS promise from the historical benchmark.

## Inputs that can change the answer

User count alone is insufficient. Record all of these before choosing:

- normal and burst alert-ingestion rate, deduplication shape, and service count;
- notifications generated per incident and each provider's account/destination limits;
- simultaneous responders, API clients, and SSE/realtime sessions;
- public status subscribers, update frequency, and delivery fanout;
- recovery-time, multi-node availability, and maintenance requirements;
- Web and worker replica counts, per-role pools, and PostgreSQL `max_connections`;
- operator ownership for Docker/Swarm/Kubernetes, backups, monitoring, and upgrades.

If a single constraint is uncertain, choose the simpler topology that still
meets availability requirements, measure it, and keep a documented migration
trigger. If critical and bulk work compete, database connections approach the
budget, or a single process/host is an unacceptable failure domain, evaluate
Split or multi-node operation before increasing raw concurrency.

| Topology | Best fit | Multi-node HA support | Independent scaling | PgBouncer support | Capacity status |
|---|---|---:|---:|---:|---|
| Integrated Compose | Simplest single-host operation | No | No | No | Not certified |
| Split Compose | Single-host workload isolation | No | Yes | Optional | Not certified |
| Split + PgBouncer | Isolation plus web connection pooling | No | Yes | Enabled | Not certified |
| Swarm HA | Docker-native multi-node operation | Yes | Yes | Optional in Split | Not certified |
| Kubernetes Helm | Packaged, schema-validated Kubernetes | Supported when configured | Yes | Optional in Split | Not certified |
| Kubernetes Kustomize | GitOps and environment overlays | Supported when configured | Yes | Optional in Split | Not certified |

## Decision path

- One host and minimal operational overhead: use [Integrated Compose](../deploy/compose/).
- Independent scheduler and queue-lane scaling: use [Split runtime](../deploy/split-runtime/).
- Many web replicas or roles threaten the PostgreSQL connection budget: add
  PgBouncer in supported Split mode after calculating the budget.
- Docker-native multi-node HA: use [Docker Swarm](../deploy/swarm/).
- Existing Kubernetes platform: choose [Helm](../deploy/helm/) for packaged values
  or [Kustomize](../deploy/kustomize/) for overlay ownership.

## Why Split exists

Integrated mode runs the web application and background work together. Split
mode separates web, scheduler, general, critical, bulk, and status-projector
roles. This allows a bulk backlog or provider slowdown to be isolated from
critical paging and lets each constraint scale independently.

## Validate the choice

1. Calculate the [database connection budget](../deploy/architecture/database-connections).
2. Run readiness, a real alert-to-acknowledgement journey, and provider tests.
3. Exercise the closest current fixture profile, then your own burst/fanout mix.
4. Watch latency, errors, oldest queued age, lane starvation, provider
   throttling, SSE stability, CPU/memory, and PostgreSQL connections.
5. Record the exact image, product/harness revision, fixture dimensions,
   topology, replicas, pools, host resources, passing level, and first failing
   level. Promote only the exact tested configuration.

See [Benchmark results](./benchmark-results) for historical observations and
[Certification methodology](./certification-methodology) for the proof contract.
