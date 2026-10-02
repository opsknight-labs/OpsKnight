---
title: Design OpsKnight Kustomize overlays
description: Select maintained profiles and patch images, secrets, configuration, ingress, database, policy, and resources without forking manifests.
type: reference
product_area: deployment
audience: [operator, administrator]
keywords: [Kustomize overlays, profiles, patches]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/kustomize/base/, deploy/kubernetes/kustomize/profiles/]
---

# Design OpsKnight Kustomize overlays

## Maintained profiles

- `profiles/integrated`: shared base, integrated Deployment, and HPA.
- `profiles/split`: six runtime Deployments, role PDBs/policies, Web Service, and Web HPA.
- `profiles/split-pgbouncer`: split plus PgBouncer resources and Web database patch.
- `monitoring/servicemonitor.yaml`: optional Prometheus Operator resource, not automatically included.

## Production overlay contents

A production overlay should patch the immutable application image, exact public URLs, ingress/TLS, resources/replicas, storage, policy, and database. It should delete the placeholder Secret and, for external PostgreSQL, bundled database resources. A secret controller creates the expected Secret separately.

Use targeted patches by kind/name so changing Web cannot accidentally mutate every Deployment. Decide whether an HPA or GitOps owns replica count; do not let both fight.

## Render contract

```sh
kubectl kustomize deploy/environments/production > rendered.yaml
kubectl apply --server-side --dry-run=server -f rendered.yaml
kubectl diff -k deploy/environments/production
```

Inspect images, resource inventory, Secrets, Services, ingress, StatefulSets, Deployments, PDBs, NetworkPolicies, and environment/volume sources. Exactly one topology must render.

## Related guides

- [Install with Kustomize](./install)
- [GitOps lifecycle](./gitops)

