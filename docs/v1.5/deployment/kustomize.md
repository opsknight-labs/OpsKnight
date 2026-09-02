---
order: 4
title: Kustomize
description: Render, customize, validate, and apply the Kubernetes manifests shipped with OpsKnight v1.4.
---

# Kustomize

`k8s/kustomization.yaml` is the entry point for the raw Kubernetes base. It composes the namespace, application, PostgreSQL StatefulSet and governing Service, application Service, ingress, HPA, NetworkPolicy, ServiceAccount, ConfigMap, Secret, and PodDisruptionBudget. PostgreSQL storage is created by the StatefulSet volume claim template; the base no longer allocates an unused standalone PVC. The existing ClusterIP mode of the PostgreSQL Service is preserved so upgrades do not attempt an immutable Service conversion.

## Do not apply the base unchanged in production

The base deliberately contains placeholder secrets, localhost public URLs, a release-pinned application image, an example nginx/cert-manager ingress, and a single in-cluster PostgreSQL instance. Build a production overlay, choose the exact image tag or digest you have tested, and review the complete rendered output.

```text
deploy/overlays/production/
├── kustomization.yaml
├── ingress-patch.yaml
├── app-patch.yaml
├── database-patch.yaml
└── secret input managed outside Git
```

At minimum customize:

- image tag or digest;
- both `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL`;
- database topology/URI and credentials;
- `NEXTAUTH_SECRET` and `ENCRYPTION_KEY`;
- ingress class, host, TLS strategy, and annotations;
- storage class/capacity/backup policy;
- resource requests/limits, replicas, HPA and PDB;
- NetworkPolicy ingress namespace labels and database destinations.

For Prometheus Operator, add the optional `k8s/monitoring/servicemonitor.yaml` from the production
overlay, inject `PROMETHEUS_SCRAPE_TOKEN` into the application from a dedicated Secret, and allow the
monitoring source through NetworkPolicy. The monitor is intentionally excluded from the base so
clusters without the `ServiceMonitor` CRD remain deployable. See [Prometheus metrics](./prometheus).

Use your platform secret controller/store for production values. Do not commit rendered production Secrets.

## Render and validate

```bash
kubectl kustomize deploy/overlays/production > /tmp/opsknight-rendered.yaml
kubectl apply --server-side --dry-run=server -f /tmp/opsknight-rendered.yaml
```

Review the rendered image, Secrets, `DATABASE_URL`, public URLs, ingress, NetworkPolicy, storage, and health probes before applying.

## External database overlays

The base application constructs a URI for its bundled PostgreSQL. For managed PostgreSQL, patch the `DATABASE_URL` environment entry to read a complete URI from your secret system. This supports TLS parameters, PgBouncer, provider options, and percent-encoded credentials without reconstructing the URI from separate fields.

The raw NetworkPolicy allows TCP/5432 to external destinations so an external database is not accidentally blocked. Narrow that rule to your known database CIDR/namespace in the production overlay.

## Apply and observe

```bash
kubectl apply -k deploy/overlays/production
kubectl -n opsknight rollout status deployment/opsknight-app --timeout=10m
kubectl -n opsknight get pods,svc,ingress,pvc
kubectl -n opsknight logs deployment/opsknight-app --tail=200
```

The `1.4.0` image and later perform Prisma migrations before starting and exit non-zero when recovery cannot complete. The startup probe protects a legitimate long migration/cold start from liveness restarts. Verify the selected release behavior, migration completion, and `/api/health?mode=readiness`, then test login, a write, and an incident flow.

## Update and rollback

Commit overlay changes, take a verified database backup, change the pinned image reference, render/diff, and apply. Keep the previous manifest and image digest.

Kubernetes rollout rollback does not undo PostgreSQL migrations. Confirm schema compatibility before reverting an image; use the pre-upgrade database recovery point when data rollback is required.

## Related topics

- [Kubernetes](./kubernetes)
- [Deployment](./README)
- [Helm](./helm)
- [Monitoring](./monitoring)
- [Prometheus metrics](./prometheus)
- [Configuration reference](../getting-started/configuration)
