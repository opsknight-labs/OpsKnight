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

```sh
helm status opsknight -n opsknight
helm get values opsknight -n opsknight --all
helm get manifest opsknight -n opsknight > /tmp/opsknight-rendered.yaml
kubectl -n opsknight get pods,jobs
kubectl -n opsknight get events --sort-by=.lastTimestamp
```

Healthy output shows a deployed release, one intended runtime topology, a completed migration Job, and ready Pods without repeating warning events.

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

```sh
kubectl -n opsknight describe job -l app.kubernetes.io/component=migration
kubectl -n opsknight logs job/opsknight-migration --all-containers=true
kubectl -n opsknight get events --sort-by=.lastTimestamp | tail -50
```

**Recovery:** keep workloads stopped, correct the cause, delete/recreate only the failed hook according to Helm procedure, and rerun upgrade.

**Verify:** hook completes once before workloads roll.

## Workload rollout stalls

**Check:** Pod Pending/CrashLoop, image pull, quota/resources, PVC, Secret keys, probes, NetworkPolicy, and database readiness.

```sh
kubectl -n opsknight get pods -o wide
kubectl -n opsknight describe pod <pod-name>
kubectl -n opsknight logs <pod-name> --all-containers=true --previous
kubectl -n opsknight rollout status deployment/<deployment> --timeout=10m
```

`Pending` with scheduling events points to capacity/placement; `ImagePullBackOff` to image/auth; `CrashLoopBackOff` plus previous logs to application/configuration; failing readiness with a running process to dependency/schema/probe health.

**Recovery:** fix the specific platform or configuration failure and resume the same release revision.

**Verify:** all selected Deployments reach Available and role work advances.

## Release is deployed but public access fails

**Check:** Service endpoints, ingress class/rules/TLS, NetworkPolicy, public URLs, proxy headers, and Web readiness.

**Recovery:** correct the failing routing layer and roll Web if environment changed.

**Verify:** readiness, sign-in, SSE, and signed webhook work through public HTTPS.

## Next steps

- [Kubernetes troubleshooting](../kubernetes/troubleshooting)
- [Rollback](../../upgrades/rollback)
