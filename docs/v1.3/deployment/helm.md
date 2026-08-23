---
order: 3
title: Helm deployment
description: Deploy the OpsKnight Helm chart with safe database, networking, secret, and upgrade settings.
---

# Helm deployment

The chart is shipped at `helm/opsknight`. The chart version and default application image version track the OpsKnight application release; production deployments should still pin a tested immutable image tag or digest explicitly.

The chart creates the application Deployment, Service, ConfigMap, Secret, optional Ingress, HPA, PodDisruptionBudget, optional NetworkPolicy, and optionally a single PostgreSQL StatefulSet.

## Prerequisites

- Kubernetes and Helm 3.
- An ingress/TLS strategy if the service is public.
- metrics-server if the default HPA remains enabled.
- A PostgreSQL plan: bundled single-instance PostgreSQL or an external/managed service.
- Stable, backed-up `NEXTAUTH_SECRET` and 64-hex-character `ENCRYPTION_KEY` values.

Default values are usable for evaluation only. The checked-in passwords/secrets and localhost URLs must be replaced before production use.

## Production values

Example using managed PostgreSQL:

```yaml
image:
  repository: ghcr.io/opsknight-labs/opsknight
  tag: '1.3.1' # pin the release you tested

config:
  nextauthUrl: 'https://ops.example.com'
  nextPublicAppUrl: 'https://ops.example.com'

secrets:
  nextauthSecret: '<generated-session-secret>'
  encryptionKey: '<64-hex-character-key>'

database:
  # Complete URI is preferred for managed DBs, TLS/PgBouncer options,
  # and credentials that require URI percent-encoding.
  url: 'postgresql://user:ENCODED_PASSWORD@db.example.com:5432/opsknight_db?sslmode=require&connection_limit=40&pool_timeout=30'

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

The chart stores the resolved `DATABASE_URL`, session secret, encryption key, and PostgreSQL credentials in its Kubernetes Secret instead of placing the database URI directly in the Deployment environment specification. Helm release data can still contain supplied values, so protect the values file and Helm storage backend.

The chart does not yet have an `existingSecret` switch. If your platform mandates External Secrets/CSI or another secrets controller, render/patch the generated Secret and Deployment through your normal delivery process and avoid putting production values on shared command lines.

## Database URL behavior

`database.url` has highest priority. Use it when you need:

- managed PostgreSQL;
- `sslmode=require` / `verify-full` or other query parameters;
- PgBouncer;
- credentials containing reserved URI characters;
- provider-specific connection options.

If `database.url` is empty, the chart constructs a URI from the `postgresql.*` values and URI-encodes username/password components.

With `postgresql.enabled: true`, the chart deploys `postgres:15-alpine` and uses that image's `postgres` uid/gid (`70`). The PostgreSQL security contexts are values-driven so a different image can override them intentionally. The database Service is headless and storage comes from the StatefulSet volume claim template.

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

For bundled PostgreSQL, DB egress is restricted to the PostgreSQL pod. When `postgresql.enabled: false`, TCP egress on the configured PostgreSQL port is permitted to external destinations so managed DB connectivity is not accidentally blocked. Tighten that rule with your platform policy/CIDR controls when the target is known.

DNS permits UDP and TCP 53; HTTPS egress is required by common OIDC, webhook, notification, and integration flows.

## Startup and migrations

The application container runs `prisma migrate deploy` before starting the server. It retries migration failures and may run the packaged recovery helper between attempts. If migrations still fail, the container exits non-zero; OpsKnight no longer starts against an unknown schema.

A startup probe gives migrations and cold starts up to approximately five minutes before liveness checks can restart the container. After startup:

- `/api/health` is used for liveness;
- `/api/health?mode=readiness` is used for readiness.

The chart currently performs migrations in the application startup path rather than a dedicated Helm hook Job. Prisma migration locking protects schema application, but upgrades should still be monitored closely when several replicas start together.

## Scaling

HPA is enabled by default with two to ten replicas and CPU/memory targets. Disable it if the cluster does not expose the required metrics or if another autoscaler owns the Deployment.

Connection limits are per application process. Size PostgreSQL capacity for the aggregate number of replicas, and validate scheduled/background work under the chosen topology.

The application ServiceAccount token is not mounted by default because OpsKnight does not require Kubernetes API access. Set `serviceAccount.automount: true` only for a deliberate extension that needs it.

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
  --set image.tag='<tested-immutable-tag>' \
  --wait --timeout 10m
```

`helm rollback` changes Kubernetes resources; it does not reverse Prisma migrations. Confirm old-image/schema compatibility before rolling the application back, or restore the verified pre-upgrade database when a data rollback is required.

## Related topics

- [Kubernetes](./kubernetes)
- [Kustomize](./kustomize)
- [Docker Compose](./docker)
- [Configuration reference](../getting-started/configuration)
- [Maintenance](./maintenance)
