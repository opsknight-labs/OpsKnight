---
title: Connect Compose to external PostgreSQL
description: Replace bundled PostgreSQL with a TLS-protected operator-managed database and verify direct OpsKnight connectivity.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [external PostgreSQL, Compose, database TLS]
reader:
  status: READER_COMPLETE
  task: Configure and validate external PostgreSQL for a Compose deployment.
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - deploy/compose/docker-compose.external-db.yml
    - deploy/compose/docker-compose.pgbouncer-ca.yml
---

# Connect Compose to external PostgreSQL

This overlay disables bundled PostgreSQL and points OpsKnight at a database owned outside the Compose project.

## Prerequisites

Complete the database provider's PostgreSQL creation, availability, backup, and recovery setup. Obtain the hostname, port, database name, application role, password, TLS mode, and private CA when applicable. Read [Database connections](../architecture/database-connections).

The database must be isolated from any production deployment while you validate a new installation. Confirm the release's supported PostgreSQL version and migration privileges.

## Prepare the database configuration

URI-encode reserved characters in credentials. Set direct URLs in `.env`:

```dotenv
OPSKNIGHT_DATABASE_URL=postgresql://opsknight:<encoded-password>@db.example.com:5432/opsknight_db?sslmode=require&connection_limit=40&pool_timeout=30
DIRECT_DATABASE_URL=postgresql://opsknight:<encoded-password>@db.example.com:5432/opsknight_db?sslmode=require&connection_limit=40&pool_timeout=30
```

For a private CA, use `sslmode=verify-full` and mount the CA at the container path named by `sslrootcert`. Verify that the certificate covers `db.example.com`. Do not weaken certificate verification to solve a hostname or CA error.

## Deploy with the overlay

Add the external database overlay after the base file and before any later split/PgBouncer-specific overlay required by that topology:

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

For split mode, include `docker-compose.split.yml` in the documented order for the deployment and use the identical list for every subsequent command.

## Verify the database path

Run `docker compose ... ps -a`. No `opsknight-db` container should be active. The migration owner must finish successfully and readiness must pass:

```sh
curl --fail --show-error \
  'http://127.0.0.1:3000/api/health?mode=readiness'
```

At the database service, verify connections originate from the intended host, use TLS, and remain below the reserved budget. Create and resolve a test incident, then confirm the data is present through the application after a controlled application restart.

## Operate it in production

Monitor provider database availability, storage, replication/failover, connection use, slow queries, certificate expiry, and backup/PITR status. Record who owns each alert and maintenance window. Rehearse an isolated restore with the same OpsKnight secrets.

## Troubleshooting

**DNS or timeout:** test resolution and TCP reachability from a disposable container on the same Compose network; check provider firewall rules and routing.

**Certificate verification fails:** compare hostname, SAN, mounted CA chain, container path, and `sslrootcert`. Do not substitute `NODE_EXTRA_CA_CERTS` for the PostgreSQL TLS parameters.

**Authentication fails:** verify the database, role, password encoding, source allowlist, and password rotation state.

**Migration lacks privileges:** grant only the schema privileges required by the release migration, rerun the migration owner, and remove temporary elevated privileges if your operating model requires it.

## Change or remove external PostgreSQL

Never switch endpoints without a migration and cutover plan. Quiesce writes, take and verify a source backup, restore or replicate to the target, validate secrets/TLS, complete migration, and run acceptance tests before reopening traffic. Keep the source recoverable until the rollback window closes.

## Next steps

- [Add PgBouncer to split mode](./pgbouncer)
- [Back up and restore](../../data/backup-and-restore)
- [Complete production acceptance](./production-checklist)

