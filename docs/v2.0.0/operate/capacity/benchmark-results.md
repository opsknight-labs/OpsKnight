---
title: Capacity benchmark results
description: Evidence-derived load measurements and certification status for supported deployment topologies.
type: reference
product_area: deployment
audience: [operator, administrator]
keywords: [capacity benchmark, load test, certified capacity, alerts per second, deployment sizing]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [artifacts/load-certification/certification-summary.json, generated/docs-contracts/capacity.json]
---

# Capacity benchmark results

These results are generated from the PR #777 certification artifact. They are
measurements from one test profile, not universal production guarantees.

> **Capacity status:** Every tested topology in this artifact is **NOT CERTIFIED**.
> Some individual scenarios or correctness invariants passed, but no topology
> passed the complete suite. OpsKnight therefore publishes no certified alert,
> notification, user, SSE, or status-fanout envelope from this run.

## Certification summary

| Topology | Load levels | Scenarios passing | Invariants | Capacity status |
|---|---:|---:|---:|---|
| `compose_integrated_bundled_db` | L0 | 2/6 | Failed | **NOT CERTIFIED** |
| `compose_split_bundled_db` | L0 | 0/7 | Failed | **NOT CERTIFIED** |
| `compose_split_pgbouncer` | L0 | 1/8 | Failed | **NOT CERTIFIED** |
| `swarm_single_node_split` | L0 | 2/7 | Failed | **NOT CERTIFIED** |
| `swarm_ha_split` | L0 | 4/8 | Failed | **NOT CERTIFIED** |
| `kind_helm_split_pgbouncer` | L0 | 0/8 | Passed | **NOT CERTIFIED** |
| `kind_kustomize_split_pgbouncer` | L0 | 0/8 | Passed | **NOT CERTIFIED** |

## Provenance

- Artifact: `artifacts/load-certification/certification-summary.json`
- Pull request: #777
- Source revision: `e2cd6e280`
- Test window: 2026-09-27T16:33:18.158Z through 2026-09-28T03:20:59.161Z
- Host profile: 10-core CPU, 16 GB RAM; Docker Engine 28.x; Kind v0.31.0
- Tested level: L0
- Database and runtime profiles: recorded in the source certification report and
  topology definitions; do not transpose these measurements to a different pool,
  replica, host, or provider configuration.

## How to use these results

Use the failures to choose what to observe and scale, not as sizing promises.
See [Scaling signals](./scaling-signals/) and [Certification methodology](./certification-methodology/).
Numeric production guidance will be published only after a topology reaches
**CERTIFIED** status.
