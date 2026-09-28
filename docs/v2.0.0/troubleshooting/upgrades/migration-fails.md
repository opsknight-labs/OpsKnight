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

## Safe decision path

1. Stop every additional migration owner while leaving the database available.
2. Capture the failed migration name, SQLSTATE, application image digest, and
   migration-table state.
3. Determine whether the migration made no change, committed fully, or partially
   changed data outside a transaction.
4. Compare against the pre-upgrade backup and the release rollback compatibility notes.
5. Choose resume, application rollback, or database restore according to that evidence.

Never mark a migration applied merely to unblock startup. Never edit an already
released migration file. Test the selected recovery on a restored copy when the
failure may have partially transformed data.

Completion requires a clean migration-health check, the expected schema revision,
healthy application roles, and a smoke test of login plus an incident lifecycle.
Retain redacted logs and validation output with the upgrade record.
