---
order: 3
title: Helm deployment
description: Deploy the OpsKnight Helm chart with safe database, networking, secret, and upgrade settings.
---

# Helm deployment

The chart is shipped at `helm/opsknight`. The chart version and default application image version track the OpsKnight application release; production deployments should still pin a tested immutable image tag or digest explicitly.

The `1.4.0` stable image includes the fail-closed migration entrypoint and is published for amd64 and arm64. The continuously updated test image from `main` remains amd64-only.

The chart defaults to the backward-compatible integrated Deployment. Set `runtime.mode: split` to render independent web, maintenance scheduler, general worker, critical worker, bulk worker, and status-projector Deployments. The application Service selects only the web tier.

## Runtime modes

Integrated mode preserves the historical single-process behavior. The scheduler uses its `full` profile and the in-process worker drains all durable lanes.

For production split mode, start from `helm/opsknight/examples/values-split-runtime.yaml`. Split rendering requires an explicit `image.tag` or `image.digest`, because the chart's backward-compatible integrated default image predates the split roles. Use only an image built from a release containing split-runtime support. Split mode also requires `scheduler.profile: maintenance`; `full` is rejected because it would compete with the dedicated worker lanes. The maintenance scheduler cannot claim background jobs, escalations, notifications, or status snapshots. Those responsibilities are assigned to dedicated workers. The `general-worker` is required: it drains operational jobs such as war-room, external-operation, encryption, and compliance work that do not belong to the critical, bulk, or projector lanes.

Every split role has its own replica count, database pool size, resources, PDB, and topology-spread selector. Only the web tier supports the chart-managed HPA, which is disabled by default until capacity is planned. Size fixed worker fleets together with PostgreSQL connection capacity and notification-provider admission limits.

Queue maintenance is executed only by the scheduler replica holding the distributed scheduler lock. General-worker replicas claim ordinary jobs but do not duplicate encryption/compliance reconciliation, stale-job sweeps, or schedule ensuring.

The checked-in split defaults bound the initial database demand and leave the web HPA disabled until capacity is planned. At two replicas per role, the direct Prisma limits total 58 possible connections: web 20, scheduler 6, general 10, critical 10, bulk 6, and projector 6. When PgBouncer is enabled, web's direct 20 is replaced by up to 20 normal pooled backend connections, while workers retain 38 direct connections. Helm calculates the maximum configured demand and rejects values above `database.maxApplicationConnections` (80 by default). Autoscaled web uses `maxReplicas × poolSize`; PgBouncer uses `replicas × defaultPoolSize`. Set the ceiling from the database's tested capacity while retaining separate headroom for migrations, administration, monitoring, and failover overlap. Prefer managed PostgreSQL for sustained production split deployments.

Treat the first integrated-to-split change as a controlled topology migration. The Service gains a web-role selector that old integrated pods do not have, so ordinary Deployment rolling-update settings alone cannot guarantee uninterrupted endpoint overlap. Render the change, pre-scale capacity, choose a maintenance window or pre-stage a compatible serving label in your environment, and verify Service endpoints before removing the integrated pods.

## Prerequisites

- Kubernetes and Helm 3.
- An ingress/TLS strategy if the service is public.
- metrics-server if you enable the chart HPA.
- A PostgreSQL plan: bundled single-instance PostgreSQL or an external/managed service.
- At least two schedulable nodes for the split example's hard hostname-spread constraint; add zone spread for multi-zone production clusters.
- Stable, backed-up `NEXTAUTH_SECRET` and 64-hex-character `ENCRYPTION_KEY` values.

Default values are usable for evaluation only. The checked-in passwords/secrets and localhost URLs must be replaced before production use.

## Production values

Example using managed PostgreSQL:

