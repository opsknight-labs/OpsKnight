---
title: Troubleshoot OpsKnight on Kubernetes
description: Diagnose and recover Pod scheduling, CrashLoop, migration, readiness, database, network, URL, queue, and scheduler failures.
type: troubleshooting
product_area: deployment
audience: [operator, administrator]
keywords: [Kubernetes troubleshooting, CrashLoopBackOff, Pod Pending]
reader:
  status: READER_COMPLETE
  task: Diagnose and recover a failed or degraded Kubernetes deployment.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/, src/app/api/health/route.ts]
---

# Troubleshoot OpsKnight on Kubernetes

## Before you begin

Capture state before rollout/restart:

```sh
kubectl -n opsknight get pod,job,deployment,statefulset,pvc,service,endpoints,ingress
kubectl -n opsknight get events --sort-by=.lastTimestamp
kubectl -n opsknight describe pod <pod>
kubectl -n opsknight logs <pod> --all-containers --previous
```

Protect logs and rendered resources as sensitive.

## Pod remains Pending

**Check:** events for resource quota, unschedulable resources, affinity/spread, taints, PVC binding, and admission policy.

**Recovery:** correct requests/topology/storage/policy or add planned capacity. Do not delete a bound production PVC.

**Verify:** Pod schedules on an intended node and passes startup/readiness.

## Pod is in CrashLoopBackOff

**Check:** current/previous logs, exit code, missing Secret keys, runtime role, image architecture, database path, and memory limit.

**Recovery:** correct the failing dependency/configuration, then roll only the affected workload.

**Verify:** restart count stabilizes and role-specific work advances.

## Migration Job failed

**Check:** Job logs/events, direct database URL, TLS/CA, privileges, schema state, and image revision. Confirm it does not use PgBouncer.

**Recovery:** keep workloads stopped, fix the exact failure, recreate/rerun the one-shot Job according to packaging, and require completion.

**Verify:** Job completes once and rollout begins only afterward.

## Readiness fails

**Check:** call the health endpoint inside the Service path, inspect database/migration state, role heartbeats, secrets, and recent errors.

**Recovery:** restore the failing dependency; do not weaken the probe to mask it.

**Verify:** readiness succeeds internally and through public HTTPS.

## External database is unreachable

**Check:** DNS, TCP, NetworkPolicy, provider firewall, certificate hostname/CA, credentials, and connection limit from an equivalently governed Pod.

**Recovery:** correct the narrow network/TLS/auth problem and rerun migration/readiness.

**Verify:** direct TLS succeeds and connection usage remains inside budget.

## NetworkPolicy blocks traffic

**Check:** Pod/namespace selectors, resolved destination, port, ingress controller labels, DNS, and monitoring/provider paths.

**Recovery:** add a scoped rule with an owner; do not delete all policy.

**Verify:** intended paths pass and an intended denied path remains blocked.

## Public URL or OIDC callback is wrong

**Check:** both public URL settings, ingress host/TLS, forwarded headers, trusted hops, and identity-provider redirect URI.

**Recovery:** correct both sides, roll Web/application, and repeat sign-in.

**Verify:** every redirect remains on the public HTTPS origin.

## Queue backlog grows or scheduler is stale

**Check:** role heartbeats, oldest job, throughput, retries, leases, database time/connections, provider throttling, resource saturation, and correct role environment.

**Recovery:** fix the bottleneck or stale owner. Scale only the supported role after recalculating database and provider capacity.

**Verify:** oldest age declines and a synthetic incident completes within target.

## Next steps

- [System logs](../../reliability/system-logs)
- [Health and metrics](../../reliability/health-and-metrics)
- [Scaling signals](../../capacity/scaling-signals)

