# OpsKnight Kubernetes Deployments

OpsKnight ships two first-class Kubernetes packaging formats under `deploy/kubernetes/`:

1. **Helm Chart**: `deploy/kubernetes/helm/opsknight`
2. **Kustomize Profiles**: `deploy/kubernetes/kustomize`

Both deploy the same Next.js runtime and PostgreSQL-backed control plane across `integrated`, `split`, and `split + pgbouncer` topologies.

---

## 1. Helm Chart (`deploy/kubernetes/helm/opsknight`)

### Validate & Render

```bash
helm lint deploy/kubernetes/helm/opsknight

# Integrated mode
helm template opsknight deploy/kubernetes/helm/opsknight --namespace opsknight

# Split runtime + PgBouncer (requires a release image built with split-runtime support; 1.4.0 predates split roles)
helm template opsknight deploy/kubernetes/helm/opsknight \
  --namespace opsknight \
  -f deploy/kubernetes/helm/opsknight/examples/values-split-runtime.yaml \
  --set-string image.digest=sha256:<tested-split-runtime-digest>

# Or with an explicit split-runtime release tag:
helm template opsknight deploy/kubernetes/helm/opsknight \
  --namespace opsknight \
  -f deploy/kubernetes/helm/opsknight/examples/values-split-runtime.yaml \
  --set-string image.tag=<tested-split-runtime-tag>
```

### Install / Upgrade

```bash
helm upgrade --install opsknight deploy/kubernetes/helm/opsknight \
  --namespace opsknight \
  --create-namespace \
  -f values.production.yaml
```

---

## 2. Kustomize (`deploy/kubernetes/kustomize`)

### Directory Structure

- `base/` — Shared Namespace, ConfigMap, Secret, ServiceAccount, bundled PostgreSQL StatefulSet & Service, application Service, Ingress, NetworkPolicy, and PodDisruptionBudget.
- `profiles/integrated/` — Single fixed-replica `opsknight-app` Deployment layered over `../../base`; `hpa.yaml` is an opt-in example.
- `profiles/split/` — Dedicated `web`, `scheduler` (`maintenance` profile), `general-worker`, `critical-worker`, `bulk-worker`, and `status-projector` Deployments. Helm deployments also include the isolated `runbook-worker`; Kustomize operators should use the integrated runtime until the matching overlay is enabled.
- `profiles/split-pgbouncer/` — Layers a two-replica `opsknight-pgbouncer` Deployment, Service, PDB, and NetworkPolicy on top of `../split`, routing `opsknight-web` through PgBouncer while keeping `DIRECT_DATABASE_URL` pointed directly at PostgreSQL.
- `monitoring/servicemonitor.yaml` — Optional Prometheus Operator `ServiceMonitor`.

### Render Profiles

```bash
kubectl kustomize deploy/kubernetes/kustomize/base
kubectl kustomize deploy/kubernetes/kustomize/profiles/integrated
kubectl kustomize deploy/kubernetes/kustomize/profiles/split
kubectl kustomize deploy/kubernetes/kustomize/profiles/split-pgbouncer
```

HPA is opt-in in every maintained profile. Add the relevant `hpa.yaml` only
after metrics-server is available and maximum replicas have been included in
the PostgreSQL/PgBouncer connection budget.

### Run Migrations and Apply a Profile

Pin `deploy/kubernetes/kustomize/migration-job.yaml` to the same immutable image
as the runtime. Run that Job to completion before applying either profile; all
checked-in long-running Deployments set `OPSKNIGHT_SKIP_MIGRATIONS=true`.

```bash
# First install only: create the namespace, Secret, and database resources.
kubectl apply -k deploy/kubernetes/kustomize/base
kubectl delete -f deploy/kubernetes/kustomize/migration-job.yaml --ignore-not-found
kubectl apply -f deploy/kubernetes/kustomize/migration-job.yaml
kubectl -n opsknight wait --for=condition=complete job/opsknight-migration --timeout=15m
kubectl apply -k deploy/kubernetes/kustomize/profiles/integrated
```
