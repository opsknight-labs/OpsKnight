---
order: 4
title: Kustomize
description: Render, customize, validate, and apply the integrated or split OpsKnight Kubernetes runtime.
---

# Kustomize

`deploy/kubernetes/kustomize/base/kustomization.yaml` is the entry point for the raw Kubernetes shared base. Together with `deploy/kubernetes/kustomize/profiles/integrated`, it composes the namespace, application, PostgreSQL StatefulSet and governing Service, application Service, ingress, HPA, NetworkPolicy, ServiceAccount, ConfigMap, Secret, and PodDisruptionBudget. PostgreSQL storage is created by the StatefulSet volume claim template; the base no longer allocates an unused standalone PVC. The existing ClusterIP mode of the PostgreSQL Service is preserved so upgrades do not attempt an immutable Service conversion.

Three profiles make the runtime contract explicit:

- `deploy/kubernetes/kustomize/profiles/integrated` renders the integrated application topology from the shared base;
- `deploy/kubernetes/kustomize/profiles/split` renders web, maintenance scheduler, general worker, critical worker, bulk worker, and status projector roles;
- `deploy/kubernetes/kustomize/profiles/split-pgbouncer` adds a two-replica transaction-pooling tier used only by web pods.

The PgBouncer profile routes web runtime traffic to PgBouncer TCP/6432. A narrowly selected web-to-PostgreSQL TCP/5432 rule remains for startup schema management through `DIRECT_DATABASE_URL`; PgBouncer also receives PostgreSQL TCP/5432 egress, plus DNS for resolving the Service hostname. Kubernetes NetworkPolicies are additive, so production overlays should preserve these selected pod destinations rather than add broad database egress.

The web pod still receives `DIRECT_DATABASE_URL` for startup schema management. The entrypoint uses that direct PostgreSQL path for Prisma migrations and index installation, then restores the pooled `DATABASE_URL` before starting the web runtime. Preserve both environment entries when customizing the PgBouncer overlay.

The checked-in `deploy/kubernetes/kustomize/base` contains the common resources shared by those profiles. Do not omit the general worker: the specialized lanes intentionally do not claim ordinary operational background jobs. The split manifests intentionally use the non-published marker tag `split-runtime-image-required`; a production overlay must replace it with a tested tag or digest containing the split roles. This prevents the older integrated compatibility image from being started with unsupported role names.

Moving an existing installation from the integrated profile to a split profile changes the Service selector to `opsknight-role: web`. Existing integrated pods lack that label. Plan this as a controlled one-time endpoint cutover or pre-stage a compatible serving label; a Deployment `maxUnavailable: 0` setting does not by itself make a Service-selector migration interruption-free.

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

For example, pin the split-compatible image in the overlay:

```yaml
images:
  - name: ghcr.io/opsknight-labs/opsknight
    newName: ghcr.io/opsknight-labs/opsknight
    digest: sha256:<tested-split-runtime-manifest-digest>
```

For Prometheus Operator, add the optional `deploy/kubernetes/kustomize/monitoring/servicemonitor.yaml` from the production
overlay, inject `PROMETHEUS_SCRAPE_TOKEN` into the application from a dedicated Secret, and allow the
monitoring source through NetworkPolicy. The monitor is intentionally excluded from the base so
clusters without the `ServiceMonitor` CRD remain deployable. See [Prometheus metrics](./prometheus).

Use your platform secret controller/store for production values. Do not commit rendered production Secrets.

## Render and validate

```bash
kubectl kustomize deploy/overlays/production > /tmp/opsknight-rendered.yaml
kubectl apply --server-side --dry-run=server -f /tmp/opsknight-rendered.yaml
```

Before creating a production overlay, render the shipped contracts directly:

```bash
kubectl kustomize deploy/kubernetes/kustomize/base
kubectl kustomize deploy/kubernetes/kustomize/profiles/integrated
kubectl kustomize deploy/kubernetes/kustomize/profiles/split
kubectl kustomize deploy/kubernetes/kustomize/profiles/split-pgbouncer
```

Review the rendered image, Secrets, `DATABASE_URL`, public URLs, ingress, NetworkPolicy, storage, and health probes before applying.

The shipped split pools are bounded to a potential 58 database connections at two replicas per role. This includes either 20 direct web connections or PgBouncer's 20 normal backend connections, plus 38 direct scheduler/worker connections. The generic split profile does not include `web-hpa.yaml`; add it through a capacity-planned production overlay if required. Recalculate `maxReplicas × pool size` for autoscaled roles and `replicas × pool size` for fixed roles, and retain separate PostgreSQL headroom for migrations and operations. A managed PostgreSQL service is recommended for sustained production split deployments.

Split role replicas use a hard `kubernetes.io/hostname` spread constraint and therefore require at least two schedulable nodes. PDBs govern voluntary disruption only; node/zone survival depends on actual failure-domain placement. Add a `topology.kubernetes.io/zone` constraint in multi-zone production overlays.

## External database overlays & special-character credentials

The shipped base manifests support pre-formed `DATABASE_URL` and `DIRECT_DATABASE_URL` keys in `opsknight-secrets`. When passwords contain reserved URI characters (`@`, `:`, `/`, `?`, `#`), provide the fully percent-encoded URI directly via Secret rather than relying on inline shell variable substitution (`postgresql://$(POSTGRES_USER):$(POSTGRES_PASSWORD)@...`).

Deploying an external managed PostgreSQL database with Kustomize requires a production overlay that configures the following four components:
1. **Secrets**: Supply `DATABASE_URL` and `DIRECT_DATABASE_URL` in `opsknight-secrets` with connection pool limits, `sslmode=verify-full`, and URI-encoded credentials.
2. **PgBouncer Backend**: In `profiles/split-pgbouncer`, update `pgbouncer-configmap.yaml` to route to the external database host and port instead of `opsknight-postgres-service:5432`.
3. **Egress NetworkPolicy**: Update `worker-network-policies.yaml` and `pgbouncer-network-policy.yaml` egress rules from `podSelector: { app: opsknight-postgres }` to `ipBlock` CIDRs allowing traffic to your external database endpoints.
4. **Private CA Certificates**: Mount your enterprise CA bundle into `/etc/ssl/certs/custom-ca.crt` with `NODE_EXTRA_CA_CERTS` and `SSL_CERT_FILE` in PgBouncer and all worker/scheduler pods using direct database connections.

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
