---
title: Install OpsKnight with Helm
description: Follow the schema-validated Helm path for integrated or split OpsKnight on Kubernetes.
type: concept
product_area: deployment
audience: [operator, administrator]
keywords: [Helm, Kubernetes, values, installation]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/helm/opsknight/]
---

# Install OpsKnight with Helm

Helm is the packaged Kubernetes path. The chart supports integrated or split runtime, bundled or external PostgreSQL, split-mode PgBouncer, ingress, migration hooks, disruption budgets, NetworkPolicy, autoscaling, and Prometheus Operator discovery.

## Installation path

1. Complete [Kubernetes prerequisites](../kubernetes/prerequisites).
2. Review [Helm values](./values) and create production secrets.
3. Follow the complete [installation](./install).
4. Choose [integrated](./integrated) or [split](./split).
5. Add [external PostgreSQL](./external-postgres), [PgBouncer](./pgbouncer), and [ingress](./ingress) when required.
6. Use [upgrade](./upgrade) and [troubleshooting](./troubleshooting) for lifecycle operations.

Do not use chart placeholder secrets or mutable images in production.

