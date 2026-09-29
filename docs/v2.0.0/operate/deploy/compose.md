---
title: Deploy and operate with Docker Compose
description: Install, secure, operate, upgrade, and troubleshoot integrated or split OpsKnight Compose deployments.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Docker Compose, split runtime, PgBouncer, external PostgreSQL, backup, upgrade]
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - deploy/compose/docker-compose.yml
    - deploy/compose/docker-compose.split.yml
    - deploy/compose/docker-compose.pgbouncer.yml
    - deploy/compose/docker-compose.external-db.yml
    - deploy/compose/docker-compose.pgbouncer-ca.yml
    - deploy/scripts/validate-runtime-capacity.cjs
---

# Deploy and operate with Docker Compose

The checked-in Compose files support a single-host integrated runtime, isolated split roles, optional PgBouncer, and bundled or external PostgreSQL. Keep the files layered as documented so upgrades receive upstream changes.

## Choose a topology

- **Integrated + bundled PostgreSQL:** `opsknight-app` owns web traffic and background work; `opsknight-db` stores data. Simplest evaluation and small-host topology.
- **Integrated + external PostgreSQL:** same application ownership with an operator-managed database.
- **Split:** a one-shot migration owner plus Web, Scheduler, General Worker, Critical Worker, Bulk Worker, and Status Projector. Use when failure isolation and role-specific scaling matter.
- **Split + PgBouncer:** only Web uses transaction pooling; migrations, scheduler, and workers retain direct PostgreSQL connections.

Compose is still a single-host orchestrator. It does not provide multi-node rescheduling. Use [Swarm](./swarm), [Helm](./helm), or [Kustomize](./kustomize) when host failure must be tolerated automatically.

## Host and network prerequisites

Install Docker Engine and Compose v2. Provide enough memory, CPU, disk IOPS, and PostgreSQL connections for the chosen roles. Reserve host port `3000` for the web application and, with the bundled database, loopback port `5432` unless overridden.

Allow outbound HTTPS and provider-specific traffic for email, ChatOps, paging, OIDC, SCIM, Jira, and webhooks. Expose the web port only through a TLS reverse proxy in production. PostgreSQL is bound to `127.0.0.1` by default and should not be published publicly.

## Prepare `.env`

From the repository root:

```sh
cp env.example .env
chmod 600 .env
```

Set explicit production values:

```dotenv
OPSKNIGHT_IMAGE=ghcr.io/opsknight-labs/opsknight@sha256:<tested-release-digest>
OPSKNIGHT_PULL_POLICY=always

NEXTAUTH_URL=https://opsknight.example.com
NEXT_PUBLIC_APP_URL=https://opsknight.example.com
NEXTAUTH_SECRET=<random-base64-secret>
API_KEY_SECRET=<separate-random-base64-secret>
ENCRYPTION_KEY=<64-hex-character-key>

POSTGRES_USER=opsknight
POSTGRES_PASSWORD=<unique-database-password>
POSTGRES_DB=opsknight_db
POSTGRES_PORT=5432
APP_PORT=3000
```

Generate secrets with `openssl rand -base64 32` and the encryption key with `openssl rand -hex 32`. Keep `ENCRYPTION_KEY`, `NEXTAUTH_SECRET`, and `API_KEY_SECRET` stable across every role, restart, upgrade, and restore. Losing the encryption key makes stored provider credentials unreadable. Changing authentication secrets invalidates sessions or API credentials.

Do not use the base file's compatibility image default for 2.0. Split mode refuses to start without an explicit image that supports split roles.

Validate the resolved configuration before starting it:

```sh
docker compose -f deploy/compose/docker-compose.yml config --quiet
docker compose -f deploy/compose/docker-compose.yml config --images
```

Review the rendered output for placeholder secrets, unexpected ports, and the exact image digest. Remember that `docker compose config` can print expanded secrets; protect its output.

## Integrated installation with bundled PostgreSQL

```sh
docker compose -f deploy/compose/docker-compose.yml pull
docker compose -f deploy/compose/docker-compose.yml up -d --wait
docker compose -f deploy/compose/docker-compose.yml ps
```

The named volume `opsknight_postgres_data` persists database files. The application waits for PostgreSQL health and uses its integrated startup migration path. Do not start multiple integrated application containers as a substitute for split mode: each would also own background processing.

