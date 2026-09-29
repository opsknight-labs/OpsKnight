---
title: Upgrade an OpsKnight Compose deployment
description: Back up, migrate, replace, validate, and make a rollback decision for an integrated or split Compose deployment.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Compose upgrade, migration, rollback]
reader:
  status: READER_COMPLETE
  task: Upgrade a Compose deployment without overlapping runtime ownership.
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - deploy/compose/docker-compose.yml
    - deploy/compose/docker-compose.split.yml
    - deploy/scripts/validate-runtime-capacity.cjs
---

# Upgrade an OpsKnight Compose deployment

An upgrade changes a coupled application, schema, configuration, and runtime-role contract. Use the exact existing Compose file list throughout the procedure.

## Prerequisites

Read release notes, [Database migrations](../../upgrades/database-migrations), the general [Upgrade runbook](../../upgrades/upgrade), and [Rollback](../../upgrades/rollback). Obtain the approved immutable image digest and establish a maintenance/rollback decision window.

## Prepare and configure the upgrade

1. Record the current source revision, file list, resolved images, role state, and configuration backup.
2. Take a logical PostgreSQL backup and verify it can be read.
3. Back up stable application secrets separately.
4. Confirm free database/storage capacity and current health.
5. Put the new digest in `.env`; do not change unrelated settings in the same operation.

```sh
docker compose <files> config --images
docker compose <files> ps -a
docker compose <files> config --quiet
node deploy/scripts/validate-runtime-capacity.cjs
docker compose <files> pull
```

Replace `<files>` with the exact ordered `-f` arguments recorded for the deployment. Protect rendered output because it may contain secrets.

## Run the upgrade

For split mode, stop replacement rollout, run the one-shot migration owner using the new image, inspect its logs, and require exit code zero before recreating long-running roles. Never route the migration through PgBouncer.

For integrated mode, ensure the verified backup exists before replacing the application. The integrated startup path owns its migration boundary; do not start multiple old/new integrated owners concurrently.

After migration succeeds:

```sh
docker compose <files> up -d --wait
docker compose <files> ps -a
```

Do not use `down --volumes` during an upgrade.

## Verify the upgraded deployment

1. Confirm the resolved image is the new approved digest for every role.
2. Require migration success and readiness through loopback and public HTTPS.
3. In split mode, verify all six long-running roles and absence of integrated ownership.
4. Sign in, create a synthetic incident, acknowledge and resolve it.
5. Verify notification delivery, ChatOps action where configured, and status projection.
6. Watch errors, queue age, scheduler/projection lag, provider failures, and database connections through the soak window.

Record the evidence and decide explicitly to accept or invoke rollback.

## Operate after acceptance

Retain the pre-upgrade backup, old image digest, configuration snapshot, and decision record for the defined rollback window. Resume normal backup schedules and confirm monitoring still recognizes every role and metric.

## Troubleshooting

**Migration fails:** keep application roles stopped, preserve logs, diagnose database connectivity/privileges and the specific migration. Do not blindly rerun destructive statements.

**A role uses the old image:** inspect the resolved configuration and recreate only after confirming the correct digest and file list.

**Readiness succeeds but queues grow:** inspect lane ownership, worker image/configuration, database/provider saturation, and heartbeat freshness before adding replicas.

**Rollback is requested after migration:** application image rollback does not reverse schema changes. Follow the release-specific rollback decision; restore the database only through the controlled recovery procedure when required.

## Change or undo the upgrade

Use [Rollback](../../upgrades/rollback). If the release supports application rollback against the migrated schema, restore the old digest and recreate roles without overlapping ownership. If not, stop writes and follow the documented database restore/recovery path. Never improvise reverse migrations.

## Next steps

- [Compose troubleshooting](./troubleshooting)
- [Production acceptance](./production-checklist)
- [Backup and restore](../../data/backup-and-restore)

