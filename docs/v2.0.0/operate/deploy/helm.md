---
title: Deploy with Helm
description: Install the schema-validated OpsKnight chart and choose an integrated or split profile.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Helm install, OpsKnight chart, Helm values, Kubernetes deployment]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [deploy/kubernetes/helm/opsknight/Chart.yaml, deploy/kubernetes/helm/opsknight/values.schema.json]
---

# Deploy with Helm

Choose Helm when the chart and its values schema are the deployment contract.
Keep secrets in an existing Kubernetes Secret, pin image digests, and render the
chart in CI before promotion.

## Deploy

1. Start from the integrated or split example values.
2. Configure ingress, public origin, PostgreSQL, secrets, resources, probes,
   NetworkPolicies, and disruption budgets.
3. For PgBouncer, use Split mode and structured PostgreSQL values; external
   PostgreSQL requires verified TLS and the configured CA secret.
4. Run `helm lint` and render the exact release values.
5. Install, wait for migration completion, then verify readiness and each role.

Reject a values change that exceeds the calculated database connection budget.
Use [Build a capacity and connection budget](../capacity/sizing/) before raising
replica or pool counts.

