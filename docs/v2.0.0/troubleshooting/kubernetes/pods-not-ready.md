---
title: Kubernetes pods are not ready
description: Diagnose migrations, probes, configuration, policy, resources, and dependencies.
type: troubleshooting
reader:
  status: READER_COMPLETE
  task: Diagnose, recover, and verify pods not ready.
product_area: deployment
audience: [operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [deploy/kubernetes/helm/opsknight/values.yaml, deploy/kubernetes/kustomize/base/network-policy.yaml]
---

# Kubernetes pods are not ready

Identify the workload and inspect events, termination reason, logs, rendered
configuration, secret references, migration job, and readiness response. Check
NetworkPolicy, ServiceAccount, resources, database DNS and TLS, ingress origin,
and runtime-role ownership. Do not weaken probes until the underlying readiness
dependency is understood.

## Diagnostic commands

```bash
kubectl -n <namespace> get pods,deployments,statefulsets,jobs
kubectl -n <namespace> describe pod <pod>
kubectl -n <namespace> logs <pod> --all-containers --tail=200
kubectl -n <namespace> get events --sort-by=.lastTimestamp
```

Start with the pod status rather than deleting it:

| Pod state | Next check | Healthy result |
| --- | --- | --- |
| `Pending` | `describe pod`, quota, node selectors, taints, PVCs | A node is assigned and all volumes bind |
| `ErrImagePull` / `ImagePullBackOff` | Event message, image digest, pull-secret reference | Registry authentication succeeds and the pinned digest pulls |
| `Init:*` | Init-container or migration Job logs | Migration exits `0` once; application containers then start |
| `CrashLoopBackOff` | `logs --previous` and termination reason | Process stays running and restart count stops increasing |
| `Running`, `0/1` | Readiness response from inside the pod | `/api/health?mode=readiness` returns a successful response |

For a crash loop, use the previous instance; the ordinary log command can show
only the new process:

```bash
kubectl -n <namespace> logs <pod> --all-containers --previous --tail=200
kubectl -n <namespace> get pod <pod> -o jsonpath='{range .status.containerStatuses[*]}{.name}{" restart="}{.restartCount}{" reason="}{.lastState.terminated.reason}{" exit="}{.lastState.terminated.exitCode}{"\n"}{end}'
```

For an unready running container, execute the probe from the same network
namespace. Replace the port with the rendered container port:

```bash
kubectl -n <namespace> exec <pod> -c <container> -- \
  wget -qSO- 'http://127.0.0.1:3000/api/health?mode=readiness'
kubectl -n <namespace> get endpointslices -l kubernetes.io/service-name=<service>
```

A healthy pod appears in the Service endpoint slice. A successful local probe
with no endpoint usually means the Service selector, named port, or readiness
condition is wrong. A failed local probe means the response body and application
logs should identify the dependency to repair.

For `Pending`, inspect scheduling, quota, PVC, and image-pull events. For
`CrashLoopBackOff`, inspect the previous container logs and termination code. For
a running but unready pod, query the readiness endpoint inside the pod with the
configured application Host header and follow the reported dependency.

After remediation, require a completed migration job, stable ready replicas,
healthy Service endpoints, and successful access through the intended ingress.
Capture chart/kustomize revision, image digest, events, probe response, and
redacted configuration references when escalating.
