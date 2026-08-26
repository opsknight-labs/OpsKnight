---
order: 6
title: Deployment
description: Choose and operate the Compose, Kubernetes/Kustomize, or Helm deployment supplied with OpsKnight v1.5.
---

# Deployment

OpsKnight v1.5 supports two Kubernetes runtime models: a backward-compatible integrated runtime and a split runtime that runs web, worker, and scheduler responsibilities independently.

**For new production Kubernetes deployments, OpsKnight recommends split mode.** It provides independent scaling, clearer failure isolation, smaller per-role database pools, and a web HPA that scales from 2 to 12 replicas by default. Integrated mode remains the chart default for upgrade and backward compatibility.

## Choose a packaging path

| Path | Use when | Important boundary |
| --- | --- | --- |
| [Docker Compose](./docker) | Evaluation, development, or a deliberate single-host installation. | One host and one PostgreSQL container are not highly available. |
| [Kubernetes/Kustomize](./kustomize) | Your platform team owns rendered YAML and environment patches. | The shipped split profile is the recommended production profile. |
| [Helm](./helm) | Your platform team wants a values-driven Kubernetes release. | Set `runtime.mode=split` for the recommended production topology. |

Do not deploy both Helm and Kustomize resources into the same namespace under separate lifecycle owners.

## Supported Kubernetes runtime topologies

| Topology | Default shape | Database pools | Guidance |
| --- | --- | --- | --- |
| **Integrated** | 2 application replicas | 40 connections per application process | Compatibility, evaluation, and existing deployments. |
| **Split — recommended for production** | 2 web, 2 worker, 1 scheduler; web HPA 2→12 | web 10, worker 10, scheduler 5 | New production Kubernetes deployments and independent scaling. |
| **Split + PgBouncer** | Split topology plus 1 PgBouncer | web clients pooled through PgBouncer; worker/scheduler remain direct | Add only when measured web-side PostgreSQL connection pressure justifies pooling. |

These values are deployment defaults, not capacity guarantees. Validate them with a production-like workload before setting operating limits.

### Integrated runtime

```text
users / integrations
        │
        ▼
  application replicas
   web + scheduler
        │
        ▼
     PostgreSQL
```

Integrated mode remains the Helm chart default so existing installations continue to render the historical topology without an implicit architecture change.

### Split runtime — recommended

```text
users / integrations
        │
        ▼
     web replicas ◄──── HPA (2 → 12, CPU 70%)
        │
        ├──────────────► PostgreSQL
        │
background jobs
        ▲
        │
 worker replicas ──────► PostgreSQL
        │
 scheduler ────────────► PostgreSQL
```

Split mode runs explicit `web`, `worker`, and `scheduler` process roles. The public Service selects only web pods. Workers scale independently from request traffic, while the scheduler remains a single deployment replica by default.

The split web tier requests 250m CPU and can burst to a 1000m CPU limit. Its HPA is enabled by default with `minReplicas: 2`, `maxReplicas: 12`, and a 70% CPU target. Small installations therefore remain at two web pods while larger installations can add capacity automatically.

The HPA requires the Kubernetes resource Metrics API, typically provided by metrics-server or an equivalent platform service. If resource metrics are unavailable, the two baseline web replicas continue to run but automatic scaling cannot make decisions.

### Split runtime with PgBouncer

```text
users / integrations
        │
        ▼
     web replicas
        │
        ▼
     PgBouncer
        │
        ▼
     PostgreSQL
        ▲
        ├──────── worker replicas
        └──────── scheduler
```

The bundled PgBouncer is optional and uses transaction pooling. Only web traffic is routed through it; workers and scheduler keep direct PostgreSQL connections.

Do not enable PgBouncer merely because it exists. First measure PostgreSQL connections, pool waits, query latency, and database utilization. Pooling reduces connection pressure; it does not make slow queries or a saturated database faster.

## PostgreSQL connection budgeting

Connection limits are per process or pod. Budget the complete database environment:

```text
(web replicas × web pool)
+ (worker replicas × worker pool)
+ (scheduler replicas × scheduler pool)
+ migrations / administration
+ monitoring / backup clients
< PostgreSQL max_connections
```

At the split baseline:

