---
title: Put Compose behind a TLS reverse proxy
description: Publish OpsKnight safely with correct public URLs, forwarded headers, webhook bodies, and realtime stream behavior.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [reverse proxy, TLS, public URL, SSE, webhooks]
reader:
  status: READER_COMPLETE
  task: Configure and validate a production reverse proxy for Compose.
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - src/middleware.ts
    - src/app/api/health/route.ts
    - env.example
---

# Put Compose behind a TLS reverse proxy

Publish port `3000` only through a trusted HTTPS reverse proxy. Authentication, callbacks, webhooks, client addresses, and realtime updates depend on the external origin and forwarded request behavior.

## Prerequisites

Install integrated or split Compose and obtain a DNS name and trusted TLS certificate. Know every proxy hop between the client and OpsKnight.

## Configure OpsKnight and the proxy

Set both origins to the exact external HTTPS origin, without a trailing internal hostname:

```dotenv
NEXTAUTH_URL=https://opsknight.example.com
NEXT_PUBLIC_APP_URL=https://opsknight.example.com
TRUSTED_PROXY_HOPS=<known-proxy-hop-count>
```

Configure the proxy to:

- forward to `127.0.0.1:${APP_PORT}`;
- preserve `Host` and `X-Forwarded-Proto`;
- set client-address forwarding only from trusted hops;
- pass provider signature headers and raw request bodies without transformation;
- allow request bodies up to the documented integration limit;
- disable response buffering for server-sent events;
- use an idle timeout that does not terminate healthy realtime streams.

Restrict direct access to application port `3000` with host firewall rules.

## Deploy the configuration

Recreate the application or Web service so environment changes take effect, reload the proxy, and inspect both service logs for startup or routing errors. Keep the same Compose file list used during installation.

## Verify the public path

1. Request readiness through `https://opsknight.example.com/api/health?mode=readiness`.
2. Sign in and confirm redirects never use localhost, HTTP, or an internal hostname.
3. Open an incident and confirm live changes appear without manual refresh.
4. Send a signed test webhook through the public hostname.
5. Complete an OIDC or ChatOps callback if configured.
6. Confirm the public status page path is reachable according to its privacy settings.

Compare failures with the direct loopback readiness endpoint to separate application health from proxy behavior.

## Operate it in production

Monitor certificate expiry, TLS errors, upstream latency/errors, realtime disconnects, request-size rejections, and authentication callback failures. Log enough request metadata to diagnose routing without recording credentials, session cookies, webhook secrets, or sensitive payloads.

## Troubleshooting

**Redirect points to localhost or HTTP:** correct both public URL variables, forwarded `Host`/protocol, and trusted-hop count; recreate Web/application.

**Incident updates require refresh:** disable buffering and extend the SSE idle timeout. Confirm intermediate load balancers apply the same policy.

**Webhook signature fails only through the proxy:** stop transforming or decompressing the signed body and preserve required signature headers exactly.

**413 response:** raise the proxy limit only to the documented inbound limit; do not allow unbounded bodies.

**Client IP is wrong:** set the exact trusted proxy chain. Do not trust arbitrary client-supplied forwarding headers.

## Change or undo the proxy

Keep the old route and certificate available during a hostname migration. Add the new origin to provider callbacks, update OpsKnight, validate authentication and webhooks, then retire the old route. Do not expose port `3000` publicly as a rollback.

## Next steps

- [Complete production acceptance](./production-checklist)
- [Configure OIDC](../../../guides/identity/configure-oidc)
- [Inspect health and metrics](../../reliability/health-and-metrics)