```yaml
image:
  repository: ghcr.io/opsknight-labs/opsknight
  tag: '1.4.0' # pin the release you tested
  # digest: 'sha256:...' # optional; takes precedence over tag

config:
  nextauthUrl: 'https://ops.example.com'
  nextPublicAppUrl: 'https://ops.example.com'

secrets:
  # Recommended: pre-create this Secret with DATABASE_URL,
  # WEB_DATABASE_URL, NEXTAUTH_SECRET, and ENCRYPTION_KEY keys.
  existingSecret: opsknight-runtime

database:
  # Must match the external URL port for NetworkPolicy rendering.
  port: 5432

postgresql:
  enabled: false
  port: '5432'

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

Create the external Secret before the release, for example through External Secrets, a CSI driver, Sealed Secrets, or your platform's approved controller. Split mode uses `DATABASE_URL` for every role when PgBouncer is disabled, preserving compatibility with existing Secrets. When PgBouncer is enabled, direct worker/scheduler and web migration connections use `DATABASE_URL`, while web runtime traffic uses `WEB_DATABASE_URL`. All modes also require `NEXTAUTH_SECRET` and `ENCRYPTION_KEY`. With bundled PostgreSQL, also provide `POSTGRES_USER` and `POSTGRES_PASSWORD`. Key names can be changed under `secrets.keys`.

## Optional PgBouncer

`pgbouncer.enabled: true` is available only in split mode. It renders two PgBouncer replicas by default in transaction-pooling mode, a Service, PDB, topology spreading, and a policy that accepts traffic only from web pods. Scheduler and worker roles continue to connect directly to PostgreSQL.

The web container receives two connection paths when PgBouncer is enabled: `DATABASE_URL` is the pooled runtime URL, while `DIRECT_DATABASE_URL` is sourced from the ordinary `DATABASE_URL` Secret key and points directly to PostgreSQL. The startup entrypoint temporarily uses the direct URL for Prisma migrations, recovery, and index installation, then restores the pooled URL before starting the application. Existing externally managed Secrets therefore do not need an additional key.

PgBouncer's backend capacity is also per replica: `replicaCount × defaultPoolSize` is the normal backend budget, with `reservePoolSize` available during pressure. Budget that together with all direct scheduler/worker pools; PgBouncer does not increase PostgreSQL's safe connection limit.

Use `pgbouncer.existingAuthSecret` in production. For an external PostgreSQL backend, structured `postgresql.*` settings, `postgresql.tls.enabled: true`, and a CA Secret are required; PgBouncer and every direct role verify the backend certificate. The bundled PgBouncer cannot be combined with an opaque `database.url`, because it must know the backend host and TLS material itself.

If `secrets.existingSecret` is empty, the chart renders those values into its own Kubernetes Secret. Helm release data can then contain supplied secret values, so protect the values file and Helm storage backend and avoid secrets in shared command history. Changes to a chart-generated Secret or ConfigMap update pod-template checksums and roll the Deployment. External Secret content changes cannot be checksummed by Helm; configure the secret controller to restart/reload the Deployment, or perform an explicit rollout restart after rotation.

## Database URL behavior

When the chart manages its Secret, `database.url` has highest priority. Use it when you need:

- managed PostgreSQL;
- `sslmode=require` / `verify-full` or other query parameters;
- PgBouncer;
- credentials containing reserved URI characters;
- provider-specific connection options.

If `database.url` is empty and no existing Secret is selected, the chart constructs a URI from the `postgresql.*` values and URI-encodes username/password components.

With `postgresql.enabled: true`, the chart deploys `postgres:15-alpine` and uses that image's `postgres` uid/gid (`70`). The PostgreSQL security contexts are values-driven so a different image can override them intentionally. Storage comes from the StatefulSet volume claim template. The governing Service remains a normal ClusterIP to preserve upgrade compatibility with existing installations; changing an allocated Service to headless is an immutable operation.

The bundled PostgreSQL topology is one instance; it is not HA and does not provide backups automatically.

## Render and validate

Always render before install/upgrade:

```bash
helm lint helm/opsknight --values values.production.yaml

helm template opsknight helm/opsknight \
  --namespace opsknight \
  --values values.production.yaml > /tmp/opsknight-rendered.yaml

kubectl apply --dry-run=server -f /tmp/opsknight-rendered.yaml
```

Inspect the resolved image, Secret keys, URL configuration, ingress/TLS, probes, security contexts, storage, HPA, PDB, and NetworkPolicy.

Install:

```bash
helm upgrade --install opsknight helm/opsknight \
  --namespace opsknight \
  --create-namespace \
  --values values.production.yaml \
  --wait --timeout 10m
