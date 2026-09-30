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
> Two supported variants were **NOT TESTED**. Some individual scenarios or
> correctness invariants passed, but no topology passed the complete suite.
> OpsKnight therefore publishes no certified alert, notification, user, SSE,
> or status-fanout envelope from this run.

## Certification summary

| Topology | Load levels | Scenarios passing | Invariants | Capacity status |
|---|---:|---:|---:|---|
| `compose_integrated_bundled_db` | L0 | 2/6 | Failed | **NOT CERTIFIED** |
| `compose_integrated_external_db` | — | — | — | **NOT TESTED** |
| `compose_split_bundled_db` | L0 | 0/7 | Failed | **NOT CERTIFIED** |
| `compose_split_pgbouncer` | L0 | 1/8 | Failed | **NOT CERTIFIED** |
| `compose_split_pgbouncer_external_db_ca` | — | — | — | **NOT TESTED** |
| `swarm_single_node_split` | L0 | 2/7 | Failed | **NOT CERTIFIED** |
| `swarm_ha_split` | L0 | 4/8 | Failed | **NOT CERTIFIED** |
| `kind_helm_split_pgbouncer` | L0 | 0/8 | Passed | **NOT CERTIFIED** |
| `kind_kustomize_split_pgbouncer` | L0 | 0/8 | Passed | **NOT CERTIFIED** |
| `phase6_compose_integrated` | L0 | 0/10 | Failed | **NOT CERTIFIED** |

## Provenance

- Artifact: `artifacts/load-certification/certification-summary.json`
- Pull request: #777
- Artifact generated: 2026-09-28T12:20:49.770Z
- Product source revision tested: `52d6a3c5c791e7ad9ad21cd76f11cbdf11d3176f`
- Test harness revision recorded: `e2cd6e28092f544eea2342ebe455cac680fd157b`
- Test window: 2026-09-27T16:33:18.158Z through 2026-09-28T17:02:47.338Z
- Host profile: 10-core CPU, 16 GB RAM; Docker Engine 28.x; Kind v0.31.0
- Tested level: L0
- Database and runtime profiles: recorded in the source certification report and
  topology definitions; do not transpose these measurements to a different pool,
  replica, host, or provider configuration.

> The benchmark artifact was produced from product revision
> `52d6a3c5c791e7ad9ad21cd76f11cbdf11d3176f`. The harness was later revised at
> `e2cd6e28092f544eea2342ebe455cac680fd157b`, and the benchmark was not rerun after that
> harness change. The results remain historical evidence, not a certification of
> the later harness revision.

## How to use these results

Use the failures to choose what to observe and scale, not as sizing promises.
See [Scaling signals](./scaling-signals/) and [Certification methodology](./certification-methodology/).
Numeric production guidance will be published only after a topology reaches
**CERTIFIED** status.