Verify readiness:

```sh
curl --fail --show-error \
  'http://127.0.0.1:3000/api/health?mode=readiness'
```

Then open `/setup` to create the first administrator. See [Quickstart](../../start/quickstart) for the first-user workflow.

## Integrated installation with external PostgreSQL

Create the database and a least-privilege application role according to your PostgreSQL service's procedure. Encode reserved characters in URI credentials and require TLS:

```dotenv
OPSKNIGHT_DATABASE_URL=postgresql://opsknight:<encoded-password>@db.example.com:5432/opsknight_db?sslmode=require&connection_limit=40&pool_timeout=30
DIRECT_DATABASE_URL=postgresql://opsknight:<encoded-password>@db.example.com:5432/opsknight_db?sslmode=require&connection_limit=40&pool_timeout=30
```

Start with the external database overlay, which disables the bundled database:

```sh
docker compose \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.external-db.yml \
  config --quiet

docker compose \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.external-db.yml \
  up -d --wait
```

Confirm no `opsknight-db` container is running and verify readiness. Never point a trial deployment at a production database.

## Split-runtime installation

Split mode disables `opsknight-app`. `opsknight-migration` runs once; all six long-running roles wait for it to exit successfully and set `OPSKNIGHT_SKIP_MIGRATIONS=true`.

Validate capacity and render the effective topology:

```sh
node deploy/scripts/validate-runtime-capacity.cjs

docker compose \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.split.yml \
  config --quiet
```

Start it:

```sh
docker compose \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.split.yml \
  pull

docker compose \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.split.yml \
  up -d --wait
```

Check migration and role ownership:

```sh
docker compose \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.split.yml \
  ps -a
```

`opsknight-migration` must show a successful exit. Web, Scheduler, General Worker, Critical Worker, Bulk Worker, and Status Projector must be healthy. `opsknight-app` must not be running.

See [Split runtime](./split-runtime) for lane ownership and failure effects. Scale only a constrained scalable worker after checking the [connection budget](../capacity/sizing); do not create duplicate scheduler ownership casually.

## Add PgBouncer

PgBouncer is supported with split mode. The overlay routes Web's `DATABASE_URL` through transaction pooling at `opsknight-pgbouncer:6432`. `DIRECT_DATABASE_URL` remains the direct endpoint used by migration and non-web roles.

For the bundled database:

```dotenv
PGBOUNCER_ENABLED=true
PGBOUNCER_DEFAULT_POOL_SIZE=10
PGBOUNCER_RESERVE_POOL_SIZE=5
PGBOUNCER_MAX_CLIENT_CONN=1000
```

```sh
node deploy/scripts/validate-runtime-capacity.cjs
docker compose \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.split.yml \
  -f deploy/compose/docker-compose.pgbouncer.yml \
  up -d --wait
```

Do not send Prisma migrations through transaction pooling. Confirm `opsknight-pgbouncer` is healthy and Web's resolved `DATABASE_URL` contains `pgbouncer=true`, while `DIRECT_DATABASE_URL` does not point to port `6432`.

For an external database, add `docker-compose.external-db.yml` and set `OPSKNIGHT_DATABASE_URL`, `DIRECT_DATABASE_URL`, `EXTERNAL_DB_HOST`, `EXTERNAL_DB_PASSWORD`, and the corresponding database/user values. PgBouncer needs structured host and credential values even when the application also has a complete URI.

## Use a private database CA

Set the CA to an absolute host path:

```dotenv
PGBOUNCER_TLS_CA_CERT=/etc/opsknight/db-ca.crt
PGBOUNCER_SERVER_TLS_SSLMODE=verify-full
PGBOUNCER_SERVER_TLS_CA_FILE=/etc/ssl/certs/custom-ca.crt
```

Add `docker-compose.pgbouncer-ca.yml` last. Direct Prisma connections must include `sslmode=verify-full&sslrootcert=/etc/ssl/certs/custom-ca.crt` in `OPSKNIGHT_DATABASE_URL` or `DIRECT_DATABASE_URL`; `NODE_EXTRA_CA_CERTS` alone does not configure Prisma's native database TLS stack.

## Reverse proxy and TLS

