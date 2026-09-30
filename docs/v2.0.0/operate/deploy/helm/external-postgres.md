---
title: Configure external PostgreSQL with Helm
description: Disable bundled PostgreSQL and connect Helm-managed OpsKnight roles to a TLS-protected external database.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Helm external PostgreSQL, database TLS]
reader:
  status: READER_COMPLETE
  task: Configure and validate external PostgreSQL in Helm.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/helm/opsknight/values.yaml, deploy/kubernetes/helm/opsknight/templates/]
---

# Configure external PostgreSQL with Helm

## Prerequisites

Provision a supported PostgreSQL database with backups/PITR, tested recovery, TLS, connection capacity, network access, and migration privileges. Read [Kubernetes database](../kubernetes/database).

## Prepare the configuration

Disable bundled PostgreSQL, store `DATABASE_URL` and `DIRECT_DATABASE_URL` in the existing Secret, and map them with `secrets.keys.databaseUrl` and `secrets.keys.directDatabaseUrl`. The migration Job and split runtime use the direct key for schema/index work; do not point it at transaction-mode PgBouncer. For a private CA, mount it into migration and every runtime role and use `verify-full` plus the matching `sslrootcert` path.

Configure NetworkPolicy/provider firewall and the chart connection ceiling. URI-encode credentials.

## Deploy the external database path

Lint/render and verify no bundled PostgreSQL StatefulSet/Service is produced. Confirm the migration hook uses the direct Secret key and CA mount, then install or upgrade.

## Verify the connection

Require migration success, workload readiness, TLS connections at the provider, and connection use below budget. Create and resolve a test incident, restart Web, and confirm persistence. Complete an isolated restore with matching stable secrets.

## Operate it in production

Monitor provider availability, failover, storage, replication, connections, slow queries, certificates, backup, and maintenance. Assign ownership for database alerts and planned changes.

## Troubleshooting

**No route/timeout:** inspect DNS, NetworkPolicy, firewall/allowlist, endpoint, and port from an equivalent Pod.

**TLS fails:** correct hostname, CA chain/mount, and URL parameters; do not disable verification.

**Migration permission denied:** grant only required schema privileges and keep workloads blocked until the hook succeeds.

## Change or undo external database use

Plan a quiesced or replicated cutover with backup, target validation, direct migration, acceptance, and a retained source rollback window. Do not toggle bundled PostgreSQL against a database containing divergent data.

## Next steps

- [Configure PgBouncer](./pgbouncer)
- [Install with Helm](./install)
