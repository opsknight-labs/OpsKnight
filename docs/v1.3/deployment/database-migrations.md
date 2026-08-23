---
order: 7
title: Database Migrations
description: Understand startup migration behavior, verify schema state, and recover safely from failures
---

# Database Migrations

OpsKnight stores application state in PostgreSQL and ships ordered Prisma migrations under `prisma/migrations`. Treat the application image and database schema as one release unit.

## Startup behavior

The production container entrypoint in this repository revision runs `prisma migrate deploy` before starting the Next.js server. It attempts migration up to three times, waits five seconds between attempts, and invokes the packaged auto-recovery helper after a failed attempt. If migration still fails, the container exits non-zero instead of serving against an unknown schema.

The immutable published `1.3.1` image predates this fail-closed behavior and can start after migration failure. Confirm the exact image release before relying on startup behavior. For every release:

- inspect migration logs rather than treating container state as migration evidence;
- use readiness rather than liveness alone;
- verify migration health and exercise a database write.

Recovery defaults to `MIGRATION_RECOVERY_MODE=safe`. Safe mode handles only the specifically recognized escalation-policy enum migration and leaves unknown failed migrations for manual review. `aggressive` mode marks an unknown failed migration rolled back before retrying; do not enable it as a routine production setting. Use it only after a database owner has inspected the migration, actual schema/data state, and a tested recovery copy.

The shipped Helm chart does not create a separate pre-upgrade migration Job. With multiple replicas, each newly started container can attempt `migrate deploy`; use a controlled rollout and observe PostgreSQL migration locking/errors.

## Pre-deployment checks

From a checkout matching the intended image, with `DATABASE_URL` pointing to a disposable copy or the approved target during a maintenance window:

```bash
npm run prisma:validate
npm run prisma:health
```

`prisma:validate` checks migration naming and flags dangerous SQL patterns. `prisma:health` compares local migration directories with PostgreSQL's `_prisma_migrations` table, reports failed or unknown database migrations, and identifies unapplied migrations.

For a controlled manual deployment, the repository's combined command is:

```bash
npm run prisma:migrate:safe
```

That command validates files, checks database history, and runs `prisma migrate deploy`. Do not use `prisma db push` as a production upgrade method: it bypasses the reviewed migration history and does not provide the same deployment record.

## Release procedure

1. Read every migration added since the deployed image. Identify table rewrites, destructive statements, locks, backfills, and application compatibility requirements.
2. Measure the affected production tables and estimate lock/runtime behavior using a representative restored database.
3. Take a verified backup and preserve `ENCRYPTION_KEY`, `NEXTAUTH_SECRET`, deployment configuration, and the current image digest.
4. Stop conflicting schema changes and choose a maintenance or rolling-release strategy appropriate to the migration.
5. Deploy the new image and follow migration output until it reports success.
6. Check readiness, login, a database write, incident trigger/resolve, schedules, and notification delivery.
7. Query migration health again and retain the pre-change recovery point through the soak period.

## Verify in each deployment

Docker Compose:

```bash
docker compose logs --tail=300 opsknight-app
docker compose exec -T opsknight-app npm run prisma:health
```

Kubernetes/Helm:

```bash
kubectl logs -n opsknight deployment/opsknight --tail=300
kubectl exec -n opsknight deployment/opsknight -- npm run prisma:health
```

Resource names can differ with overlays or Helm name overrides. Run the command against one container built from the exact deployed image.

## Failed migration response

If migration fails:

1. Stop the rollout and preserve the first complete error, container logs, and PostgreSQL logs.
2. Prevent incompatible application versions from serving writes.
3. Check database reachability, credentials, permissions, disk space, locks, statement timeout, and `_prisma_migrations` state.
4. Determine whether the migration made partial data/schema changes before retrying.
5. Test the recovery on a restored copy.
6. Use `prisma migrate resolve --applied` or `--rolled-back` only when a database owner has verified the actual schema state and the selected resolution matches it.

Do not repeatedly restart every replica, delete `_prisma_migrations` rows, edit an already-applied migration, or mark a failed migration applied merely to make startup continue. Those actions can hide schema drift.

## Related topics

- [Backup and restore](./backup-restore)
- [Upgrade and rollback](./upgrade-rollback)
- [Docker Compose](./docker)
- [Helm](./helm)
- [Maintenance](./maintenance)
