---
title: Capacity certification methodology
description: Understand OpsKnight load levels, correctness invariants, pass criteria, and benchmark provenance.
type: reference
product_area: deployment
audience: [operator, developer]
keywords: [L0 L9 load levels, capacity certification, benchmark methodology, correctness invariants]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [artifacts/load-certification/certification-summary.json]
---

# Capacity certification methodology

A topology is **CERTIFIED** only when every required scenario threshold and
correctness invariant passes for a declared resource profile. A passing scenario
inside a failed suite is a measurement, not a certified envelope.

| Level | Workload intent |
|---|---|
| L0 | Smoke and harness validation |
| L1 | Steady baseline |
| L2 | Normal production peak |
| L3 | Alert storm |
| L4 | Deduplication storm |
| L5 | Major outage and notification fanout |
| L6 | Provider degradation |
| L7 | Realtime and SSE scale |
| L8 | Recovery and chaos |
| L9 | Breaking-point ramp |

## Required invariants

Certification checks for no duplicate open incidents, no lost accepted alerts,
no false escalation after acknowledgement or resolution, no corrupted incident
state, no critical-notification starvation, and provider idempotency.

## Required provenance

Every result must record the test date, source commit, host and resource profile,
runtime topology, database pools, load level, scenario thresholds, invariants,
and overall status. Missing evidence produces **NOT TESTED**; measurements without
a declared result produce **MEASURED**; a completed failing suite produces
**NOT CERTIFIED**.

The current evidence and exact profile are summarized in
[Capacity benchmark results](./benchmark-results/).
