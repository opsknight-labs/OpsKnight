---
title: Deploy OpsKnight on Kubernetes
description: Plan a secure production Kubernetes installation and choose Helm or Kustomize packaging.
type: concept
product_area: deployment
audience: [operator, administrator]
keywords: [Kubernetes, Helm, Kustomize, production]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/]
---

# Deploy OpsKnight on Kubernetes

OpsKnight provides two maintained Kubernetes packaging paths: [Helm](../helm/) for schema-validated values and a migration hook, and [Kustomize](../kustomize/) for platform-owned overlays. Both use the same image, runtime roles, database contracts, health endpoints, and public-origin requirements.

## Installation path

1. Complete [cluster prerequisites](./prerequisites).
2. Configure [secrets](./secrets) and the [database](./database).
3. Choose [integrated](./integrated) or [split](./split) runtime.
4. Configure [ingress and TLS](./ingress) and [NetworkPolicy](./network-policy).
5. Install with [Helm](../helm/) or [Kustomize](../kustomize/).
6. Complete the [production checklist](./production-checklist).

Use [Kubernetes troubleshooting](./troubleshooting) for Pod, migration, readiness, database, policy, URL, and queue failures.

