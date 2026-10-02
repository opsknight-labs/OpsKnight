---
title: Meet the reverse-proxy contract
description: Configure every proxy and ingress hop for canonical origins, client IPs, signed webhooks, request limits, TLS, and realtime streams.
type: deployment
product_area: deployment
audience: [operator]
keywords: [reverse proxy, ingress, forwarded headers, SSE, webhook body, TLS]
reader:
  status: READER_COMPLETE
  task: Publish OpsKnight through a trusted reverse proxy without breaking security or application behavior.
verification:
  level: source
  verified_at: 2026-10-02
  evidence: [src/lib/request-host.ts, src/lib/client-ip.ts, src/middleware.ts, src/app/api/health/route.ts]
---

# Meet the reverse-proxy contract

Apply this contract at every nginx, Traefik, cloud load balancer, CDN, Kubernetes ingress, or Swarm routing hop. Packaging guides describe where to configure it; this page defines the required behavior.

## Prerequisites

Provision public DNS and a trusted TLS certificate, identify every proxy hop, and restrict the upstream application port to trusted proxy networks. Know the intended public origin and the largest documented inbound request that the installation must accept.

## Configure origin and client forwarding

Set `NEXTAUTH_URL` and normally `NEXT_PUBLIC_APP_URL` to the exact public HTTPS origin. Decide separately whether host/protocol headers are trusted and how many proxy hops participate in client-IP recovery.

## Forward the public request faithfully

- Set `Host` to the browser-facing host, or overwrite `X-Forwarded-Host` with it and enable `TRUST_PROXY_HEADERS=true`.
- Set `X-Forwarded-Proto` to the original public scheme. Production traffic must resolve to `https`.
- Overwrite, rather than append untrusted client values to, forwarding headers at the trusted edge.
- Restrict direct application-port access so clients cannot bypass the trusted proxy.
- Forward the request path and query unchanged.

`TRUST_PROXY_HEADERS` controls public host/protocol trust. `TRUSTED_PROXY_HOPS` controls only client-IP selection from `X-Forwarded-For`. Set the latter to the exact known proxy depth; too high trusts client-supplied addresses, while too low records a proxy address.

## Preserve application protocols

- Pass provider signature headers and raw signed webhook request bytes without re-encoding, decompression, or JSON normalization.
- Enforce a finite body limit at least as large as the applicable documented inbound integration limit.
- Disable response buffering and caching for server-sent events.
- Set stream idle/read timeouts long enough for healthy realtime incident sessions.
- Preserve cookies and authorization headers, but never log their values.

## Apply the proxy configuration

Validate the proxy or Ingress configuration, reload it without exposing the upstream port, then roll out Web/application when environment values changed. Apply equivalent header, body, and stream behavior at every intermediate CDN or load balancer.

## Terminate TLS safely

Redirect public HTTP to HTTPS, use a trusted certificate covering the exact public host, monitor expiry, and use supported protocols/ciphers. Encrypt internal hops when the network trust model requires it. Do not expose port `3000`, a NodePort, or a container address as a production fallback.

## Production and security considerations

Allow forwarding headers only from controlled infrastructure, monitor upstream errors and certificate expiry, bound request sizes, and redact sensitive headers and bodies. Revalidate the contract after changing CDN, ingress controller, load balancer, public hostname, or authentication provider.

## Verify every layer

Test public readiness, login redirect host, `/setup` before initialization, a generated link, SSE updates, one signed webhook, OIDC/ChatOps callbacks, body-limit behavior, and recovered client IP. Confirm an unrelated host returns 421. Compare public readiness with a private upstream request to distinguish proxy failure from application failure.

For symptoms and recovery, use [Misdirected Request](../../troubleshooting/installation/misdirected-request) and the packaging-specific troubleshooting guide.

## Troubleshooting

- **Wrong host or HTTP redirect:** repair `Host`/`X-Forwarded-Host`, `X-Forwarded-Proto`, and `TRUST_PROXY_HEADERS`; `TRUSTED_PROXY_HOPS` is not the fix.
- **Wrong client IP:** validate the exact `X-Forwarded-For` chain and `TRUSTED_PROXY_HOPS`.
- **Webhook signature failure:** stop body transformation and preserve signature headers.
- **Realtime disconnects:** disable buffering and increase the stream idle timeout at every hop.
- **HTTP 413:** set a bounded proxy limit that meets the documented provider limit.
