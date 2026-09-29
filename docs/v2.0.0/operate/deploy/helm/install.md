---
title: Complete an OpsKnight Helm installation
description: Create namespace and secrets, render, install, watch migration and workloads, complete setup, and validate production behavior.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Helm install, migration job, production values]
reader:
  status: READER_COMPLETE
  task: Install and validate OpsKnight from zero with Helm.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/helm/opsknight/Chart.yaml, deploy/kubernetes/helm/opsknight/templates/, deploy/kubernetes/helm/opsknight/values.schema.json]
---

# Complete an OpsKnight Helm installation

## Prerequisites

Complete the [Kubernetes prerequisites](../kubernetes/prerequisites), [secrets](../kubernetes/secrets), [database](../kubernetes/database), and ingress/TLS plan. Obtain a tested immutable application digest.

## Prepare production values

Create namespace and the externally managed Secret, then create `values.production.yaml` with:

- exact image digest;
- `secrets.existingSecret` and correct key mappings;
- `migrations.job.enabled: true`;
- public HTTPS origins;
- selected integrated/split topology;
- bundled or external database and connection ceiling;
- replicas, resources, probes, PDB, and spread rules;
- ingress/TLS and NetworkPolicy;
- monitoring configuration.

Use [Integrated values](./integrated) or [Split values](./split), then validate:

```sh
helm lint deploy/kubernetes/helm/opsknight -f values.production.yaml
helm template opsknight deploy/kubernetes/helm/opsknight \
  --namespace opsknight -f values.production.yaml > rendered.yaml
kubectl apply --dry-run=server -f rendered.yaml
```

## Install the release

```sh
helm upgrade --install opsknight deploy/kubernetes/helm/opsknight \
  --namespace opsknight \
  --create-namespace \
  --values values.production.yaml \
  --wait --timeout 15m
```

Watch the hook and workloads in another terminal:

```sh
kubectl -n opsknight get job,pod,deployment,statefulset -w
```

The migration Job must complete with exit code zero. All selected workloads must become Ready. A failed hook means the release is not installable; do not bypass it.

## Verify the installation

1. `helm -n opsknight status opsknight` reports a deployed release.
2. The migration Job completed successfully.
3. Every selected Pod is Ready and integrated/split ownership is exclusive.
4. Public readiness returns success.
5. Open `/setup` and create the first administrator.
6. Create a service, on-call/escalation configuration, and a test incident.
7. Verify notification, acknowledgement, resolution, and status projection.
8. Complete the [Kubernetes production checklist](../kubernetes/production-checklist).

## Operate it in production

Store the chart/source revision and values securely, monitor hook/rollout/role/database/provider signals, and make changes through reviewed values. Do not use `helm upgrade --reuse-values` as a substitute for an explicit current values file.

## Troubleshooting

**Schema/lint failure:** correct the rejected value or type; do not remove schema validation.

**Migration hook fails:** inspect the hook Job logs/events, direct database route, TLS/CA, privileges, and release migration requirements. Keep workloads stopped.

**Helm times out:** inspect Pods and events; determine whether the issue is scheduling, storage, image pull, migration, or readiness before increasing timeout.

**Release deploys but public access fails:** inspect Service endpoints, ingress, NetworkPolicy, TLS, and public URL configuration.

## Change or remove the installation

Use [Helm upgrade](./upgrade) for changes. Before uninstalling, take a verified backup and understand PVC retention. `helm uninstall` is not a database backup and does not make destructive storage cleanup safe.

## Next steps

- [Configure ingress](./ingress)
- [Production checklist](../kubernetes/production-checklist)
- [Upgrade Helm](./upgrade)

