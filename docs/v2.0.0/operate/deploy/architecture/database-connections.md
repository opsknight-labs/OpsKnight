---
title: Plan OpsKnight database connections
description: Configure direct and pooled PostgreSQL paths safely for migrations, web traffic, workers, and external databases.
type: concept
product_area: deployment
audience: [operator, administrator]
keywords: [PostgreSQL, DATABASE_URL, DIRECT_DATABASE_URL, PgBouncer, TLS]
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - prisma/schema.prisma
    - deploy/compose/docker-compose.pgbouncer.yml
    - deploy/scripts/validate-runtime-capacity.cjs
---

# Plan OpsKnight database connections

OpsKnight needs a direct PostgreSQL path for migrations and non-Web responsibilities. Split deployments can additionally give Web a transaction-pooled PgBouncer path.

## Connection variables

- `DATABASE_URL` is the normal application database URL.
- `DIRECT_DATABASE_URL` bypasses transaction pooling and is required wherever direct PostgreSQL behavior is needed.
- `WEB_DATABASE_URL` is the optional Web-only endpoint used by supported split/PgBouncer deployment assets.

Packaging maps these values into roles differently. Inspect the rendered Compose configuration or Kubernetes manifests rather than assuming every container receives the same URL.

## Direct versus pooled paths

Migration, Scheduler, General Worker, Critical Worker, Bulk Worker, and Status Projector use direct PostgreSQL connections. Web can use PgBouncer in split mode. Do not route Prisma migrations through transaction pooling.

A representative direct external URL is:

```text
postgresql://opsknight:<encoded-password>@db.example.com:5432/opsknight_db?sslmode=verify-full&sslrootcert=/etc/opsknight/db-ca.crt&connection_limit=10&pool_timeout=30
```

URI-encode reserved characters in credentials. Mount a private CA at the exact container path named by `sslrootcert`. `NODE_EXTRA_CA_CERTS` alone does not configure Prisma's native PostgreSQL TLS connection.

## Calculate the budget

Add the maximum pool for every replica of every role, migration/administration headroom, monitoring clients, and failover overlap. Compare the total with the database service's usable connection limit. Do not allocate the provider's entire hard maximum; PostgreSQL and operational access need reserve capacity.

Use [Production sizing](../../capacity/sizing) and run the checked-in capacity validator where the packaging supports it:

```sh
node deploy/scripts/validate-runtime-capacity.cjs
```

## External PostgreSQL requirements

Before deployment, verify:

1. DNS resolves from the actual workload network.
2. TLS validates the database hostname and trusted CA.
3. The application role can connect to the intended database and schema.
4. The migration owner has the privileges required by the release migration.
5. Firewall or NetworkPolicy permits every selected runtime role.
6. Backup, point-in-time recovery, maintenance, failover, and connection limits are known.
7. A restore has been tested in an isolated database.

Never use a production database to test an unreviewed deployment manifest.

## PgBouncer boundary

PgBouncer is a Web scaling tool, not a way to ignore the database budget. Transaction pooling reduces persistent backend connections for Web clients but adds its own saturation and failure signals. Monitor client wait, server pool use, authentication failures, and database reachability.

## Secret and recovery boundary

Database backups do not preserve application secrets. Back up `ENCRYPTION_KEY`, authentication/API secrets, database credentials, and private CA material separately. Restored encrypted provider credentials are unusable without the matching encryption key.

## Related guides

- [Compose external PostgreSQL](../docker-compose/external-postgres)
- [Compose PgBouncer](../docker-compose/pgbouncer)
- [Backup and restore](../../data/backup-and-restore)
- [Database migrations](../../upgrades/database-migrations)

