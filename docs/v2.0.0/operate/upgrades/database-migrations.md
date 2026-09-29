---
title: Operate database migrations
description: Validate, apply, verify, and recover OpsKnight PostgreSQL migrations safely.
type: deployment
product_area: upgrades
audience: [operator]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [package.json, docker-entrypoint.sh, scripts/validate-migrations.cjs, scripts/check-migration-health.cjs, scripts/auto-recover-migrations.ts, deploy/kubernetes/helm/opsknight/templates/migration-job.yaml, deploy/swarm/scripts/migrate.sh]
---

# Operate database migrations

OpsKnight ships ordered Prisma migrations in `prisma/migrations`. Treat schema changes as a deployment operation: take a restorable backup, run one migration owner through a direct PostgreSQL connection, verify the schema, and only then roll out all application replicas.

## Before you start

You need the target OpsKnight image or checkout, a PostgreSQL account permitted to alter the OpsKnight schema, and a recent backup that has been restored in an isolated environment. Record the current image digest and application version.

Set `DIRECT_DATABASE_URL` to PostgreSQL itself. Do not point migration commands at a transaction-mode PgBouncer endpoint. `DATABASE_URL` may still point to PgBouncer for the web runtime; the entrypoint temporarily promotes `DIRECT_DATABASE_URL` while it manages the schema.

Stop or hold the rollout if you cannot identify a single migration owner. A Helm migration Job, Swarm migration service, Compose migration-only container, or one integrated container can own the operation. Do not start every replica with migrations enabled at the same time.

## Validate the migration set

From the release checkout, with database variables set for the target:

```bash
npm run prisma:validate
npm run prisma:health
```

`prisma:validate` inspects committed SQL and migration naming for known unsafe patterns. `prisma:health` compares the local migration directories with `_prisma_migrations`; unapplied migrations are warnings, while unfinished migrations or database records absent from the release are errors.

For a source-based deployment, the complete supported sequence is:

```bash
npm run prisma:migrate:safe
```

That command validates migrations, checks database health, runs `prisma migrate deploy`, and verifies the separately managed status-platform, SLA-scheduler, and voice-attempt indexes.

### SLA scheduler index boundary

The SLA scheduler index is optional while the scheduler remains in `LEGACY` or
`SHADOW` mode, but it is mandatory before an administrator can enable `INDEXED`
mode. The settings action verifies that
`idx_incident_next_sla_transition` exists and is valid before accepting that
transition. The source command installs it safely and repairs an invalid
concurrent build:

```bash
DATABASE_URL="$DIRECT_DATABASE_URL" npm run prisma:indexes:sla-scheduler
```

The current container entrypoint and Helm migration Job install the status-page
and voice-attempt online indexes but do not invoke the SLA scheduler installer.
Run the command explicitly during the `SHADOW` rollout before selecting
`INDEXED`. Do not assume the index exists merely because schema migrations or
the deployment migration Job completed; the UI will reject Indexed mode until
the database check passes.

## Apply migrations by deployment type

### Docker Compose

Use the release image as a one-shot migration owner before updating the long-running services. The packaged entrypoint recognizes `OPSKNIGHT_MIGRATION_ONLY=true`, applies migrations and online indexes, then exits instead of starting the application:

```bash
docker compose run --rm \
  -e OPSKNIGHT_MIGRATION_ONLY=true \
  -e DATABASE_URL="$DIRECT_DATABASE_URL" \
  -e DIRECT_DATABASE_URL="$DIRECT_DATABASE_URL" \
  opsknight-web
```

Use the actual web service name from your Compose file. A zero exit code and the final `Migrations and online indexes completed successfully` message are the success signal. Then roll out the application with `OPSKNIGHT_SKIP_MIGRATIONS=true` on replicas that are not the migration owner.

### Helm

The chart enables a pre-install/pre-upgrade migration Job when `migrations.job.enabled` is true. It uses the chart image and database secret, runs Prisma against `DIRECT_DATABASE_URL`, then installs the status-platform and voice-attempt indexes.

```bash
helm upgrade --install opsknight deploy/kubernetes/helm/opsknight \
  --namespace opsknight --create-namespace \
  --values values.production.yaml \
  --wait

kubectl -n opsknight logs job/opsknight-migration
kubectl -n opsknight get job opsknight-migration
```

Adjust the Job name if `nameOverride` or `fullnameOverride` is set. Continue only after the Job is `Complete`; a failed pre-upgrade hook must block rollout.

### Docker Swarm

The repository provides a standalone migration service runner:

```bash
OPSKNIGHT_IMAGE="ghcr.io/opsknight-labs/opsknight@sha256:<digest>" \
SWARM_STACK_NAME=opsknight \
deploy/swarm/scripts/migrate.sh
```

It prefers versioned Swarm database secrets, attaches the migration task to the stack network, waits for completion, and removes the ephemeral service. Do not deploy the updated stack if this script exits non-zero.

## What container startup does

Unless `OPSKNIGHT_SKIP_MIGRATIONS=true` (or legacy `SKIP_MIGRATIONS=true`) is set, the image runs `prisma migrate deploy`. It retries up to three times with five seconds between attempts and invokes the recovery helper after a failed attempt. If all attempts fail, the container refuses to start against an unknown schema. After migration it enforces required online indexes.

The default `MIGRATION_RECOVERY_MODE` is `safe`. Safe mode repairs only known, explicitly coded failure cases and leaves an unknown failed migration for human review. `aggressive` may mark an unknown failed migration as rolled back so it can be attempted again. Use aggressive mode only after examining the migration SQL, `_prisma_migrations.logs`, and actual database state; it does not undo SQL that PostgreSQL already committed.

## Verify the result

Run the health check again and inspect the migration table:

```bash
npm run prisma:health
psql "$DIRECT_DATABASE_URL" -c \
  'SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at DESC LIMIT 10;'
```

Success means there are no active records with `finished_at IS NULL` and `rolled_back_at IS NULL`. Then verify application readiness, administrator login, incident read/write, scheduler and worker health, queue processing, and one synthetic notification before ending the rollout soak period.

## If a migration fails

1. Stop the rollout and prevent old and new replicas from writing concurrently.
2. Preserve the migration-owner logs and query the failing row in `_prisma_migrations`, including its `logs` column.
3. Compare the database objects with the exact `migration.sql` from the image.
4. Prefer a reviewed forward fix when committed SQL partially succeeded.
5. Restore the validated pre-upgrade backup only when forward recovery is unsafe and the resulting data loss fits the approved RPO.

Do not edit an already-applied migration, delete rows from `_prisma_migrations`, run `prisma db push` in production, or use `prisma migrate resolve` merely to silence an error. Those actions can make the recorded state disagree with the schema.

For symptom-specific recovery, see [Migration fails](../../troubleshooting/upgrades/migration-fails/), [Upgrade](./upgrade/), and [Rollback](./rollback/).
