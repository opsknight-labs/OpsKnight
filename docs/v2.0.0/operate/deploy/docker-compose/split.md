---
title: Install split OpsKnight with Compose
description: Install and verify isolated OpsKnight web, scheduler, worker, and status-projector roles with Docker Compose.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Compose split runtime, workers, scheduler, migration]
reader:
  status: READER_COMPLETE
  task: Install and validate split-runtime OpsKnight with Docker Compose.
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - deploy/compose/docker-compose.yml
    - deploy/compose/docker-compose.split.yml
    - deploy/scripts/validate-runtime-capacity.cjs
---

# Install split OpsKnight with Compose

Split mode disables `opsknight-app`, runs a one-shot migration owner, and starts Web, Scheduler, General Worker, Critical Worker, Bulk Worker, and Status Projector independently.

## Prerequisites

Complete [Compose prerequisites](./prerequisites), read [Runtime roles](../architecture/runtime-roles), and calculate the [database connection budget](../../capacity/sizing). The pinned image must support split roles.

## Prepare the split configuration

Keep the base file first and split overlay second:

```sh
node deploy/scripts/validate-runtime-capacity.cjs
docker compose \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.split.yml \
  config --quiet
docker compose \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.split.yml \
  config --services
```

The rendered service list must contain the migration and six long-running roles. `opsknight-app` must not be an active service. Review the resolved image, database URLs, role names, health checks, pool sizes, and replica settings without publishing the secret-bearing output.

## Install split runtime

1. Pull every referenced image.
2. Start the selected topology and wait for health checks.
3. Require the migration service to exit successfully.
4. Require every long-running role to become healthy.

```sh
docker compose \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.split.yml \
  pull
docker compose \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.split.yml \
  up -d --wait
docker compose \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.split.yml \
  ps -a
```

If migration exits non-zero, stop. Do not bypass it or start application roles against an uncertain schema.

## Verify every role

Confirm:

- migration shows a successful exit;
- Web, Scheduler, General Worker, Critical Worker, Bulk Worker, and Status Projector are healthy;
- integrated `opsknight-app` is not running;
- readiness succeeds directly and through public HTTPS;
- scheduler and role heartbeats are current;
- a synthetic incident advances critical/general work and status projection;
- the configured notification is delivered.

```sh
curl --fail --show-error \
  'http://127.0.0.1:3000/api/health?mode=readiness'
```

Open `/setup` only after readiness succeeds, then complete [Quickstart](../../../start/quickstart).

## Operate and scale it in production

Monitor each lane rather than only container health: queue depth, oldest age, throughput, retries, scheduler lag, status projection lag, database pools, and provider admission state.

Scale a supported worker only after identifying the bottleneck and recalculating database connections. Do not add Scheduler replicas or indiscriminately restart all roles to hide a provider or database bottleneck.

Save the exact ordered file list in the runbook and use it for logs, restart, pull, upgrade, and removal.

## Troubleshooting

**`opsknight-app` is also running:** the overlay was omitted or applied incorrectly. Stop the topology, inspect `config --services`, and restart only after integrated ownership is absent.

**Migration exits non-zero:** inspect migration logs, direct database DNS/TLS/credentials, required privileges, and migration compatibility. Keep all long-running roles stopped.

**One role stays unhealthy:** inspect only that role's logs and health response first. Check its role name, shared secrets, direct database route, and owned queue dependencies.

**Workers are healthy but jobs are late:** compare oldest-job age, throughput, provider throttling, and database saturation. Process health is not queue health.

**PostgreSQL has too many connections:** reduce replica or pool counts according to the budget, retain operator headroom, or add supported Web-only [PgBouncer](./pgbouncer).

## Remove or change the deployment

Use the same file list with `down` to preserve database volumes. Never append `--volumes` unless the explicit, backed-up intention is to destroy the bundled database.

To return to integrated mode, take a backup, stop every split owner, remove split containers, validate the base topology, and start integrated ownership. Never overlap the two models.

## Next steps

- [Add external PostgreSQL](./external-postgres)
- [Add PgBouncer](./pgbouncer)
- [Complete production acceptance](./production-checklist)

