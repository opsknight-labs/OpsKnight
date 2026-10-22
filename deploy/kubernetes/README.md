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
- `profiles/split/` — Dedicated `web`, `scheduler` (`maintenance` profile), `general-worker`, `critical-worker`, `bulk-worker`, `runbook-worker`, and `status-projector` Deployments, each with matching PDB and NetworkPolicy coverage.
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

### 2.1 authentication compatibility cutover

Application Deployments use `Recreate`. On upgrade a read-only pre-upgrade Job
verifies all integrated/split application Deployments are scaled to zero and their
pods have fully stopped before the migration hook runs. Schedule a maintenance
window, stop ingress, drain workers and suspend external controllers. Keep
PostgreSQL/PgBouncer running. HPA-managed web Deployments need their recorded replica
count restored only after the new template is applied (`--wait=false` permits that
controlled sequence). Never resume old binaries on a migrated database or treat
`--atomic` as database rollback. See
[Upgrade existing SSO](../../docs/v2.1.0/guides/identity/upgrade-existing-sso.md).

When upgrading an older Helm release whose PgBouncer Deployment lacks the
`app.kubernetes.io/component=pgbouncer` label, verify its container is the configured
PgBouncer image and add that metadata label before running the upgrade. The
pre-upgrade guard executes before Helm applies updated Deployment metadata:

```bash
kubectl -n opsknight get deployment opsknight-pgbouncer -o jsonpath='{.spec.template.spec.containers[*].image}'
kubectl -n opsknight label deployment opsknight-pgbouncer app.kubernetes.io/component=pgbouncer --overwrite
```

Use the actual namespace and Helm-generated Deployment name. Keep application
Deployments stopped until migration and new runtime readiness complete; do not
label application Deployments as infrastructure or disable the cutover guard.
