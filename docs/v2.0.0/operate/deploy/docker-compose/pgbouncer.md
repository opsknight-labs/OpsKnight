---
title: Add PgBouncer to split Compose
description: Route split-runtime Web traffic through PgBouncer while preserving direct database paths for migration and background roles.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [PgBouncer, transaction pooling, Compose split]
reader:
  status: READER_COMPLETE
  task: Add and validate Web-only PgBouncer pooling in split Compose.
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - deploy/compose/docker-compose.pgbouncer.yml
    - deploy/compose/docker-compose.pgbouncer-ca.yml
    - deploy/scripts/validate-runtime-capacity.cjs
---

# Add PgBouncer to split Compose

The maintained overlay sends Web through transaction pooling at `opsknight-pgbouncer:6432`. Migration, Scheduler, workers, and Status Projector retain direct PostgreSQL connections.

## Prerequisites

Install and verify [split Compose](./split). Calculate the direct and pooled [connection budget](../architecture/database-connections). PgBouncer is not supported as a shortcut for integrated-mode scaling or migration traffic.

## Prepare PgBouncer

For bundled PostgreSQL, set explicit pool limits:

```dotenv
PGBOUNCER_ENABLED=true
PGBOUNCER_DEFAULT_POOL_SIZE=10
PGBOUNCER_RESERVE_POOL_SIZE=5
PGBOUNCER_MAX_CLIENT_CONN=1000
```

For external PostgreSQL, also set the structured host, database, user, and password values required by PgBouncer even when OpsKnight has a complete URI.

For a private CA:

```dotenv
PGBOUNCER_TLS_CA_CERT=/etc/opsknight/db-ca.crt
PGBOUNCER_SERVER_TLS_SSLMODE=verify-full
PGBOUNCER_SERVER_TLS_CA_FILE=/etc/ssl/certs/custom-ca.crt
```

Direct Prisma URLs must independently include `sslmode=verify-full` and the mounted `sslrootcert` path.

## Deploy the pooling overlay

Validate capacity first, then keep PgBouncer after the split overlay:

```sh
node deploy/scripts/validate-runtime-capacity.cjs
docker compose \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.split.yml \
  -f deploy/compose/docker-compose.pgbouncer.yml \
  config --quiet
docker compose \
  -f deploy/compose/docker-compose.yml \
  -f deploy/compose/docker-compose.split.yml \
  -f deploy/compose/docker-compose.pgbouncer.yml \
  up -d --wait
```

When using external PostgreSQL or a CA overlay, add those files in the documented deployment order and preserve that exact list.

## Verify connection routing

Confirm `opsknight-pgbouncer` and Web are healthy. Inspect the resolved, protected configuration: Web's URL must target port `6432` and include the PgBouncer compatibility parameter; migration and non-Web roles must not target `6432`.

Require the migration service to complete over the direct path. Then call readiness and run a test incident through create, acknowledge, notification, and resolve. At PgBouncer and PostgreSQL, verify client/server pool activity stays within the planned ceilings.

## Operate it in production

Alert on client wait, server-pool saturation, authentication/TLS failures, PgBouncer restarts, direct database saturation, and Web readiness. Retain direct database reserve for migration, workers, monitoring, and emergency administration.

## Troubleshooting

**PgBouncer is unhealthy:** verify structured host/database/user/password values, DNS, provider allowlists, TLS mode, and CA mount.

**Migration fails only with pooling enabled:** migration is incorrectly receiving the pooled URL. Restore `DIRECT_DATABASE_URL` and migration routing to PostgreSQL port `5432`.

**Web waits for connections:** inspect client wait and server-pool use. Increasing `MAX_CLIENT_CONN` cannot create database capacity; adjust backend pool, Web demand, or database capacity deliberately.

**TLS works for Web but not workers:** pooled and direct paths have separate TLS configuration. Validate CA mounts and `sslrootcert` for every direct role.

## Remove PgBouncer

During a controlled change, point Web back to the direct database URL, validate the resulting aggregate connection budget, recreate Web, and verify readiness and incident behavior before removing the PgBouncer service. Do not remove it first and leave Web targeting port `6432`.

## Next steps

- [Configure the reverse proxy](./reverse-proxy)
- [Troubleshoot Compose](./troubleshooting)
- [Complete production acceptance](./production-checklist)

