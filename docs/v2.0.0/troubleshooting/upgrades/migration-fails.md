---
title: Upgrade migration fails
description: Preserve data and diagnose migration ordering, drift, locks, and compatibility.
type: troubleshooting
product_area: upgrades
audience: [operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [scripts/validate-migrations.cjs, scripts/check-migration-health.cjs]
---

# Upgrade migration fails

Stop additional migration owners and preserve the first failure. Record the
application revision, migration name, database revision, lock state, and exact
error. Run the repository migration validation and health checks. Do not use
destructive drift repair, force flags, or manual schema edits. Follow the tested
rollback or restore decision established before the upgrade.
