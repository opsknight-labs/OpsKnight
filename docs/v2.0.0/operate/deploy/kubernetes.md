---
title: Deploy on Kubernetes
description: Deploy OpsKnight using the supported Helm or Kustomize assets.
type: deployment
product_area: deployment
audience: [operator, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - deploy/kubernetes/helm/opsknight/values.schema.json
    - deploy/kubernetes/kustomize/base/kustomization.yaml
---

# Deploy on Kubernetes

Choose Helm for schema-validated configuration or Kustomize for overlay-driven
manifests. Store secrets outside committed values, configure the external origin
and proxy trust boundary, and ensure only the migration job owns schema changes.

Validate ServiceAccount scope, NetworkPolicy, disruption budget, probes,
resources, storage, ingress, and database connectivity. Wait for migrations,
then readiness, then workers and the status projector. Scale only runtime roles
whose queue ownership and database budget permit it.

