---
title: Run integrated OpsKnight on Kubernetes
description: Configure and validate the integrated runtime topology on Kubernetes without duplicating background ownership.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Kubernetes integrated runtime, replicas, migration]
reader:
  status: READER_COMPLETE
  task: Install and validate integrated OpsKnight on Kubernetes.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/helm/opsknight/templates/deployment.yaml, deploy/kubernetes/kustomize/profiles/integrated/]
---

# Run integrated OpsKnight on Kubernetes

## Prerequisites

Complete cluster, secrets, database, ingress, and policy setup. Read [Integrated versus split](../architecture/integrated-vs-split). Integrated replicas own Web and background responsibilities together.

## Prepare integrated configuration

Select `runtime.mode: integrated` in Helm or the integrated Kustomize profile. Pin the same immutable digest everywhere. Configure a single migration owner, resources, probes, disruption budget, topology spread, public URLs, and database pool budget.

Do not leave split Deployments active against the same database.

## Deploy integrated runtime

Render and inspect manifests, run the migration boundary required by the package, and apply/install. Watch the migration and rollout:

```sh
kubectl -n opsknight get job,pod,deployment -w
kubectl -n opsknight rollout status deployment/<integrated-deployment> --timeout=10m
```

Stop on migration failure. Do not increase replicas during an uncertain rollout.

## Verify the deployment

Require readiness through the Service and public ingress. Confirm only integrated ownership exists. Create, acknowledge, and resolve a synthetic incident; verify notification and status projection. Restart one application Pod and confirm recovery without duplicate work.

## Operate it in production

Monitor readiness, request errors/latency, queue age, scheduler health, provider failures, database pools, and Pod/node disruption. Account for background ownership before changing replicas. Use split mode when roles need independent scaling or isolation.

## Troubleshooting

**Rollout stalls:** inspect Pod events, image pull, resources, secrets, database/migration, and probes.

**Scaling increases connection/load unexpectedly:** integrated replicas add background ownership and pools; return to the planned replica count or migrate deliberately to split.

**Both integrated and split workloads exist:** stop the new rollout, preserve data, and remove the unintended ownership model before resuming.

## Change or remove integrated runtime

For a split migration, back up, quiesce/stop integrated ownership, run the split migration owner, start split roles, and execute acceptance. Never overlap topologies.

## Next steps

- [Production checklist](./production-checklist)
- [Upgrade](../../upgrades/upgrade)

