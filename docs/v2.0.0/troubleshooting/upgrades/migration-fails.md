---
title: Upgrade migration fails
description: Preserve data and diagnose migration ordering, drift, locks, and compatibility.
type: troubleshooting
reader:
  status: READER_COMPLETE
  task: Diagnose, recover, and verify migration fails.
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

Run the shipped checks from the exact release checkout or image being deployed:

```bash
npm run prisma:validate
npm run prisma:health
```

If those script names are unavailable in an older release, inspect that release's
`package.json`; do not silently substitute a command from `main`. Capture the
complete first error and database SQLSTATE, then select a path:

- **No schema change committed:** correct the environmental cause—permissions,
  direct URL, lock holder, disk space, or incompatible database version—and run
  the same immutable migration image once.
- **Migration committed but the Job reported failure:** run the health check
  before retrying. The retry must be idempotent or recognize the applied record.
- **Partial non-transactional change:** stop. Rehearse the release-specific repair
  or restore on a copy before touching production.
- **Application incompatible with the new schema:** follow the documented
  rollback boundary. Do not assume rolling back the image also rolls back data.

For Kubernetes, preserve the failed Job rather than immediately replacing it:

```bash
kubectl -n <namespace> get job,pod -l app.kubernetes.io/component=migration -o wide
kubectl -n <namespace> logs job/<migration-job> --all-containers
kubectl -n <namespace> describe job <migration-job>
```

Never mark a migration applied merely to unblock startup. Never edit an already
released migration file. Test the selected recovery on a restored copy when the
failure may have partially transformed data.

Completion requires a clean migration-health check, the expected schema revision,
healthy application roles, and a smoke test of login plus an incident lifecycle.
Retain redacted logs and validation output with the upgrade record.
