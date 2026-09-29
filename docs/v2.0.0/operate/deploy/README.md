---
title: Choose and deploy an OpsKnight topology
description: Select the supported OpsKnight deployment path and continue to a complete installation and production acceptance workflow.
type: concept
product_area: deployment
audience: [operator, administrator]
keywords: [deployment, Docker Compose, Kubernetes, Helm, Kustomize, Swarm]
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - deploy/compose/
    - deploy/kubernetes/
    - deploy/swarm/
---

# Choose and deploy an OpsKnight topology

Start here when installing OpsKnight. Choose one packaging path and one runtime topology, then keep that choice consistent for installation, upgrades, troubleshooting, and recovery.

## Choose how to run OpsKnight

| Requirement | Recommended path |
|---|---|
| Evaluation or one small server | [Docker Compose: integrated](./docker-compose/integrated) |
| One server with isolated workers | [Docker Compose: split](./docker-compose/split) |
| Kubernetes with packaged, schema-validated configuration | [Helm](./helm/) |
| Kubernetes with GitOps or owned overlays | [Kustomize](./kustomize/) |
| Docker across multiple manager/worker nodes | [Swarm](./swarm/) |
| Operator-managed production database | Use the selected path with [external PostgreSQL](./architecture/database-connections) |
| High web connection count | Use split runtime with [PgBouncer](./docker-compose/pgbouncer) |

Compose is a single-host orchestrator. Swarm and Kubernetes can reschedule workloads after a host failure, but availability still depends on database, ingress, storage, replica, and disruption design.

## Choose integrated or split runtime

- **Integrated** runs the web application and background responsibilities together. It is the least complex path for evaluation and smaller installations.
- **Split** runs Web, Scheduler, General Worker, Critical Worker, Bulk Worker, and Status Projector separately. Choose it when you need role-specific scaling, failure isolation, or Web-only pooling.

Read [Integrated versus split](./architecture/integrated-vs-split) before choosing. Do not run integrated and split ownership at the same time against one database.

## Choose the database path

- **Bundled PostgreSQL** is convenient, but the supplied deployment is not a highly available database service.
- **External PostgreSQL** is the normal production choice when another team or managed service owns availability, backups, upgrades, and failover.
- **PgBouncer** is supported for Web in split mode. Migration, scheduler, and worker roles retain direct PostgreSQL connections.

Read [Database connections](./architecture/database-connections) and calculate the [connection budget](../capacity/sizing) before setting replicas or pool sizes.

## Production acceptance applies to every path

Do not declare an installation ready because its process or Pod is running. Before accepting production traffic:

1. Pin the exact tested image digest.
2. Back up stable secrets independently from the database.
3. Complete database migration with exactly one owner.
4. Verify readiness through the public HTTPS origin.
5. Verify every selected runtime role and its heartbeat or queue progress.
6. Trigger a synthetic alert and complete acknowledgement and resolution.
7. Verify at least one real notification provider and any configured ChatOps destination.
8. Test a logical backup and isolated restore.
9. Record the deployment files, values, overlays, image digest, database endpoint class, and rollback decision.

The packaging-specific production checklist gives exact commands and expected results.

## Related guides

- [Runtime roles](./architecture/runtime-roles)
- [Production sizing](../capacity/sizing)
- [Health and metrics](../reliability/health-and-metrics)
- [Backup and restore](../data/backup-and-restore)
- [Upgrade](../upgrades/upgrade)
- [Rollback](../upgrades/rollback)