Terminate HTTPS at a trusted proxy and forward to `127.0.0.1:${APP_PORT}`. Preserve `Host`, `X-Forwarded-Proto`, and client-address forwarding according to `TRUSTED_PROXY_HOPS`. Set both public URL variables to the exact external origin, without an internal hostname.

Do not buffer or prematurely time out server-sent event responses. Allow webhook request bodies up to the documented integration limit and preserve provider signature headers byte-for-byte. Test sign-in callbacks, live incident updates, inbound webhooks, and status-page access through the public hostname—not only through localhost.

## Routine operations

Use the same ordered `-f` arguments for every command. Save the selected file list in the operator runbook to avoid accidentally launching integrated and split owners together.

```sh
docker compose <files> ps
docker compose <files> logs --since=30m opsknight-web
docker compose <files> restart opsknight-general-worker
docker compose <files> pull
```

Monitor readiness, role health, queue age/depth, provider failures, PostgreSQL connections, disk usage, and PgBouncer saturation. A healthy container process is not proof that its queue is draining.

## Backup and restore

Back up PostgreSQL logically and record the exact image digest and configuration. Back up all stable secrets separately. The named volume is persistence, not a backup: host or volume loss removes it.

Follow [Backup and restore](../data/backup-and-restore) for `pg_dump`/`pg_restore`, external-database variants, encryption-key dependencies, and post-restore tests. Rehearse restore into an isolated database before accepting production traffic.

## Upgrade

1. Read release notes and database-migration requirements.
2. Record `docker compose <files> config --images` and take a verified backup.
3. Pin the new immutable digest in `.env` and run `config --quiet` plus the capacity validator.
4. Pull the image.
5. In split mode, run the migration service and require successful completion before replacing long-running roles. In integrated mode, update the application only after the backup is complete.
6. Start the stack and wait for readiness.
7. Verify every role, run a synthetic incident and notification, and observe a soak period.

Use the exact procedure in [Upgrade](../upgrades/upgrade). Application rollback does not reverse PostgreSQL migrations; consult [Rollback](../upgrades/rollback) before changing the image back.

## Stop and remove

```sh
docker compose <files> down
```

This preserves the named database volume. `down --volumes` destroys bundled PostgreSQL data and must never be used as routine cleanup.

## Troubleshooting

**Migration exits non-zero:** keep Web and workers stopped. Inspect `docker compose <files> logs opsknight-migration`, verify direct database connectivity and privileges, then use [Migration troubleshooting](../../troubleshooting/upgrades/migration-fails).

**Readiness remains unhealthy:** inspect the affected role and database logs, then call the readiness endpoint directly. Check public URLs, secrets, schema state, database reachability, and required role heartbeats.

**Split stack also starts `opsknight-app`:** the overlay was omitted or files were passed in the wrong order. Run `docker compose <files> config --services`; only split services should own runtime work.

**PostgreSQL reports too many connections:** calculate every replica's pool budget, reduce role pool sizes or replica counts, and add supported PgBouncer pooling for Web. Do not route migrations through transaction pooling.

**PgBouncer is unhealthy:** check its structured host, database, user and password values; confirm the database accepts its source address and TLS mode; then run a `SELECT 1` through port `6432` from the Compose network.

**Authentication redirects to localhost or HTTP:** correct both public URL variables, confirm forwarded protocol/host headers, and restart Web or the integrated application.

**Incidents update only after refresh:** disable proxy buffering for server-sent events and increase idle timeouts.

**Workers are healthy but work is delayed:** inspect lane-specific backlog and provider admission state. Restarting all roles can hide the signal without correcting capacity or provider throttling.

## Production acceptance checklist

- Image and PgBouncer images are pinned; no `latest` tag is used.
- Placeholder secrets are absent and stable secrets are backed up.
- TLS, public URLs, proxy trust, SSE, and inbound signature headers are verified.
- Exactly one intended ownership model is running: integrated or split.
- Migration ownership and direct database routing are verified.
- Persistent storage, logical backup, isolated restore, and rollback decisions are rehearsed.
- Readiness, metrics, queues, providers, PostgreSQL, disk, and role health are monitored.
- A synthetic alert completes ingestion, paging, acknowledgement, resolution, and status projection.
