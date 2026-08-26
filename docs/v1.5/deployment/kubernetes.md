---
order: 2
title: Kubernetes deployment
description: Deploy OpsKnight v1.5 on Kubernetes with the recommended split runtime, default web HPA, and optional PgBouncer.
---

# Kubernetes deployment

OpsKnight v1.5 ships both a Helm chart at `helm/opsknight` and Kustomize profiles under `k8s/`. Both support integrated, split, and split-with-PgBouncer runtime topologies.

**For new production Kubernetes deployments, use split mode.** Integrated mode remains available as the backward-compatible packaging default so upgrades do not silently change runtime architecture.

Use one packaging owner per namespace. Do not install Helm and Kustomize variants side-by-side over the same resources.

## Choose a packaging path

| Path | Use it when | Detailed guide |
| --- | --- | --- |
| Helm | Your release process manages values and Helm releases. Set `runtime.mode=split` for new production deployments. | [Helm](./helm) |
| Kustomize | Your release process owns rendered YAML and environment patches. Use `k8s/profiles/split`. | [Kustomize](./kustomize) |

## Runtime topology choices

### Integrated — backward-compatible packaging default

```text
web/API + scheduled work
          │
          ▼
   application pods
          │
          ▼
      PostgreSQL
```

Defaults: 2 application replicas, 40 PostgreSQL connections per process, integrated HPA disabled.

### Split — recommended for production

```text
users/integrations -> web pods -----------┐
                       ▲                  │
                  HPA 2 → 12              │
                                          │
background jobs ----> worker pods --------┼-> PostgreSQL
                                          │
scheduled work -----> scheduler ----------┘
```

Defaults:

- 2 baseline web replicas;
- web HPA enabled by default, 2→12 replicas at 70% CPU;
- web CPU request 250m and limit 1000m;
- 2 worker replicas;
- 1 scheduler replica;
- database pools 10/10/5.

The public Service selects only the web role. Workers and scheduler operate independently from request traffic.

The split HPA requires the Kubernetes resource Metrics API, usually metrics-server or an equivalent platform service. If metrics are unavailable, the two baseline web replicas continue to run but the HPA cannot calculate scaling decisions.

### Split + PgBouncer

```text
web pods -> PgBouncer -> PostgreSQL
worker pods -----------> PostgreSQL
scheduler -------------> PostgreSQL
```

PgBouncer is optional and disabled by default. Use it only when measured web-side connection pressure warrants pooling. It does not fix slow SQL, lock contention, or a saturated PostgreSQL instance.

The split+PgBouncer topology inherits the same default web HPA as split mode.

## Production prerequisites

- Kubernetes access that can perform a server-side dry run.
- Helm 3 or `kubectl` Kustomize support.
- Kubernetes resource Metrics API for split web autoscaling.
- A tested immutable OpsKnight image tag or digest.
- Ingress, DNS, and TLS ownership.
- PostgreSQL with durable storage, capacity monitoring, backups, and tested restore.
- Secret delivery for database credentials, `NEXTAUTH_SECRET`, and `ENCRYPTION_KEY`.
- External collection for container logs and platform/database metrics.

The bundled PostgreSQL is a single-instance starting topology, not an HA database service.

## Connection-budget requirement

Every replica owns a connection pool. Calculate the aggregate at both baseline and maximum HPA replicas:

```text
(web replicas × web pool)
+ (worker replicas × worker pool)
+ (scheduler replicas × scheduler pool)
+ migration/admin/monitoring reserve
< PostgreSQL max_connections
```

Baseline split topology:

```text
2×10 + 2×10 + 1×5 = 45 application connections
```

Without PgBouncer, the default web HPA can reach 12 replicas, so the web tier can theoretically consume up to 120 direct PostgreSQL connections if every pool is full.

If PgBouncer is enabled, web client connections are multiplexed through its backend pool; worker and scheduler pools still count directly against PostgreSQL.

Keep reserve for migration/recovery access. Do not size pools to consume the full PostgreSQL limit.

## Shared runtime configuration

Every role must use:

- the same OpsKnight release;
- the same migrated PostgreSQL database;
- the same `NEXTAUTH_SECRET`;
- the same `ENCRYPTION_KEY`;
- the same public application URLs.

The supplied Helm and Kustomize packaging sets `OPSKNIGHT_PROCESS_ROLE` automatically. In split mode the roles are `web`, `worker`, and `scheduler`; integrated mode uses `integrated`.

## Render before applying

Helm recommended split:

```bash
helm lint helm/opsknight
helm template opsknight helm/opsknight \
  --namespace opsknight \
  --set runtime.mode=split \
  > /tmp/opsknight-rendered.yaml
kubectl apply --dry-run=server -f /tmp/opsknight-rendered.yaml
```

Kustomize integrated:

```bash
kubectl kustomize k8s > /tmp/opsknight-integrated.yaml
```

Kustomize recommended split:

