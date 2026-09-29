---
title: Troubleshoot OpsKnight Helm releases
description: Diagnose chart validation, render, migration hook, rollout, secret, database, and ingress failures in Helm deployments.
type: troubleshooting
product_area: deployment
audience: [operator, administrator]
keywords: [Helm troubleshooting, hook failed, values schema]
reader:
  status: READER_COMPLETE
  task: Diagnose and recover a failed Helm install or upgrade.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/helm/opsknight/]
---

# Troubleshoot OpsKnight Helm releases

## Before you begin

Capture `helm status`, `helm get values --all`, `helm get manifest`, Jobs, Pods, events, and failed-container logs. Redact secrets before sharing.

## Values schema or lint fails

**Check:** the exact field/type and allowed enum/range in `values.schema.json`.

**Recovery:** correct the explicit production values; do not remove schema validation.

**Verify:** lint, template, and server dry-run all pass.

## Template renders an unsafe topology

**Check:** runtime mode, integrated/split Deployments, migration Job, database URL sources, image digest, ingress target, and PgBouncer routing.

**Recovery:** correct values before installation.

**Verify:** exactly one ownership model and one direct migration owner render.

## Migration hook fails

**Check:** hook Job logs/events, direct database DNS/TLS/CA/auth/privileges/schema, and image revision.

**Recovery:** keep workloads stopped, correct the cause, delete/recreate only the failed hook according to Helm procedure, and rerun upgrade.

**Verify:** hook completes once before workloads roll.

## Workload rollout stalls

**Check:** Pod Pending/CrashLoop, image pull, quota/resources, PVC, Secret keys, probes, NetworkPolicy, and database readiness.

**Recovery:** fix the specific platform or configuration failure and resume the same release revision.

**Verify:** all selected Deployments reach Available and role work advances.

## Release is deployed but public access fails

**Check:** Service endpoints, ingress class/rules/TLS, NetworkPolicy, public URLs, proxy headers, and Web readiness.

**Recovery:** correct the failing routing layer and roll Web if environment changed.

**Verify:** readiness, sign-in, SSE, and signed webhook work through public HTTPS.

## Next steps

- [Kubernetes troubleshooting](../kubernetes/troubleshooting)
- [Rollback](../../upgrades/rollback)

