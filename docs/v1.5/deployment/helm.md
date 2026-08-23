---
order: 3
title: Helm deployment
description: Deploy the OpsKnight Helm chart with safe database, networking, secret, and upgrade settings.
---

# Helm deployment

The chart is shipped at `helm/opsknight`. The chart version and default application image version track the OpsKnight application release; production deployments should still pin a tested immutable image tag or digest explicitly.

The `1.4.0` stable image includes the fail-closed migration entrypoint and is published for amd64 and arm64. The continuously updated test image from `main` remains amd64-only.

The chart creates the application Deployment, Service, ConfigMap, Secret, optional Ingress, optional HPA, PodDisruptionBudget, optional NetworkPolicy, and optionally a single PostgreSQL StatefulSet.

## Prerequisites

- Kubernetes and Helm 3.
- An ingress/TLS strategy if the service is public.
- metrics-server if you enable the chart HPA.
- A PostgreSQL plan: bundled single-instance PostgreSQL or an external/managed service.
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
  # NEXTAUTH_SECRET, and ENCRYPTION_KEY keys.
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

Create the external Secret before the release, for example through External Secrets, a CSI driver, Sealed Secrets, or your platform's approved controller. With `postgresql.enabled: false`, it must contain `DATABASE_URL`, `NEXTAUTH_SECRET`, and `ENCRYPTION_KEY`. The URL should be the complete percent-encoded PostgreSQL URI, including TLS, PgBouncer, and provider options. With bundled PostgreSQL, also provide `POSTGRES_USER` and `POSTGRES_PASSWORD`. Key names can be changed under `secrets.keys`.

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

For bundled PostgreSQL, application DB egress is restricted to the PostgreSQL pod and the PostgreSQL pod cannot initiate outbound connections. When `postgresql.enabled: false`, TCP egress on `database.port` is permitted to external destinations so managed DB connectivity is not accidentally blocked. Keep that value aligned with the port in `DATABASE_URL`, and tighten destinations through your platform policy/CIDR controls when the target is known.

DNS permits UDP and TCP 53; HTTPS egress is required by common OIDC, webhook, notification, and integration flows.

## Startup and migrations

The `1.4.0` image and later run `prisma migrate deploy` before starting the server. They retry migration failures and may run the packaged recovery helper between attempts. If migrations still fail, the container exits non-zero.

A startup probe gives migrations and cold starts up to approximately five minutes before liveness checks can restart the container. After startup:

- `/api/health` is used for liveness;
- `/api/health?mode=readiness` is used for readiness.

The chart currently performs migrations in the application startup path rather than a dedicated Helm hook Job. Prisma migration locking protects schema application, but upgrades should still be monitored closely when several replicas start together.

## Scaling

The chart defaults to two fixed replicas (`replicaCount: 2`) so a basic install does not depend on metrics-server. HPA is disabled by default. Enable `autoscaling.enabled` only when the cluster exposes the required resource metrics (or adapt the chart for your autoscaler); its configured range is two to ten replicas.

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
  --set-string image.digest='sha256:<tested-manifest-digest>' \
  --wait --timeout 10m
```

`image.digest` renders `repository@sha256:...` and takes precedence over `image.tag`. For a normal immutable version tag, leave `image.digest` empty and set `image.tag` instead.

`helm rollback` changes Kubernetes resources; it does not reverse Prisma migrations. Confirm old-image/schema compatibility before rolling the application back, or restore the verified pre-upgrade database when a data rollback is required.

## Related topics

- [Kubernetes](./kubernetes)
- [Kustomize](./kustomize)
- [Docker Compose](./docker)
- [Configuration reference](../getting-started/configuration)
- [Maintenance](./maintenance)
