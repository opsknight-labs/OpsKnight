---
order: 2
title: Kubernetes deployment
description: Deploy and customize the raw Kubernetes manifests shipped with OpsKnight v1.3.
---

# Kubernetes deployment

OpsKnight ships a raw Kubernetes base in `k8s/`. It includes the application Deployment and Service, an optional-style in-cluster PostgreSQL topology, Ingress, HPA, PodDisruptionBudget, NetworkPolicy, ServiceAccount, ConfigMap, and Secret. `k8s/kustomization.yaml` is the supported entry point for rendering the complete base.

Do not apply the base unchanged to production. The checked-in values intentionally contain example credentials, `localhost` URLs, an example ingress host, a floating application image tag, and a single PostgreSQL instance.

## Prerequisites

- Kubernetes 1.24+ and `kubectl`.
- A default StorageClass, or a storage-class customization for the PostgreSQL volume.
- An ingress controller if the application is exposed through Ingress.
- metrics-server if you keep the supplied HPA enabled.
- A TLS/certificate strategy for a public deployment.
- Secure `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, and database credentials.

## Render before applying

Prefer Kustomize rather than applying every file individually:

```bash
kubectl kustomize k8s > /tmp/opsknight.yaml
kubectl apply --dry-run=server -f /tmp/opsknight.yaml
```

Review the rendered image, Secret, public URLs, ingress host/TLS settings, NetworkPolicy, resource limits, and database topology before applying it.

For an evaluation environment:

```bash
kubectl apply -k k8s
kubectl -n opsknight rollout status deployment/opsknight-app --timeout=10m
kubectl -n opsknight get pods,svc,ingress,pvc
kubectl -n opsknight logs deployment/opsknight-app --tail=200
```

## Required production customization

At minimum, replace:

- `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` in `k8s/configmap.yaml` with the same public HTTPS origin;
- every placeholder in `k8s/secret.yaml`;
- `ghcr.io/opsknight-labs/opsknight:latest` with a tested immutable release tag or digest;
- `opsknight.example.com`, ingress class, certificate issuer/annotations, and TLS secret;
- storage capacity/class and backup handling;
- HPA/resource settings based on your cluster and load test;
- NetworkPolicy selectors/CIDRs for your ingress controller and database.

The ServiceAccount token is not mounted by default because OpsKnight does not need Kubernetes API credentials.

## PostgreSQL

### Bundled PostgreSQL

The base deploys one `postgres:15-alpine` StatefulSet. Its data is persisted by the StatefulSet's `volumeClaimTemplates`; there is no separate standalone PVC manifest. The governing PostgreSQL Service is headless.

The container runs as the Alpine image's `postgres` uid/gid (`70`) and mounts writable storage for the database, `/var/run/postgresql`, and `/tmp`. Do not change the numeric user without verifying the selected PostgreSQL image.

The bundled database is suitable only when a single PostgreSQL instance, your StorageClass, backup process, and recovery plan meet your requirements. It is not an HA PostgreSQL operator.

### Managed or external PostgreSQL

For RDS, Cloud SQL, Azure Database for PostgreSQL, a database in another namespace, PgBouncer, or another external endpoint, patch the application `DATABASE_URL` with the complete URI. A full URI is preferred when credentials require percent-encoding or when TLS/query parameters are required.

Example Kustomize patch:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: opsknight-app
  namespace: opsknight
spec:
  template:
    spec:
      containers:
        - name: opsknight-app
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: opsknight-external-database
                  key: DATABASE_URL
```

The supplied application NetworkPolicy permits TCP/5432 to external destinations so a managed PostgreSQL endpoint is not silently blocked. For production, narrow that rule to the actual database CIDR/namespace when your platform provides a stable target.

If you remove the bundled PostgreSQL resources, also remove or patch their ConfigMap/Secret values as appropriate for your overlay.

## Ingress and network policy

The raw Ingress uses `ingressClassName: nginx` and nginx annotations but does not depend on the high-risk `configuration-snippet` annotation. OpsKnight itself emits its application security headers.

The base NetworkPolicy allows application ingress from a namespace labeled:

```text
kubernetes.io/metadata.name=ingress-nginx
```

Change this selector when your ingress controller runs elsewhere. DNS egress allows UDP and TCP 53; HTTPS egress is allowed for OIDC, notifications, webhooks, and other external integrations.

The checked-in cert-manager annotation is only an example. Remove or replace it if your cluster does not use that issuer.

## Startup, migrations, and health

The container runs `prisma migrate deploy` before starting the Next.js server. Migration attempts are retried; if they still fail, the container exits non-zero instead of serving against an unknown schema.

The Deployment has a startup probe with a five-minute budget so migrations/cold start are not interrupted by liveness checks. After startup:

- liveness uses `/api/health`;
- readiness uses `/api/health?mode=readiness`.

A failed migration therefore results in a failed/restarting pod and visible rollout failure rather than a deceptively running application.

## Scaling

The supplied HPA targets `opsknight-app`, keeps two to ten replicas, and uses CPU/memory utilization. Without metrics-server, the HPA cannot calculate those targets. Disable or replace it if your cluster uses a different autoscaling system.

Database connection limits are per application process. When increasing replicas, verify the aggregate PostgreSQL connection budget and the behavior of OpsKnight's internal scheduled work under the chosen replica count.

## Upgrade

Pin an immutable application version, back up PostgreSQL and the matching encryption key, render/diff the new configuration, then apply it:

```bash
kubectl diff -k deploy/overlays/production
kubectl apply -k deploy/overlays/production
kubectl -n opsknight rollout status deployment/opsknight-app --timeout=10m
kubectl -n opsknight logs deployment/opsknight-app --tail=200
```

A Kubernetes rollout rollback does not undo Prisma database migrations. Confirm schema compatibility before rolling the image back; restore the verified pre-upgrade database when a data rollback is required.

## Verification

After every fresh install or upgrade, verify:

1. migration completion in startup logs;
2. readiness and ingress/TLS;
3. login and callback URLs;
4. a database write;
5. an inbound test event/incident;
6. configured notification/integration delivery;
7. PostgreSQL persistence after a pod restart.

## Related topics

- [Kustomize](./kustomize)
- [Helm](./helm)
- [Docker Compose](./docker)
- [Configuration reference](../getting-started/configuration)
- [Monitoring](./monitoring)
