---
title: Application startup fails
description: Diagnose migration, configuration, database, and runtime startup failures.
type: troubleshooting
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

