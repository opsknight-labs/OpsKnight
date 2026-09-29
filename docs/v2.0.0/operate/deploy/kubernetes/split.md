---
title: Run split OpsKnight on Kubernetes
description: Deploy and validate separate web, scheduler, worker, and status-projector roles on Kubernetes.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Kubernetes split runtime, workers, scheduler]
reader:
  status: READER_COMPLETE
  task: Install and validate split OpsKnight on Kubernetes.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/helm/opsknight/templates/, deploy/kubernetes/kustomize/profiles/split/]
---

# Run split OpsKnight on Kubernetes

## Prerequisites

Complete platform, secret, database, ingress, and policy setup. Read [Runtime roles](../architecture/runtime-roles), calculate connections/resources for every replica, and use an image that supports split roles.

## Prepare split configuration

Select `runtime.mode: split` or the split profile. Configure Web, Scheduler, General Worker, Critical Worker, Bulk Worker, Status Projector, and one migration owner. Set role resources, replicas, probes, graceful termination, pool sizes, PDBs, and spread rules. Send ingress only to Web.

## Deploy split runtime

Render manifests and verify the integrated Deployment is absent. Run the migration Job through the direct database URL and require success before rolling out roles:

```sh
kubectl -n opsknight wait --for=condition=complete job/<migration-job> --timeout=15m
kubectl -n opsknight logs job/<migration-job>
kubectl -n opsknight get deployment,pod -w
```

Wait for each role's rollout. Do not accept partial success as a healthy split deployment.

## Verify every role

Confirm Web readiness, scheduler heartbeat/lag, every worker lane's progress, status projection, and absence of integrated ownership. Run a synthetic incident through ingestion, critical notification, acknowledgement, resolution, and status projection. Verify aggregate database connections remain under budget.

## Operate and scale in production

Alert per role and lane. Scale only from queue age, throughput, utilization, provider limits, and database headroom. A running Pod does not prove its queue is draining. Preserve at least one available Web replica and protected capacity for critical work.

## Troubleshooting

**One role CrashLoops:** inspect its exact environment/Secret references, runtime role, direct database path, resources, and logs.

**Scheduler healthy but queues empty/stale:** inspect heartbeat, due-work lag, leases, database time, and enqueue errors.

**Critical work delayed while bulk is busy:** verify role names, queue routing, resources, and that traffic was not accidentally consolidated.

**Connection ceiling reached:** reduce role pools/replicas, remove duplicate ownership, or add Web-only PgBouncer after budgeting it.

## Change or remove split runtime

To change roles, preserve one ownership model and roll one role at a time where safe. To return to integrated mode, back up, stop all split owners, validate integrated configuration, complete migration compatibility, then start integrated ownership.

## Next steps

- [Production checklist](./production-checklist)
- [Scaling signals](../../capacity/scaling-signals)

