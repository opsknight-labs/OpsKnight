---
order: 3
title: Helm deployment
description: Deploy OpsKnight v1.5 with the recommended split runtime, default web autoscaling, optional PgBouncer, and production-safe database settings.
---

# Helm deployment

The chart is shipped at `helm/opsknight`.

**For new production Kubernetes deployments, use split mode.** It separates web, worker, and scheduler responsibilities, enables CPU-driven web autoscaling by default, and keeps per-role PostgreSQL connection pools independently configurable.

The chart still renders integrated mode by default for backward compatibility. Existing installations therefore do not receive an implicit topology change during upgrade.

Production deployments should pin a tested immutable image tag or digest and render the exact chart configuration before install or upgrade.

## Runtime modes

### Integrated mode — compatibility default

```yaml
runtime:
  mode: integrated
```

Integrated mode renders the historical application deployment. Defaults:

- 2 application replicas;
- PostgreSQL connection limit 40 per application process;
- 30-second termination grace period;
- integrated HPA disabled by default.

Use integrated mode for compatibility, evaluation, or an existing deployment that has not yet qualified the split topology.

### Split mode — recommended for production

```yaml
runtime:
  mode: split
```

Default split shape:

```yaml
web:
  replicaCount: 2
  database:
    connectionLimit: 10
  resources:
    requests:
      cpu: 250m
      memory: 256Mi
    limits:
      cpu: 1000m
      memory: 1Gi
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 12
    targetCPUUtilizationPercentage: 70
    targetMemoryUtilizationPercentage: null

worker:
  replicaCount: 2
  database:
    connectionLimit: 10

scheduler:
  replicaCount: 1
  database:
    connectionLimit: 5
```

The chart renders:

- a public web Deployment and Service;
- a worker Deployment;
- a scheduler Deployment;
- independent per-role database pool settings;
- worker runtime tuning;
- a web HorizontalPodAutoscaler;
- role-aware PDB and NetworkPolicy behavior when enabled.

The Service selects only web pods. Workers and the scheduler are not exposed through the public Service.

The split web CPU request is deliberately lower than its limit: a small installation reserves 250m per web pod, while each Node.js process can burst to 1000m as the HPA reacts to sustained demand. The HPA starts at two replicas and can scale to twelve at a 70% CPU target.

CPU is the default scaling signal because validation identified web CPU throttling as the first concurrency bottleneck. Memory autoscaling remains configurable but is disabled by default to avoid unnecessary scale-out from long-lived Node.js heap behavior.

### Metrics requirement

The split HPA requires the Kubernetes resource Metrics API, typically provided by metrics-server or an equivalent platform service.

Verify before production rollout:

```bash
kubectl top nodes
kubectl top pods -n opsknight
```

If resource metrics are unavailable, the baseline web replicas continue to run, but the HPA cannot calculate scale decisions.

To disable split web autoscaling deliberately:

```yaml
web:
  autoscaling:
    enabled: false
  replicaCount: 2
```

When HPA is enabled, a fresh Helm install seeds the Deployment at `web.autoscaling.minReplicas`. On subsequent upgrades Helm omits the Deployment replica field so it does not reset a replica count currently owned by the HPA.

## Worker defaults

```yaml
worker:
  config:
    batchSize: 100
    concurrency: 15
    idlePollMs: 1000
    busyPollMs: 100
  terminationGracePeriodSeconds: 60
```

The worker deployment does not use a CPU HPA by default. Background-job scaling should follow queue depth, due-job age, processing latency, and retry behavior rather than request-tier CPU alone.

Treat all shipped resource and worker values as starting points, not throughput guarantees.

## Optional PgBouncer

Enable the bundled PgBouncer only in split mode:

```yaml
runtime:
  mode: split

pgbouncer:
  enabled: true
```

Topology:

```text
web -> PgBouncer -> PostgreSQL
worker ----------> PostgreSQL
scheduler --------> PostgreSQL
```

Only web traffic is routed through PgBouncer. Workers and the scheduler keep direct PostgreSQL connections.

Default settings:

```yaml
pgbouncer:
  port: 6432
  poolMode: transaction
  maxClientConnections: 1000
  defaultPoolSize: 40
  reservePoolSize: 10
  maxPreparedStatements: 100
  replicas: 1
```

The bundled configuration:

- uses transaction pooling;
- supports prepared statements with `max_prepared_statements = 100`;
- accepts Prisma startup parameters `extra_float_digits` and `search_path`;
- runs with numeric uid/gid 70 for Kubernetes `runAsNonRoot` enforcement.