```

## NetworkPolicy

NetworkPolicy is disabled by default because ingress-controller namespaces and external database destinations are cluster-specific.

When enabled, the default ingress namespace selector uses the standard namespace label:

```yaml
networkPolicy:
  enabled: true
  ingressNamespaceLabels:
    kubernetes.io/metadata.name: ingress-nginx
```

Change those labels to match your ingress controller.

For bundled PostgreSQL, application DB egress is restricted to the PostgreSQL pod and the PostgreSQL pod cannot initiate outbound connections. When `postgresql.enabled: false`, keep `database.port` aligned with `DATABASE_URL` and set `networkPolicy.externalDatabaseCIDRs` to the managed provider's documented destination ranges. Those CIDRs constrain web, worker, scheduler, and bundled PgBouncer database egress. An empty list retains broad external compatibility for upgrades, but is not the recommended production setting.

```yaml
networkPolicy:
  enabled: true
  externalDatabaseCIDRs:
    - 10.24.0.0/16
```

DNS permits UDP and TCP 53; HTTPS egress is required by common OIDC, webhook, notification, and integration flows.

## Startup and migrations

The `1.4.0` image and later run `prisma migrate deploy` before starting the server. They retry migration failures and may run the packaged recovery helper between attempts. If migrations still fail, the container exits non-zero.

A startup probe gives migrations and cold starts up to approximately five minutes before liveness checks can restart the container. After startup:

- `/api/health` is used for liveness;
- `/api/health?mode=readiness` is used for readiness.

The chart currently performs migrations in the application startup path rather than a dedicated Helm hook Job. Prisma migration locking protects schema application, but upgrades should still be monitored closely when several replicas start together.

## Scaling

Integrated mode defaults to two fixed replicas (`replicaCount: 2`) so a basic install does not depend on metrics-server. Split mode also leaves the web HPA disabled by default and keeps worker fleets fixed. Enable web autoscaling only after budgeting its maximum replica count against PostgreSQL or PgBouncer capacity.

Connection limits are per application process. Calculate each role as `replicaCount × database.poolSize`, add PgBouncer's backend budget when enabled, then leave explicit headroom for migrations and operators. Validate scheduled/background work under the chosen topology.

The application ServiceAccount token is not mounted by default because OpsKnight does not require Kubernetes API access. Set `serviceAccount.automount: true` only for a deliberate extension that needs it.

## Prometheus metrics

The chart can inject `PROMETHEUS_SCRAPE_TOKEN` from an existing Secret and render an authenticated
`ServiceMonitor`. Enabling the monitor without `metrics.scrapeTokenSecret.existingSecret` fails chart
rendering. When NetworkPolicy is enabled, explicitly allow the selected Prometheus pods or namespace
to reach the application port.

See [Prometheus metrics](./prometheus) for production values, Secret creation, Operator selectors,
NetworkPolicy, recording rules, PromQL, and validation.

## Upgrade and rollback

Before upgrading:

1. record the current image/chart and configuration;
2. back up PostgreSQL and verify the matching encryption key is recoverable;
3. render/diff the new release;
4. upgrade with an immutable tested image;
5. watch startup/migration logs and rollout state;
6. verify authentication, database writes, a controlled incident, and notification/integration delivery.

```bash
helm upgrade opsknight helm/opsknight \
  --namespace opsknight \
  --values values.production.yaml \
  --set-string image.digest='sha256:<tested-manifest-digest>' \
  --wait --timeout 10m
```

`image.digest` renders `repository@sha256:...` and takes precedence over `image.tag`. For a normal immutable version tag, leave `image.digest` empty and set `image.tag` instead.

`helm rollback` changes Kubernetes resources; it does not reverse Prisma migrations. Confirm old-image/schema compatibility before rolling the application back, or restore the verified pre-upgrade database when a data rollback is required.

## Related topics

- [Kubernetes](./kubernetes)
- [Kustomize](./kustomize)
- [Docker Compose](./docker)
- [Prometheus metrics](./prometheus)
- [Configuration reference](../getting-started/configuration)
- [Maintenance](./maintenance)
