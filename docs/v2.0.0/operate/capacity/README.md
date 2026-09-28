---
title: Deployment and capacity
order: 1
description: Choose a topology, budget database connections, observe saturation, and interpret certified capacity.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [deployment capacity, deployment topology, sizing OpsKnight, high availability]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [deploy/, src/lib/runtime-capacity.ts, artifacts/load-certification/certification-summary.json]
---

# Deployment and capacity

Choose topology from operational requirements first. Treat benchmark numbers as
capacity only when the matching topology, resource profile, load level, thresholds,
and correctness invariants are certified.

## Start here

1. [Choose a deployment](./choose-deployment/) from simplicity, isolation, HA,
   and platform constraints.
2. [Build a sizing model](./sizing/) for workload shape and database connections.
3. Use [scaling signals](./scaling-signals/) to change the constrained role.
4. Read the [benchmark results](./benchmark-results/) and their explicit status.
5. Review the [certification methodology](./certification-methodology/) before
   comparing a measurement to your environment.

No tested PR #777 topology currently has a certified production envelope.

