---
title: Use the Health Center
description: Interpret runtime readiness, dependencies, workers, queues, and provider health.
type: how-to
product_area: observability
audience: [operator, administrator]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/app/(app)/settings/system/health, src/app/api/health, src/lib/runtime-capacity.ts]
---

# Use the Health Center

## Before you begin

Obtain operator access and identify the affected workflow, runtime role, and
time window.

1. Open the Health Center and inspect failed, warning, and unknown checks.
2. Identify the owning dependency or runtime role.
3. Correlate the check with metrics and system logs.
4. Apply the relevant runbook and verify recovery with a synthetic workflow.

The Health Center summarizes application readiness and operational dependencies.
Treat a green page as a point-in-time signal, not proof that delivery and paging
workflows are healthy end to end.

Review database connectivity, migration state, scheduler heartbeat, worker lanes,
queue age, and provider/circuit state. An unavailable critical worker or growing
critical queue is more urgent than a delayed bulk lane. Use the linked health
and metrics references for exact machine endpoints.

When a check fails, identify the owning runtime role, inspect its system logs,
confirm configuration and network reachability, and then verify recovery with a
synthetic workflow. Do not repeatedly restart a role without preserving the
original failure evidence.
