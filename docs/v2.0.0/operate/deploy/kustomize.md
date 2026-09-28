---
title: Deploy with Kustomize
description: Build OpsKnight Kubernetes manifests from maintained profiles and environment overlays.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Kustomize, GitOps deployment, Kubernetes overlays, split PgBouncer]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [deploy/kubernetes/kustomize/base/kustomization.yaml, deploy/kubernetes/kustomize/profiles/]
---

# Deploy with Kustomize

Choose Kustomize when GitOps owns rendered manifests and environment overlays.
Use the maintained `integrated`, `split`, or `split-pgbouncer` profile as the
base; do not duplicate runtime ownership into an unrelated overlay.

## Deploy

1. Select the profile matching the [deployment decision](../capacity/choose-deployment/).
2. Add an environment overlay for image digest, ingress, resources, replicas,
   storage, secrets, and policy differences.
3. Keep secret values outside Git and reference the platform Secret.
4. Run `kubectl kustomize` and policy validation in CI.
5. Apply through GitOps, wait for migration completion, and verify each role.

For Split + PgBouncer, web uses the pooled URL while migrations and background
roles retain direct PostgreSQL access. Recalculate the connection budget after
every replica or pool change.
