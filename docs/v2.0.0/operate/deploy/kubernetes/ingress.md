---
title: Configure Kubernetes ingress and TLS
description: Publish OpsKnight through HTTPS with correct origins, proxy headers, webhook handling, and realtime streams.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Kubernetes ingress, TLS, SSE, public URL]
reader:
  status: READER_COMPLETE
  task: Configure and validate Kubernetes ingress and TLS for OpsKnight.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/kubernetes/helm/opsknight/templates/ingress.yaml, deploy/kubernetes/kustomize/base/ingress.yaml]
---

# Configure Kubernetes ingress and TLS

## Prerequisites

Install an approved ingress controller, create DNS, and obtain a trusted TLS certificate workflow. In split mode, only Web receives user traffic.

## Prepare public routing

Set `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` to the exact public HTTPS origin. Configure the known `TRUSTED_PROXY_HOPS`. Point ingress to the OpsKnight Service on its HTTP port.

Preserve host/protocol/client forwarding, signed webhook headers, and raw bodies. Set the documented body limit, disable buffering for server-sent events, and choose an idle timeout that preserves healthy streams.

## Deploy ingress

Render the Helm values or Kustomize overlay and inspect host, class, TLS Secret, Service name/port, annotations, and NetworkPolicy ingress selectors. Apply only after placeholders are removed.

```sh
kubectl -n opsknight get ingress,service,endpoints
kubectl -n opsknight describe ingress
```

## Verify the public path

```sh
curl --fail --show-error \
  'https://opsknight.example.com/api/health?mode=readiness'
```

Sign in, validate callback origins, observe a live incident update without refresh, send a signed webhook, and test configured OIDC/ChatOps callbacks. Compare with an in-cluster readiness request if the public path fails.

## Production and security considerations

Redirect HTTP to HTTPS, monitor certificate expiry and upstream errors, restrict direct Service exposure, and trust forwarding headers only from known proxies. Avoid logging cookies, authorization headers, signing secrets, or sensitive payloads.

## Troubleshooting

**404/503:** inspect ingress class, rules, Service selector, endpoints, and readiness.

**Redirect to localhost/HTTP:** correct both public URLs and forwarded protocol/host handling, then restart Web/application.

**Realtime updates stop:** disable buffering and extend timeouts at every load-balancer/ingress hop.

**Webhook signature fails:** preserve the raw signed request and required headers; check body transformations and size limits.

## Change or remove ingress

During hostname migration, validate the new origin and every provider callback before retiring the old hostname. Keep a TLS route available for rollback; do not expose a NodePort as the production fallback.

## Next steps

- [Configure NetworkPolicy](./network-policy)
- [Production checklist](./production-checklist)