```bash
kubectl kustomize k8s/profiles/split > /tmp/opsknight-split.yaml
```

Kustomize split + PgBouncer:

```bash
kubectl kustomize k8s/profiles/split-pgbouncer > /tmp/opsknight-split-pgbouncer.yaml
```

Review the rendered image, role labels, baseline replicas, HPA bounds, Service selectors, Secret sources, database URLs/pools, PgBouncer configuration, probes, resources, PDB, storage, ingress, and NetworkPolicy.

## Apply and verify

Helm:

```bash
helm upgrade --install opsknight helm/opsknight \
  --namespace opsknight \
  --create-namespace \
  --values values.production.yaml \
  --wait --timeout 10m
```

Kustomize:

```bash
kubectl apply -k deploy/production
```

Verify role and autoscaling health:

```bash
kubectl -n opsknight get deploy,pods,svc,pdb,hpa
kubectl -n opsknight get pods -L opsknight-role
kubectl -n opsknight top pods
```

For split mode confirm:

- public traffic reaches only web pods;
- the web HPA reports CPU metrics;
- worker pods process durable jobs;
- exactly the intended scheduler deployment is present;
- database connection counts match the configured topology;
- PgBouncer, if enabled, receives web traffic on 6432 only.

## HPA and worker scaling

Split web HPA is enabled by default. Its shipped policy is:

```text
min replicas: 2
max replicas: 12
CPU target:   70%
```

CPU is the default signal because validation identified CPU throttling as the first web-tier concurrency bottleneck. Memory-based HPA scaling is not enabled by default.

Before increasing `maxReplicas`, calculate the worst-case PostgreSQL connection budget and confirm the cluster has enough node capacity to schedule additional web pods.

Do not scale workers solely from web CPU. Worker count should be changed using measured backlog age, job drain time, database pressure, and provider behavior. More workers can make a PostgreSQL bottleneck worse.

## NetworkPolicy

NetworkPolicy is optional because cluster ingress namespaces and database destinations vary.

When enabled, use the policy matching the selected topology. Split+PgBouncer requires a different database path from plain split mode: web must reach PgBouncer, while workers and scheduler must reach PostgreSQL directly.

Review DNS, ingress, PostgreSQL, PgBouncer, and required HTTPS provider egress against your cluster policy before enforcement.

## Startup and migrations

Application containers run the packaged Prisma migration/startup path before serving. Startup probes allow migration/cold-start time before liveness restarts.

The current packaging does not use a dedicated migration Job. Keep direct PostgreSQL capacity available for migration and recovery operations and monitor upgrades when several application pods start together.

## PostgreSQL and recovery

The bundled PostgreSQL StatefulSet has one replica and uses a volume claim template. A PVC and PDB do not provide database failover or backups.

For production, either explicitly accept and mitigate the single-instance risk or use a managed/operator-owned PostgreSQL topology.

Back up PostgreSQL outside the cluster failure domain and rehearse restore with the matching `ENCRYPTION_KEY`.

Monitor at least:

- current/max connections and pool waits;
- query latency;
- locks/deadlocks;
- CPU, memory, and storage I/O;
- web HPA desired/current replicas and CPU;
- database growth and backup success;
- worker backlog and failures;
- scheduler health;
- PgBouncer client/server pools when enabled.

## Upgrade and rollback

1. Record the current rendered resources and image digest.
2. Take and verify a database backup.
3. Render and server-dry-run the new release.
4. Recalculate database connections at baseline and HPA maximum.
5. Verify the Metrics API is healthy.
6. Apply and observe migrations, role readiness, HPA, jobs, and database pressure.
7. Verify authentication, writes, a controlled incident, and notification delivery.

A Deployment or Helm rollback does not reverse PostgreSQL migrations or data changes. Confirm schema compatibility before rolling back application code.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| HPA shows `<unknown>` metrics | Metrics API/metrics-server health, resource requests, API aggregation. |
| Readiness fails | PostgreSQL DNS/network/TLS/credentials, migrations, schema state, web CPU pressure. |
| Failures appear after scaling | Pool budget, DB saturation, role configuration drift, pod resources. |
| Jobs build up | Worker health/concurrency, database latency, provider failures, job retries. |
| Scheduled work stops | Scheduler pod health and scheduler state/lock ownership. |
| PgBouncer clients connect but requests stall | Backend pool saturation, query latency, PostgreSQL CPU/locks. |
| PostgreSQL reaches max connections | HPA max replicas, per-role pools, non-OpsKnight clients, migration/admin reserve. |
| SSE/dashboard disconnects | Ingress buffering/timeouts, draining, web pod CPU/HPA behavior. |

## Related topics

- [Deployment overview](./README)
- [Kustomize](./kustomize)
- [Helm](./helm)
- [Monitoring](./monitoring)
- [Database migrations](./database-migrations)
- [Backup and restore](./backup-restore)
- [Scalability and capacity planning](../core-concepts/scalability)
- [Troubleshooting](../troubleshooting)
