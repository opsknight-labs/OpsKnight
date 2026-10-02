---
title: Configure Application URL and host routing
description: Align generated links, authentication, trusted hosts, aliases, and domain changes around one canonical public origin.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [application URL, canonical origin, host routing, 421, aliases, OIDC]
reader:
  status: READER_COMPLETE
  task: Configure and migrate OpsKnight's public origin safely.
verification:
  level: source
  verified_at: 2026-10-02
  evidence: [src/lib/app-url.ts, src/lib/auth-public-origin.ts, src/lib/request-host.ts, src/middleware.ts, src/app/api/settings/app-url/route.ts]
---

# Configure Application URL and host routing

Application URL is OpsKnight's canonical public origin. It controls generated application links and participates in the application-host firewall. Authentication has a related but distinct origin calculation, so production deployments must keep all sources aligned.

## Prerequisites

Choose the public DNS hostname and provision its TLS route. Identify who controls the proxy/ingress, deployment environment, identity-provider callbacks, and OpsKnight administrator settings. For an existing installation, keep at least one currently authorized hostname reachable during the change.

## Use one origin in normal production deployments

For a single-origin deployment, use the same exact HTTPS origin for:

```dotenv
NEXTAUTH_URL=https://opsknight.example.com
NEXT_PUBLIC_APP_URL=https://opsknight.example.com
```

Use `https://opsknight.example.com` as the proxy or ingress host, TLS certificate host, provider callback origin, and `/setup` Application URL. Include a non-standard port everywhere when one is genuinely public.

## Understand precedence

| Consumer | Precedence, highest first | Why it matters |
|---|---|---|
| Application-generated links | saved `SystemSettings.appUrl` → `NEXT_PUBLIC_APP_URL` → `NEXTAUTH_URL` → `http://localhost:3000` | Email, incident, reset, webhook entity, status/RSS, and voice callback links can use this origin. |
| Authentication and OIDC | `NEXTAUTH_URL` → `NEXT_PUBLIC_APP_URL` → saved Application URL → localhost | Login redirects and OIDC callback registration use the resolved authentication origin. |
| Allowed application hosts | saved Application URL host + environment URL hosts + localhost + exact `APP_HOST_ALIASES` | Other application-plane hosts receive HTTP 421. Status-page custom-domain routing is evaluated separately. |

This means a saved `https://new.example.com` with stale `NEXTAUTH_URL=https://old.example.com` can generate links for the new domain while authentication still uses the old domain. Treat a conflict shown in **Settings → System** as a deployment fault.

## Configure proxy-derived origins

`TRUST_PROXY_HEADERS=true` tells OpsKnight to trust proxy-supplied public host and protocol. When enabled, the authoritative origin uses the last `X-Forwarded-Host` value and `X-Forwarded-Proto`. Enable it only when direct access is restricted to trusted proxies that overwrite those headers.

`TRUSTED_PROXY_HOPS=N` has a different job: it controls how client IP is recovered from `X-Forwarded-For`. Increasing it does not repair redirects, HTTPS detection, or hostname authorization. See the [reverse-proxy contract](./reverse-proxy-contract).

## Add exact temporary or alternate hosts

Set comma-separated exact hostnames with `APP_HOST_ALIASES`:

```dotenv
APP_HOST_ALIASES=old.example.com,admin.example.net
```

Aliases expand accepted hostnames; ports are normalized away and are not an alias security boundary. The public Application URL still retains a real non-standard public port. Aliases do not change the canonical URL used in generated links or authentication. OpsKnight gives the canonical apex and its `www` counterpart special handling, but arbitrary subdomains do not inherit trust. For example, trusting `app.example.com` does not automatically trust `www.app.example.com`.

`REDIRECT_TO_CANONICAL_HOST=false` disables canonical-host redirects where supported. It does not authorize unrelated hosts and does not turn aliases into canonical origins.

## Change the URL after installation

An administrator can open **Settings → System → App URL**, save an absolute HTTP/HTTPS URL, and use **Test link**. The saved database value immediately becomes authoritative for general application links and allowed-host evaluation. It does not override a configured `NEXTAUTH_URL` for authentication.

Before saving a new domain, make that domain reachable and retain a supported path back through the current domain or an explicit alias. Do not save an untested internal address.

## Apply the configuration

Update deployment-managed environment values first and roll out every Web/application instance. Complete `/setup` for a new database, or save **Settings → System → App URL** through a currently authorized hostname for an existing database. Update provider callback registrations in the same maintenance window.

## Migrate from one hostname to another

For `old.example.com` → `new.example.com`:

1. Create DNS and a valid TLS route for the new hostname.
2. Add the new hostname to the proxy/ingress and temporarily include both exact hosts with `APP_HOST_ALIASES` when overlap is required.
3. Add the new callback and redirect URLs to OIDC, Slack, Teams, voice, webhook, and other provider allowlists before changing the canonical origin.
4. Update `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL`, then restart or roll out every Web/application instance.
5. While signed in through a still-valid host, update **Settings → System → App URL** to the new origin.
6. Verify login, generated links, ChatOps/OIDC callbacks, signed webhooks, voice callbacks, status/RSS routes, mobile/PWA behavior, and realtime incident updates.
7. Confirm unrelated hosts return 421. Keep both intended hosts only for the migration window.
8. Remove the old callbacks, alias, DNS, and certificate route after sessions and integrations have moved.

## Production smoke tests

```sh
curl --fail --show-error 'https://opsknight.example.com/api/health?mode=readiness'
curl --include --header 'Host: unrelated.example.net' 'http://127.0.0.1:3000/login'
```

The first request must succeed. The second is the Compose/upstream check and must return 421. For Kubernetes, port-forward the application Service to a local port or run a controlled in-cluster request with the invalid `Host`; expect 421 from OpsKnight. Separately verify that the external ingress/load balancer does not route arbitrary hostnames—its own 404 is valid but does not prove the application firewall. Also verify login stays on the public hostname, an actual notification link uses it, OIDC reports the expected callback, a signed webhook succeeds, and incident updates stream without refresh.

## Verify the result

Confirm **Settings → System** reports the intended application and authentication origins without a conflict. DNS, TLS, proxy/ingress, environment values, provider callbacks, generated links, and the saved setting must all agree; only documented aliases should remain additionally reachable.

## Recovery

If the saved value is wrong, use a still-authorized environment host, canonical host, or exact alias to sign in and correct **Settings → System → App URL**. If no configured host remains reachable, correct `NEXTAUTH_URL`/`NEXT_PUBLIC_APP_URL` or add an exact `APP_HOST_ALIASES` recovery host through the deployment configuration, roll out Web/application, sign in, repair the saved value, and remove the temporary alias after verification.

Do not make an ad hoc database edit as the primary recovery method. It bypasses validation, optimistic concurrency, and audit logging. See [Misdirected Request recovery](../../troubleshooting/installation/misdirected-request).

## Troubleshooting

- **HTTP 421:** use a currently authorized host or temporary exact alias, then repair the saved setting.
- **Login or OIDC uses the old host:** update `NEXTAUTH_URL`, provider callbacks, and all Web/application replicas.
- **Generated links use a different host:** inspect the saved Application URL before environment fallbacks.
- **Forwarded host is ignored:** confirm the trusted proxy overwrites headers, direct access is blocked, and `TRUST_PROXY_HEADERS=true` is deployed.

## Related guides

- [Initial setup](../../start/initial-setup)
- [Reverse-proxy contract](./reverse-proxy-contract)
- [421 recovery](../../troubleshooting/installation/misdirected-request)
