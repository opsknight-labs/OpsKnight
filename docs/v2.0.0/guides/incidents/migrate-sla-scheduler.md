---
title: Migrate the SLA scheduler to indexed mode
description: Move safely from legacy scanning through shadow comparison to indexed SLA scheduling.
type: how-to
product_area: incidents
audience: [administrator, operator]
reader: { status: READER_COMPLETE, task: Migrate SLA scheduling from LEGACY to INDEXED. }
verification:
  level: source
  verified_at: 2026-10-01
  evidence: ["src/app/(app)/settings/incident-sla/actions.ts", "src/lib/incident-sla/scheduler-control.ts", "scripts/create-sla-scheduler-online-index.cjs"]
---

# Migrate the SLA scheduler to indexed mode

## Before you begin

Back up PostgreSQL, confirm migration access, read [Database migrations](../../operate/upgrades/database-migrations), and record current due transitions, missing hints, and scheduler health. Only an administrator can change mode.

## Open the feature

Open **Settings → Incident SLA → Support & Schedules** and locate **SLA Scheduler**.

## Configure shadow mode

1. Leave production scheduling in `LEGACY` while installing the optional scheduler index with the documented installer.
2. Confirm the PostgreSQL index `idx_incident_next_sla_transition` exists and is valid.
3. Select `SHADOW`. This resets clean-check counters.
4. Monitor due counts, missing scheduling hints, shadow mismatch count, errors, and job cadence.
5. Investigate every mismatch; do not treat elapsed time alone as readiness.

## What OpsKnight does

`LEGACY` uses the legacy selection path. `SHADOW` compares indexed candidates with legacy truth while preserving safe behavior and populating hints. `INDEXED` makes the indexed path authoritative. The transition action uses an advisory lock and refuses a direct LEGACY→INDEXED jump.

## Verify indexed readiness

Require the configured minimum consecutive clean checks, zero latest mismatches, a valid index, and zero active incidents missing scheduling hints. Then select `INDEXED` and verify due incidents transition on time without duplicate/missed SLA events.

## Roll back

If indexed behavior diverges, return to `SHADOW` or `LEGACY`, preserve logs and mismatch evidence, and confirm legacy scheduling resumes. Do not drop the index during incident response; it is optional in legacy/shadow and can aid diagnosis.

## Troubleshooting

- **Run Shadow first:** the current mode is not `SHADOW`.
- **Resolve mismatches:** latest mismatch count is nonzero.
- **Wait for clean checks:** the minimum consecutive comparisons has not completed.
- **Install index:** the required PostgreSQL index is absent/invalid.
- **Missing hints:** keep shadow running and inspect active incidents until the count reaches zero.

## Next steps

- [System logs](../../operate/reliability/system-logs)
- [Prometheus metrics](../../operate/reliability/prometheus)
