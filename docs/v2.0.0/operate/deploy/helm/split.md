---
title: Configure split runtime with Helm
description: Define and validate separate Helm-managed web, scheduler, worker, and status-projector roles.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Helm split runtime, workers, scheduler]
reader:
  status: READER_COMPLETE
  task: Configure and validate split-runtime Helm values.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/helm/opsknight/values.yaml, deploy/kubernetes/helm/opsknight/templates/]
---

# Configure split runtime with Helm

## Prerequisites

Read [Runtime roles](../architecture/runtime-roles), calculate resources and connections for every replica, and use an image supporting split roles. Configure stable secrets and a direct database URL.

## Prepare the configuration

Set `runtime.mode: split`, enable the migration Job, and define Web, Scheduler, General Worker, Critical Worker, Bulk Worker, and Status Projector replicas/resources/pools/probes/termination/PDBs. Direct ingress only to Web. Set `database.maxApplicationConnections` to the reviewed ceiling.

Keep migration and non-Web roles on direct PostgreSQL. Add [PgBouncer](./pgbouncer) only for Web.

## Deploy split runtime

Lint, render, and inspect the chart. The integrated Deployment must be absent. Install/upgrade and require the migration hook to complete before all role rollouts become ready.

```sh
kubectl -n opsknight get job,deployment,pod -w
```

## Verify every role

Confirm migration success, Web readiness, scheduler heartbeat, progress in all worker lanes, status projection, and no integrated ownership. Run a synthetic incident through notification, acknowledgement, resolution, and projection while observing database connections.

## Operate and scale in production

Alert on each role and lane. Scale only after checking oldest age, throughput, resource saturation, provider limits, and connection headroom. Keep critical work isolated and preserve graceful termination.

## Troubleshooting

**A role is missing:** inspect rendered enablement/replica values and chart schema errors.

**A role CrashLoops:** inspect its Secret mapping, runtime role, database route, resources, and prior logs.

**Queues grow with Ready Pods:** investigate heartbeat, lane routing, provider/database bottlenecks, and throughput; readiness alone is insufficient.

## Change or undo the configuration

Upgrade one reviewed values revision at a time. To return to integrated, stop split ownership before starting integrated and run full acceptance.

## Next steps

- [Configure PgBouncer](./pgbouncer)
- [Install with Helm](./install)

