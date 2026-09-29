---
title: Configure PostgreSQL for Kubernetes
description: Choose bundled or external PostgreSQL, configure direct and pooled URLs, and validate TLS, storage, migrations, and recovery.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Kubernetes PostgreSQL, external database, PVC, PgBouncer]
reader:
  status: READER_COMPLETE
  task: Configure and validate PostgreSQL for Kubernetes OpsKnight.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/helm/opsknight/, deploy/kubernetes/kustomize/base/postgres-statefulset.yaml]
---

# Configure PostgreSQL for Kubernetes

## Prerequisites

Read [Database connections](../architecture/database-connections) and calculate the aggregate connection budget. Decide who owns availability, backup, failover, upgrades, and restore.

## Prepare the database

The bundled PostgreSQL asset is a single StatefulSet with persistent storage; it is not database HA. Select an encrypted StorageClass, size the PVC/resources, define expansion behavior, and establish logical backups.

For external PostgreSQL, create a supported database and least-privilege role, require TLS, allow workload-network access, and mount any private CA into migration and runtime Pods. Use `verify-full` with the correct certificate hostname where available.

## Configure connection paths

Set `DATABASE_URL` and `DIRECT_DATABASE_URL`; add `WEB_DATABASE_URL` only for supported split PgBouncer. Migration and non-Web roles use the direct path. Web may use transaction pooling.

Render manifests and check URL sources, Secret references, CA mounts, pool sizes, and NetworkPolicy destinations without exposing values.

## Deploy and migrate

Helm can create the pre-install/pre-upgrade migration Job. Kustomize requires the operator to run a one-shot migration Job before updating workloads. Require direct connectivity and completion:

```sh
kubectl -n opsknight wait --for=condition=complete job/<migration-job> --timeout=15m
kubectl -n opsknight logs job/<migration-job>
```

Do not start or replace application workloads after a failed migration.

## Verify database health

For bundled PostgreSQL:

```sh
kubectl -n opsknight get statefulset,pod,pvc -l app=opsknight-postgres
kubectl -n opsknight exec statefulset/opsknight-postgres -- pg_isready -U opsknight
```

For external PostgreSQL, verify TLS identity, active connections by role, migration completion, readiness, and a create/read/update incident workflow. Complete an isolated restore test.

## Production and security considerations

Do not expose PostgreSQL publicly. Narrow egress to the actual database destination, reserve operational connection headroom, monitor storage/replication/connections/slow queries/certificate expiry, and keep database plus stable-secret backups in separate failure domains.

## Troubleshooting

**PVC Pending:** inspect StorageClass existence, topology constraints, quota, and provisioner events. Do not delete a bound production claim to retry scheduling.

**Connection timeout:** inspect DNS, NetworkPolicy, firewall, Service/endpoints, and provider allowlists from a Pod subject to equivalent policy.

**TLS verification fails:** correct hostname, CA chain, mount path, and `sslrootcert`; do not disable verification as the final fix.

**Migration permission denied:** grant the release-required schema privileges to the migration owner and keep workloads stopped until success.

## Change or recover the database

Use [Backup and restore](../../data/backup-and-restore) for recovery. Endpoint migration requires a quiesced/replicated cutover, direct migration validation, acceptance testing, and a retained rollback source.

## Next steps

- [Configure NetworkPolicy](./network-policy)
- [Install integrated runtime](./integrated)
- [Install split runtime](./split)

