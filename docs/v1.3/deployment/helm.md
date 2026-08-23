---
order: 3
title: Helm deployment
description: Deploy the shipped Helm chart with explicit secrets, PostgreSQL choices, and migration safeguards
---

# Helm deployment

The repository ships its chart at `helm/opsknight`. It creates the application Deployment, Service, ConfigMap, Secret, optional Ingress, HPA, PodDisruptionBudget, NetworkPolicy, and optionally a PostgreSQL StatefulSet. Review the rendered manifests before applying them to production.

## Prerequisites

- A Kubernetes cluster reachable by `kubectl` and Helm 3.
- A container image repository and immutable application tag that you have tested.
- An ingress controller and TLS certificate strategy if the service is public.
- A PostgreSQL plan: the chart's bundled PostgreSQL or an external PostgreSQL service.
- Secure values for `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, and the database password.

The default chart values contain example secrets and an example database password. They are not production-safe.

## Prepare a production values file

Keep the production values file out of source control and restrict access to it. The chart renders `secrets.nextauthSecret`, `secrets.encryptionKey`, and `postgresql.password` into a Kubernetes Secret; anyone who can read that Secret or the Helm release data can obtain them.

```yaml
# values.production.yaml
image:
  repository: ghcr.io/opsknight-labs/opsknight
  tag: '<tested-immutable-tag>'

config:
  nextauthUrl: 'https://ops.example.com'

secrets:
  nextauthSecret: '<generated-session-secret>'
  encryptionKey: '<64-hex-character-key>'

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

postgresql:
  enabled: false
  host: 'postgresql.database.svc.cluster.local'
  port: '5432'
  database: opsknight_db
  username: opsknight
  password: '<database-password>'
```

Generate the encryption key with `openssl rand -hex 32`. It must stay available for the lifetime of data encrypted by OpsKnight. See [Encryption](../security/encryption) before setting or rotating it.

The chart does not currently provide an `existingSecret` setting. Do not pass secret values through `--set` in a shared shell history or CI log. Use an access-controlled values file or render/apply through your approved secrets-delivery process, then confirm how your Helm storage backend protects release values.

## Render and install

Run these checks from a checkout of the same application version as the image:

```bash
helm lint helm/opsknight --values values.production.yaml

helm template opsknight helm/opsknight \
  --namespace opsknight \
  --values values.production.yaml > opsknight-rendered.yaml

kubectl apply --dry-run=server -f opsknight-rendered.yaml
```

Inspect the rendered Secret, `DATABASE_URL`, image tag, ingress host/TLS, probe paths, resource limits, and PostgreSQL endpoint. Then install:

```bash
helm upgrade --install opsknight helm/opsknight \
  --namespace opsknight \
  --create-namespace \
  --values values.production.yaml \
  --wait --timeout 10m
```

The chart exposes `/api/health` for liveness and `/api/health?mode=readiness` for readiness. Check the application pods and rollout status after installation:

```bash
kubectl rollout status deployment/opsknight -n opsknight --timeout=10m
kubectl get pods,svc,ingress -n opsknight
kubectl logs deployment/opsknight -n opsknight --tail=200
```

The generated resource name can differ when `fullnameOverride` or `nameOverride` is set; use `helm status opsknight -n opsknight` to identify it.

## PostgreSQL choice

With `postgresql.enabled: true`, the chart deploys a single PostgreSQL StatefulSet with a PVC. This is suitable only when its storage class, backup process, availability model, and upgrade process meet your requirements. The chart does not turn that database into a managed HA or backup service.

For external PostgreSQL, set `postgresql.enabled: false` and provide `host`, `port`, `database`, `username`, and `password`. The chart constructs `DATABASE_URL` from those values. Validate network policy, TLS requirements, connection limits, and restore ownership with the database operator before deployment.

## Scaling and traffic

Autoscaling is enabled by default, with two to ten replicas and CPU/memory targets. When it is enabled, `replicaCount` does not control the Deployment replica count. Confirm that your cluster has metrics-server support before relying on HPA decisions.

The chart defaults to a PodDisruptionBudget with one available pod. NetworkPolicy is disabled by default; if you enable it, verify that the policy permits database, DNS, ingress-controller, and any required egress traffic.

Use HTTPS at the ingress. `config.nextauthUrl` must be the externally reachable application URL; a mismatch breaks sign-in callbacks and links in notifications.

## Migrations, upgrades, and rollback

The container entrypoint attempts `prisma migrate deploy` on startup, up to three times. If attempts fail, it logs the failure and starts the application anyway, so a successful rollout does not prove migrations succeeded. The Helm chart does not create a dedicated pre-upgrade migration Job.

Before each upgrade:

1. Record the current chart, image, configuration, and database schema state.
2. Take and verify a database backup that can be restored with the matching encryption key.
3. Render the new version and review manifest/value changes.
4. Upgrade with a tested immutable image tag.
5. Check migration logs, readiness, authentication, a synthetic incident, and notification delivery.

```bash
helm upgrade opsknight helm/opsknight \
  --namespace opsknight \
  --values values.production.yaml \
  --set image.tag="<tested-immutable-tag>" \
  --wait --timeout 10m
```

Do not use `helm rollback` as a database rollback plan. A previous image may be incompatible with a migrated schema. If a release fails, first determine whether a safe application rollback is compatible with the current schema; use the verified database recovery point when a data rollback is required.

## Related topics

- [Docker Compose deployment](./docker)
- [Kubernetes deployment](./kubernetes)
- [Maintenance](./maintenance)
- [Monitoring](./monitoring)
- [Configuration reference](../getting-started/configuration)