PgBouncer is a connection-management option, not a database performance accelerator. It can reduce PostgreSQL backend-session pressure; it does not fix slow queries, transaction contention, saturated CPU, or insufficient storage I/O.

### PgBouncer configuration boundary

The built-in PgBouncer requires structured `postgresql.*` values because Helm cannot safely decompose an arbitrary `database.url` into backend host, credentials, and database configuration.

Do not combine:

```yaml
database:
  url: postgresql://...

pgbouncer:
  enabled: true
```

The chart intentionally rejects that combination.

For an externally managed PgBouncer, leave the bundled PgBouncer disabled and supply the complete connection URI through your Secret or `database.url`.

## Recommended production values

```yaml
runtime:
  mode: split

image:
  repository: ghcr.io/opsknight-labs/opsknight
  tag: '1.5.0' # replace with the release you qualified

config:
  nextauthUrl: 'https://ops.example.com'
  nextPublicAppUrl: 'https://ops.example.com'

postgresql:
  enabled: false
  host: 'db.internal.example.com'
  port: '5432'
  database: opsknight
  username: opsknight
  password: 'supply-securely'

web:
  database:
    connectionLimit: 10
  resources:
    requests:
      cpu: 250m
      memory: 256Mi
    limits:
      cpu: 1000m
      memory: 1Gi
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 12
    targetCPUUtilizationPercentage: 70
    targetMemoryUtilizationPercentage: null

worker:
  replicaCount: 2
  database:
    connectionLimit: 10

scheduler:
  replicaCount: 1
  database:
    connectionLimit: 5

ingress:
  enabled: true
  className: nginx
  hosts:
    - host: ops.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: opsknight-tls
      hosts:
        - ops.example.com
```

Do not place production passwords in a committed values file. Use your platform's approved secret-delivery mechanism.

## Secret contract

Prefer `secrets.existingSecret` for production:

```yaml
secrets:
  existingSecret: opsknight-runtime
```

### Integrated mode keys

The external Secret must provide at least:

- `DATABASE_URL`;
- `NEXTAUTH_SECRET`;
- `ENCRYPTION_KEY`.

### Split mode keys

The role deployments read separate database keys by default:

- `WEB_DATABASE_URL`;
- `WORKER_DATABASE_URL`;
- `SCHEDULER_DATABASE_URL`;
- `NEXTAUTH_SECRET`;
- `ENCRYPTION_KEY`.

Key names are configurable under `secrets.keys`.

When the chart manages the Secret, it generates role-specific URLs from `database.url` or structured PostgreSQL values. When you provide an existing Secret, your secret controller owns creation and rotation of the required keys.

If bundled PostgreSQL is enabled, preserve the configured PostgreSQL credentials. If bundled PgBouncer is enabled, its authentication is derived from `postgresql.username` and `postgresql.password`, so those values must match the PostgreSQL backend credentials.

## Database URL behavior

`database.url` remains the full-URI override.

### Integrated mode

If `database.url` is set, the application uses it directly. Otherwise the chart constructs a URI from `postgresql.*` and applies the integrated pool settings.

### Split mode without bundled PgBouncer

If `database.url` is set, the chart-managed Secret uses that URI for all three roles. This is useful for managed PostgreSQL, external PgBouncer, TLS parameters, or provider-specific connection options.

If `database.url` is empty, the chart creates separate role URLs from structured PostgreSQL settings and applies each role's connection limit.

### Split mode with bundled PgBouncer

The web URL points to the PgBouncer Service on port 6432. Worker and scheduler URLs continue to point directly to PostgreSQL.

## PostgreSQL connection budget

Pool settings are per pod. Calculate the total before increasing replicas:

```text
(web replicas × web.database.connectionLimit)
+ (worker replicas × worker.database.connectionLimit)
+ (scheduler replicas × scheduler.database.connectionLimit)
+ operational reserve
< PostgreSQL max_connections
```

At the split baseline:

```text
2×10 + 2×10 + 1×5 = 45 application connections
```

Without PgBouncer, calculate the worst case at the HPA maximum as well. With the default `maxReplicas: 12`, the web tier alone can theoretically consume up to 120 direct PostgreSQL connections if every web pool is fully used.

With bundled PgBouncer, web client connections are multiplexed through PgBouncer's backend pool. Worker and scheduler pools still count directly against PostgreSQL.

Keep reserve for migrations, monitoring, backup clients, failover, and emergency administration. Do not raise pool sizes solely because PostgreSQL accepts more sessions.

## Autoscaling operations

Default split web HPA:

```yaml
web:
  autoscaling:
    enabled: true
    minReplicas: 2
    maxReplicas: 12
    targetCPUUtilizationPercentage: 70
    targetMemoryUtilizationPercentage: null
```

