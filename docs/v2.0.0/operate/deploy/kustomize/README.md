---
title: Install OpsKnight with Kustomize
description: Build reviewed production manifests from maintained OpsKnight profiles and environment-owned overlays.
type: concept
product_area: deployment
audience: [operator, administrator]
keywords: [Kustomize, overlays, GitOps]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/kustomize/]
---

# Install OpsKnight with Kustomize

Use Kustomize when the platform team owns manifests, environment overlays, and GitOps promotion. Keep a maintained profile as the base and express environment differences as patches; do not fork rendered YAML.

## Installation path

1. Review [profiles and overlays](./overlays).
2. Complete the [installation](./install).
3. Choose [integrated](./integrated) or [split](./split).
4. Add [external PostgreSQL](./external-postgres) when required.
5. Complete public HTTPS [initial setup](../../../start/initial-setup) and verify [Application URL and host routing](../application-url-and-host-routing).
6. Complete the [Kubernetes production checklist](../kubernetes/production-checklist).
7. Adopt the [GitOps lifecycle](./gitops).
8. Use [troubleshooting](./troubleshooting) for render, migration, sync, and rollout failures.

The runtime profiles intentionally do not continuously reconcile a Job. Use the maintained `deploy/kubernetes/kustomize/migration-job.yaml` as the one-shot migration owner, and require its completion before workload rollout.
