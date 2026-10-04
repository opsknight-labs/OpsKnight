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

## Start with the closest workload shape

| Current planning shape | Starting architecture to evaluate |
|---|---|
| Small — about 40 users and 12 services | [Integrated Compose](./docker-compose/integrated) when one host and no HA are acceptable |
| Medium — about 120 users and 32 services | [Split Compose](./docker-compose/split), or [Helm Split](./helm/) when Kubernetes or HA is required |
| Large — about 400 users and 80 services | Helm/Kustomize Split with PgBouncer and external PostgreSQL |
| Storm — about 1,000 users and 200 services | Multi-replica Split, PgBouncer, external HA PostgreSQL, and workload-specific certification |

> These are starting architectures derived from current test-data shapes, not
> certified user limits. User count alone cannot size OpsKnight: alert bursts,
> notification fanout, simultaneous responders, SSE sessions, status-page
> subscribers, provider quotas, availability requirements, and the PostgreSQL
> connection budget can change the answer.

Use the full [Deployment Planner](../capacity/choose-deployment) to compare all
dimensions, then review the [historical benchmark results](../capacity/benchmark-results)
without treating an observed peak as supported capacity.

## Follow the complete installation journey

Every supported packaging path has the same control points. Do not skip ahead when a Pod or container becomes healthy:

1. Choose the package and integrated or split topology.
2. Provision PostgreSQL, calculate connections, and establish backup/restore ownership.
3. Generate and protect stable secrets; pin the tested image digest.
4. Create public DNS and TLS, then align the ingress/proxy host, `NEXTAUTH_URL`, and `NEXT_PUBLIC_APP_URL`.
5. Implement the [reverse-proxy contract](./reverse-proxy-contract).
6. Run migration once through a direct database connection, then deploy workloads.
7. Require readiness through the public HTTPS origin.
8. Open public `/setup`, verify the detected Application URL, and [create the first administrator](../../start/initial-setup).
9. Sign in through the same hostname and confirm **Settings → System → App URL**.
10. Run domain, authentication, webhook, realtime, incident, notification, backup, and restore acceptance tests.

When a runbook contains host, Docker, Systemd, Kubernetes, or Bash steps, also deploy a separately constrained [Runbook Agent](./agent-operations). The Runbook Worker alone does not execute those actions.

Read [Application URL and host routing](./application-url-and-host-routing) before exposing any production installation. A wrong canonical host can cause HTTP 421 after bootstrap.

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
- **Split** runs Web, Scheduler, General Worker, Critical Worker, Bulk Worker, Runbook Worker, and Status Projector separately. Choose it when you need role-specific scaling, failure isolation, or Web-only pooling.

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
5. Complete `/setup` through that origin and verify the saved Application URL.
6. Verify every selected runtime role and its heartbeat or queue progress.
7. Trigger a synthetic alert and complete acknowledgement and resolution.
8. Verify at least one real notification provider and any configured ChatOps destination.
9. Test a logical backup and isolated restore.
10. Record the deployment files, values, overlays, image digest, database endpoint class, and rollback decision.

The packaging-specific production checklist gives exact commands and expected results.

## Related guides

- [Runtime roles](./architecture/runtime-roles)
- [Runbook Agent operations](./agent-operations)
- [Application URL and host routing](./application-url-and-host-routing)
- [Reverse-proxy contract](./reverse-proxy-contract)
- [Initial setup](../../start/initial-setup)
- [Production sizing](../capacity/sizing)
- [Health and metrics](../reliability/health-and-metrics)
- [Backup and restore](../data/backup-and-restore)
- [Upgrade](../upgrades/upgrade)
- [Rollback](../upgrades/rollback)