```text
2 × 10 web
+ 2 × 10 worker
+ 1 × 5 scheduler
= 45 application connections
```

If the web HPA can reach 12 replicas without PgBouncer, size PostgreSQL for the corresponding worst-case web pool or reduce `maxReplicas` to fit the database budget. With bundled PgBouncer, web client connections are multiplexed while worker and scheduler pools remain direct.

Leave explicit reserve for migrations, failover, health checks, monitoring, backups, and operational access.

See [Scalability and capacity planning](../core-concepts/scalability) for the measurement standard.

## Shared production requirements

- Supported PostgreSQL with durable storage, backups, and tested recovery.
- Stable public HTTPS origin used consistently for `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL`.
- Strong, backed-up `NEXTAUTH_SECRET` and 64-hex-character `ENCRYPTION_KEY`.
- Ingress/reverse-proxy forwarding of the original host and scheme.
- Restricted database/admin network access.
- Kubernetes resource metrics when using the default split HPA.
- Monitoring for readiness, restarts, migration failures, database connections, query latency, scheduled work, and integration/notification failures.
- An immutable image release process with an explicit schema/data rollback decision.

Notification credentials are configured in the application UI and encrypted in PostgreSQL. Recovery therefore requires both the database backup and the matching `ENCRYPTION_KEY`.

## Runtime configuration boundaries

Every application role must use the same release, public URL, authentication secret, encryption key, and migrated PostgreSQL database. Helm and the supplied Kustomize profiles set `OPSKNIGHT_PROCESS_ROLE` for you.

The process roles are:

- `integrated` — backward-compatible application runtime;
- `web` — public UI/API workload;
- `worker` — durable background-job processing; and
- `scheduler` — scheduled-work ownership and dispatch.

For managed PostgreSQL, TLS parameters, external PgBouncer services, or credentials containing reserved URI characters, use the deployment method's documented database-URL/Secret mechanism instead of assembling an unsafe URI manually.

## Release workflow

1. Pin the intended application image tag or digest.
2. Review release notes and Prisma migrations.
3. Back up PostgreSQL and critical secrets; keep a recent restore drill.
4. Render and validate the exact deployment topology.
5. Confirm runtime roles, replica/HPA settings, pool limits, Service selectors, PDBs, and NetworkPolicies.
6. Confirm the Metrics API is available when operating the split HPA.
7. Roll out while watching migration/startup logs and database connections.
8. Verify readiness, login, a database write, an inbound test event, background-job processing, and intended notification providers.
9. Run a short production-like capacity check before declaring the new topology ready.

## Production acceptance checklist

- [ ] Split mode is used for new production Kubernetes deployments unless a documented compatibility reason requires integrated mode.
- [ ] Public URL is HTTPS and matches both application URL settings.
- [ ] Database is not exposed publicly and uses encrypted transport where supported.
- [ ] Persistent storage and automated backups are in place.
- [ ] A restore drill succeeded with the backed-up encryption key.
- [ ] Web, worker, and scheduler database pools fit within the PostgreSQL connection budget at maximum intended replicas.
- [ ] The Metrics API is healthy and the web HPA reports CPU metrics.
- [ ] PgBouncer, if enabled, is used only where intended and its credentials match PostgreSQL.
- [ ] Health/readiness, database capacity, and background-job health are monitored externally.
- [ ] Migration/application logs reach durable log storage.
- [ ] Resource requests/limits and scaling bounds are based on representative load testing.
- [ ] Notification and inbound-integration synthetic tests are monitored.
- [ ] Upgrade and data-rollback ownership is documented.
- [ ] Destructive reset commands are excluded from routine runbooks.

## Next steps

- [Docker Compose](./docker)
- [Kubernetes](./kubernetes)
- [Kustomize](./kustomize)
- [Helm](./helm)
- [Monitoring](./monitoring)
- [Enterprise validation drills](./enterprise-validation)
- [Maintenance](./maintenance)
- [Database migrations](./database-migrations)
- [Backup and restore](./backup-restore)
- [Upgrade and rollback](./upgrade-rollback)
- [Scalability and capacity planning](../core-concepts/scalability)
- [Configuration reference](../getting-started/configuration)
- [Security](../security/README)
