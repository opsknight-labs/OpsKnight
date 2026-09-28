---
title: Choose a deployment topology
description: Select Integrated Compose, Split Compose, Swarm, Helm, or Kustomize from operational requirements.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [which deployment, integrated vs split, Swarm HA, Helm vs Kustomize, PgBouncer]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [deploy/compose/, deploy/swarm/, deploy/kubernetes/, src/lib/runtime-capacity.ts]
---

# Choose a deployment topology

Do not select Split mode from an undocumented requests-per-second threshold.
Select it when independent scaling, failure isolation, or notification-lane
protection is an operational requirement.

| Topology | Best fit | HA | Independent scaling | PgBouncer | Capacity status |
|---|---|---:|---:|---:|---|
| Integrated Compose | Simplest single-host operation | No | No | No | Not certified |
| Split Compose | Single-host workload isolation | No | Yes | Optional | Not certified |
| Split + PgBouncer | Isolation plus web connection pooling | No | Yes | Yes | Not certified |
| Swarm HA | Docker-native multi-node operation | Yes | Yes | Yes | Not certified |
| Kubernetes Helm | Packaged, schema-validated Kubernetes | Yes | Yes | Yes | Not certified |
| Kubernetes Kustomize | GitOps and environment overlays | Yes | Yes | Yes | Not certified |

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

