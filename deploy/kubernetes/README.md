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
- `profiles/integrated/` — Single `opsknight-app` Deployment and HPA layered over `../../base`.
- `profiles/split/` — Dedicated `web`, `scheduler` (`maintenance` profile), `general-worker`, `critical-worker`, `bulk-worker`, and `status-projector` Deployments, per-role PDBs, and per-role egress NetworkPolicies.
- `profiles/split-pgbouncer/` — Layers a two-replica `opsknight-pgbouncer` Deployment, Service, PDB, and NetworkPolicy on top of `../split`, routing `opsknight-web` through PgBouncer while keeping `DIRECT_DATABASE_URL` pointed directly at PostgreSQL.
- `monitoring/servicemonitor.yaml` — Optional Prometheus Operator `ServiceMonitor`.

### Render Profiles

```bash
kubectl kustomize deploy/kubernetes/kustomize/base
kubectl kustomize deploy/kubernetes/kustomize/profiles/integrated
kubectl kustomize deploy/kubernetes/kustomize/profiles/split
kubectl kustomize deploy/kubernetes/kustomize/profiles/split-pgbouncer
```