Inspect it with:

```bash
kubectl -n opsknight get hpa
kubectl -n opsknight describe hpa opsknight
kubectl -n opsknight top pods
```

Tune `maxReplicas` together with cluster capacity and PostgreSQL connection budgeting. Do not increase the maximum independently of the database and node capacity available to the deployment.

## NetworkPolicy

NetworkPolicy is disabled by default because ingress-controller namespaces and external database destinations are cluster-specific.

```yaml
networkPolicy:
  enabled: true
  ingressNamespaceLabels:
    kubernetes.io/metadata.name: ingress-nginx
```

In split mode, policy behavior is role-aware. When bundled PgBouncer is enabled, web database traffic is permitted to PgBouncer while worker and scheduler database traffic remains direct.

Review rendered policy against your ingress controller, DNS, PostgreSQL, external providers, and managed-database network requirements before enabling it.

## Startup and migrations

Application containers run the packaged migration/startup path before serving traffic. A startup probe protects legitimate migration and cold-start time from liveness restarts.

The chart does not currently create a dedicated migration Job. Multiple starting replicas can reach the migration path, while Prisma migration locking protects schema application. Monitor upgrade startup closely and keep direct PostgreSQL capacity available for migration and recovery operations.

PgBouncer is not a substitute for a direct administrative or migration connection.

## Render and validate

Integrated:

```bash
helm lint helm/opsknight
helm template opsknight helm/opsknight \
  --namespace opsknight \
  > /tmp/opsknight-integrated.yaml
```

Recommended split topology:

```bash
helm template opsknight helm/opsknight \
  --namespace opsknight \
  --set runtime.mode=split \
  > /tmp/opsknight-split.yaml
```

The split render should include an `autoscaling/v2` HPA with `minReplicas: 2`, `maxReplicas: 12`, and a 70% CPU target.

Split + PgBouncer:

```bash
helm template opsknight helm/opsknight \
  --namespace opsknight \
  --set runtime.mode=split \
  --set pgbouncer.enabled=true \
  > /tmp/opsknight-split-pgbouncer.yaml
```

For a production values file:

```bash
helm lint helm/opsknight --values values.production.yaml
helm template opsknight helm/opsknight \
  --namespace opsknight \
  --values values.production.yaml > /tmp/opsknight-rendered.yaml
kubectl apply --dry-run=server -f /tmp/opsknight-rendered.yaml
```

Verify at minimum:

- intended runtime roles and baseline replica counts;
- web-only public Service selection in split mode;
- web HPA bounds and resource metrics;
- role-specific database Secret keys;
- pool limits and PgBouncer backend/startup-parameter settings;
- startup/liveness/readiness probes;
- resource requests/limits;
- PDB behavior;
- security contexts and ServiceAccount token settings;
- ingress/TLS and NetworkPolicy;
- no placeholder production secrets.

## Install or upgrade

```bash
helm upgrade --install opsknight helm/opsknight \
  --namespace opsknight \
  --create-namespace \
  --values values.production.yaml \
  --wait --timeout 10m
```

After rollout:

```bash
kubectl -n opsknight get deploy,pods,svc,pdb,hpa
kubectl -n opsknight get pods -L opsknight-role
kubectl -n opsknight top pods
```

In split mode confirm web, worker, and scheduler pods are healthy, the web HPA reports CPU metrics, and only the web role is selected by the public Service. If PgBouncer is enabled, confirm the web connection path uses port 6432 while worker and scheduler remain direct to PostgreSQL.

## Upgrade and rollback

Before upgrading:

1. record the current image/chart and configuration;
2. back up PostgreSQL and verify the matching encryption key is recoverable;
3. render/diff the new release;
4. confirm the database connection budget at baseline and HPA maximum replicas;
5. verify resource metrics are healthy;
6. upgrade with an immutable tested image;
7. watch startup/migration, HPA, worker, scheduler, PgBouncer, and PostgreSQL metrics;
8. verify login, writes, a controlled incident, background-job processing, and notification delivery.

`helm rollback` changes Kubernetes resources; it does not reverse Prisma migrations or data changes. Confirm old-image/schema compatibility before rolling the application back, or restore the verified pre-upgrade database when a data rollback is required.

## Related topics

- [Deployment overview](./README)
- [Kubernetes](./kubernetes)
- [Kustomize](./kustomize)
- [Scalability and capacity planning](../core-concepts/scalability)
- [Database migrations](./database-migrations)
- [Monitoring](./monitoring)
- [Configuration reference](../getting-started/configuration)
