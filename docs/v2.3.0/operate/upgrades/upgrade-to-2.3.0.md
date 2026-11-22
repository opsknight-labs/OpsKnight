---
title: Upgrade to OpsKnight 2.3.0
description: What changes when you upgrade from 2.2.x to 2.3.0 (Node.js 22 and Prisma 7.3.0 on the node-postgres driver), how to check your database connections first, apply the upgrade, and recover from a failed migration.
type: deployment
product_area: upgrades
audience: [operator, administrator]
keywords: [upgrade to 2.3.0, 2.3.0 upgrade notes, Prisma 7 upgrade, Node.js 22, sslmode verify-full, database TLS]
reader:
  status: READER_COMPLETE
  task: Prepare, apply, verify, and if necessary recover an upgrade from OpsKnight 2.2.x to 2.3.0.
verification:
  level: source
  verified_at: 2026-11-22
  evidence:
    - package.json
    - prisma.config.ts
    - src/lib/db/create-client.ts
    - src/lib/db/pg-config.ts
    - src/lib/db/raw-parameter-types.ts
    - scripts/db/check-connection.cjs
    - deploy/kubernetes/helm/opsknight/templates/migration-job.yaml
    - Dockerfile
---
# Upgrade to OpsKnight 2.3.0
This page covers what is different about the 2.2.x to 2.3.0 upgrade. Follow it together with the
general [upgrade runbook](./upgrade), and keep the [rollback runbook](./rollback) open during the change.
## What changes in 2.3.0
- **Prisma 5.22 to Prisma 7.3.0.** The database layer now runs on the `node-postgres` (`pg`) driver
  through Prisma's driver adapter. Your existing `DATABASE_URL`, `DIRECT_DATABASE_URL`,
  `WEB_DATABASE_URL`, and `MCP_DATABASE_URL` values keep working, and the Prisma URL parameters
  (`connection_limit`, `pool_timeout`, `connect_timeout`, `schema`, `options`, `pgbouncer`, and the
  `ssl*` parameters) keep their meaning. The schema is unchanged and the data is not rewritten.
- **Node.js 22 LTS** replaces Node.js 20. The image is `node:22-alpine`. Anything you run outside the
  image (scripts, CI, local development) needs Node.js 22.12 or newer within 22.x.
- **Prisma is pinned exactly** (`prisma`, `@prisma/client`, `@prisma/adapter-pg`,
  `@prisma/driver-adapter-utils` at 7.3.0). Do not float these versions.
## Behaviour changes to prepare for
### Database TLS now verifies certificates
Earlier releases treated `sslmode=verify-ca` and `sslmode=verify-full` like `prefer`: the certificate
was never verified and the connection could fall back to plaintext. 2.3.0 applies libpq semantics:

| `sslmode` | 2.3.0 behaviour |
| --- | --- |
| `disable` | No TLS. |
| `allow` / `prefer` | Negotiated like libpq; the certificate is not verified. |
| `require` | TLS, certificate not verified unless `sslrootcert` is set. |
| `verify-ca` / `verify-full` | TLS with a verified certificate (and host name for `verify-full`). **Needs the CA**: set `sslrootcert=/path/ca.crt`, or `NODE_EXTRA_CA_CERTS`. |
| anything else | Configuration error; the connection fails closed. |

A deployment that already says `verify-full` but never supplied a CA worked before by accident and
**will fail to connect after the upgrade**. Run the connection check below before you upgrade.
### Sessions run in UTC
Every connection sets `TimeZone=UTC`. Results are now identical on servers whose default time zone is
not UTC (Prisma 5 could miss rows or shift raw-SQL writes by the offset). No action is needed.
### Failed connections are retried consistently
Every connection failure now carries a code, and a first-connection failure during a database outage is
classified retryable, like later outages. Escalation steps retry instead of failing permanently.
## Prerequisites
- You run OpsKnight 2.2.x. From earlier versions, upgrade to 2.2.x first.
- A restored-and-verified backup with the matching encryption keys and secrets.
- The previous image digest and its full configuration.
- A maintenance window: the application is stopped while migrations run.
## Check database connections before upgrading
Run the new image with your **existing** configuration. It connects every configured database URL
with 2.3.0's TLS rules, and reports encryption, certificate verification, and a hint when something
would fail (for example a missing `sslrootcert`). It never prints credentials.
```bash
docker run --rm --env-file opsknight.env [-v /path/ca.crt:/path/ca.crt:ro] \
  ghcr.io/opsknight-labs/opsknight:2.3.0 node scripts/db/check-connection.cjs
```
It exits `1` if any configured URL cannot connect. Fix the URL or mount the CA, and rerun until it exits `0`.
## Apply the upgrade
Follow the [upgrade runbook](./upgrade) for your topology (Compose, Kubernetes/Helm/Kustomize, Swarm).
The image runs `prisma migrate deploy` through `prisma.config.ts`, the same migration ownership as
before: one migration owner (the Helm migration Job, or the single migration container), never every
replica.
Migrations stay atomic: the pinned Prisma 7.3.0 CLI applies each migration file in one transaction,
as 2.2.x did, so a failed migration leaves no partial changes. If one fails, follow
[migration fails](../../troubleshooting/upgrades/migration-fails) and run `npm run prisma:health`;
never edit `_prisma_migrations` or run `prisma db push`.
**Do not upgrade the Prisma CLI past 7.3.0 on your own.** From 7.4.0 the CLI applies migration
statements one at a time (prisma/orm#30640), which breaks the migration history on a fresh database
(a temporary table created `ON COMMIT DROP`) and makes failed migrations non-atomic. OpsKnight raises
the pin only after its migrations are certified against the newer CLI.

## Verify
1. `GET /api/health` reports healthy on every runtime role, and `/api/health/deep` confirms the database path.
2. `npm run prisma:validate` and `npm run prisma:health` pass against the upgraded database.
3. The logs contain no `db.config.warning` or `db.config.invalid` events. These name a URL setting that
   2.3.0 ignored or rejected, with the target (never the password).
4. Send a synthetic alert and confirm the incident, notification, and acknowledgement path end to end.
## Roll back
Prisma 7 does not change the schema, but 2.3.0 includes forward migrations; use the
[rollback runbook](./rollback). 
## Known limits
- Prisma is held at 7.3.0 on purpose (see above). Newer 7.x releases and Prisma 8 (a release candidate when 2.3.0 was cut) are separate, certified changes.
- The `$metrics` client API no longer exists in Prisma 7. OpsKnight's pool-pressure checks read the
  `pg` pool's waiting-connection count instead, and they report "unknown" (never zero) for clients it
  did not create.
