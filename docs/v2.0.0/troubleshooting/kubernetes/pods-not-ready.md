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

For `Pending`, inspect scheduling, quota, PVC, and image-pull events. For
`CrashLoopBackOff`, inspect the previous container logs and termination code. For
a running but unready pod, query the readiness endpoint inside the pod with the
configured application Host header and follow the reported dependency.

After remediation, require a completed migration job, stable ready replicas,
healthy Service endpoints, and successful access through the intended ingress.
Capture chart/kustomize revision, image digest, events, probe response, and
redacted configuration references when escalating.
