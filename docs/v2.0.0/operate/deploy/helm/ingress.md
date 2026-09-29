---
title: Configure ingress with Helm
description: Configure and validate Helm-managed HTTPS ingress, public origins, proxy behavior, webhooks, and realtime streams.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Helm ingress, TLS, public URL]
reader:
  status: READER_COMPLETE
  task: Configure and validate Helm-managed ingress for OpsKnight.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/helm/opsknight/templates/ingress.yaml, deploy/kubernetes/helm/opsknight/values.yaml]
---

# Configure ingress with Helm

## Prerequisites

Provide an ingress controller, DNS, trusted TLS certificate workflow, and known proxy chain. Read the common [Kubernetes ingress contract](../kubernetes/ingress).

## Prepare the configuration

Set chart public URLs to the exact HTTPS origin. Enable ingress and configure class, host, path, TLS Secret, certificate annotations, SSL redirect, disabled SSE buffering, suitable timeouts, and bounded request size. Configure trusted proxy hops and NetworkPolicy ingress namespace labels.

## Deploy ingress

Render the chart and inspect the Ingress target Service/port, host, TLS, annotations, and policy selectors. Apply through the normal Helm installation/upgrade.

## Verify public behavior

Check Ingress, Service, endpoints, and public readiness. Verify sign-in/callback origins, a live incident update, a signed webhook, and configured OIDC/ChatOps callbacks. Compare an in-cluster request if public access fails.

## Operate it in production

Monitor certificate expiry, TLS/upstream errors, SSE disconnects, callback failures, and body-limit rejections. Trust forwarding headers only from the known chain.

## Troubleshooting

**404/503:** inspect ingress class/rules, Service/endpoints, and readiness.

**Wrong redirect:** correct chart public URLs, forwarded host/protocol, and trusted hops; roll Web/application.

**SSE or webhook fails:** correct buffering/timeouts or preserve signed raw body/headers and documented size limits.

## Change or remove ingress

Validate new hostname and every callback before retiring the old route. Keep HTTPS rollback available; never expose an unauthenticated direct port as fallback.

## Next steps

- [Install with Helm](./install)
- [Kubernetes production checklist](../kubernetes/production-checklist)

