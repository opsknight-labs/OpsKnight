---
title: Application startup fails
description: Diagnose migration, configuration, database, and runtime startup failures.
type: troubleshooting
reader:
  status: READER_COMPLETE
  task: Diagnose, recover, and verify startup fails.
product_area: deployment
audience: [operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/env-validation.ts, scripts/check-migration-health.cjs]
---

# Application startup fails

Capture the failing runtime role and first causal error. Validate required secrets,
external URLs, database URLs, encryption-key format, database reachability, and
migration health. Confirm that a migration-only process is not being used as a
web or worker runtime. Correct one boundary at a time and preserve the original
logs; repeated blind restarts can hide a deterministic configuration failure.

## Triage by startup phase

1. Inspect the first fatal line, not the final restart-loop message.
2. If environment validation failed, correct the named value and its secret mount.
3. If database readiness failed, use the database connection runbook.
4. If migration failed, stop competing migration owners and use the migration runbook.
5. If Next.js starts but readiness fails, query `/api/health?mode=readiness`
   from inside the workload and inspect the reported dependency.

For containers, record `docker compose ps` and application/database logs. For
Kubernetes, record pod events, init/migration job logs, rendered environment
references, and termination status. Never paste secret values into an issue.

## Completion criteria

The runtime remains healthy through multiple probe intervals, the migration
health check is clean, the login page loads through the public origin, and the
expected scheduler/worker ownership is visible for the selected topology.
