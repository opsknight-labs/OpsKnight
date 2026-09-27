---
title: Kubernetes pods are not ready
description: Diagnose migrations, probes, configuration, policy, resources, and dependencies.
type: troubleshooting
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

