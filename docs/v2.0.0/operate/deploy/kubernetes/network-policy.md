---
title: Configure Kubernetes NetworkPolicy
description: Restrict OpsKnight ingress and egress while preserving database, DNS, identity, notification, webhook, and monitoring traffic.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [NetworkPolicy, egress, ingress, Kubernetes security]
reader:
  status: READER_COMPLETE
  task: Apply and validate least-privilege network policy for OpsKnight.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/helm/opsknight/templates/networkpolicy.yaml, deploy/kubernetes/kustomize/base/network-policy.yaml]
---

# Configure Kubernetes NetworkPolicy

## Prerequisites

Confirm the cluster network plugin enforces NetworkPolicy. Inventory ingress controller namespaces, DNS, PostgreSQL, registry/startup dependencies, identity providers, notification/ChatOps/Jira endpoints, webhook destinations, and monitoring scrapers.

## Prepare policy rules

Allow user traffic only from the intended ingress controller to Web/application. Allow monitoring only from the approved namespace or selector. Permit DNS and required external destinations. Narrow PostgreSQL egress to its namespace selector or CIDR/port where the platform supports it.

The checked-in base is a functional starting point, not proof of least privilege for your environment. Avoid unrestricted egress when provider addresses can be controlled safely.

## Apply the policy

Render and review effective Pod selectors and namespace selectors before applying:

```sh
kubectl -n opsknight get networkpolicy
kubectl -n opsknight describe networkpolicy
```

Apply policy in a maintenance/test environment first. Keep an out-of-band administrative recovery path approved by the platform team.

## Verify allowed and denied paths

From Pods subject to equivalent policy, verify DNS, direct database TLS, public readiness through ingress, provider test delivery, OIDC callback, webhook delivery, and metrics scraping. Also verify an intentionally disallowed namespace cannot reach the application or database path.

## Production and security considerations

Review policy whenever providers, database endpoints, ingress controllers, namespaces, or monitoring stacks change. Document broad CIDR exceptions and their owners. NetworkPolicy does not replace provider authentication, TLS, webhook signatures, or database privileges.

## Troubleshooting

**Pod can resolve DNS but cannot connect:** inspect destination IP/port after DNS resolution and matching egress selectors/CIDRs.

**Ingress returns timeout:** confirm ingress namespace labels and application Pod/port selectors.

**External database is blocked:** permit the actual endpoint range and port; managed database IPs may change according to provider contract.

**One notification provider fails:** compare its resolved destinations and redirect chain with the allowed egress policy.

## Change or undo policy

Prefer a narrowly scoped temporary exception with an expiry/owner over deleting all policy. After diagnosis, restore least privilege and rerun allowed/denied verification.

## Next steps

- [Kubernetes troubleshooting](./troubleshooting)
- [Security hardening](../../security/hardening)
