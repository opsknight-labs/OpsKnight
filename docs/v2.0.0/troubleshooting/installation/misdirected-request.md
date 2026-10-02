---
title: Recover from 421 Misdirected Request
description: Diagnose and safely repair canonical-host, proxy-header, alias, and Application URL mismatches.
type: troubleshooting
product_area: deployment
audience: [operator, administrator]
keywords: [421, misdirected request, application URL, host, proxy]
reader:
  status: READER_COMPLETE
  task: Restore access after OpsKnight rejects the requested application host.
verification:
  level: source
  verified_at: 2026-10-02
  evidence: [src/middleware.ts, src/lib/request-host.ts, src/lib/app-url.ts, src/app/api/settings/app-url/route.ts]
---

# Recover from 421 Misdirected Request

HTTP 421 means the request reached OpsKnight, but its application host was not authorized. This firewall prevents an attacker-controlled `Host` header from influencing links, redirects, cookies, or callbacks. Do not disable it by exposing the application port directly.

## 1. Identify the host OpsKnight receives

Record the browser URL, proxy/ingress host rule, direct `Host`, and—when proxy trust is enabled—the final `X-Forwarded-Host` and `X-Forwarded-Proto`. Inspect sanitized proxy and application logs; never log cookies, authorization headers, or secrets.

If `TRUST_PROXY_HEADERS=false`, OpsKnight ignores forwarded host/protocol for authoritative routing. If it is `true`, the trusted proxy must overwrite those headers with the public values.

## 2. Compare every configured origin

Compare:

- **Settings → System → App URL** (`SystemSettings.appUrl`);
- `NEXTAUTH_URL`;
- `NEXT_PUBLIC_APP_URL`;
- exact comma-separated `APP_HOST_ALIASES`;
- DNS, TLS certificate, and proxy/ingress host.

Include a public non-standard port consistently. Remember that `TRUSTED_PROXY_HOPS` affects client IP only and cannot fix a host/protocol mismatch.

## 3. Check expected special cases

The canonical apex and its `www` counterpart receive special handling. Arbitrary subdomains do not: `app.example.com` does not implicitly authorize `www.app.example.com`, `admin.example.com`, or any wildcard. `REDIRECT_TO_CANONICAL_HOST=false` changes redirection, not authorization.

Before the first user exists, `/setup` remains reachable so you can establish the correct canonical host. Verify its Application URL before creating the administrator.

## 4. Restore an authorized path

Use this supported order:

1. Try the saved Application URL host or either configured environment URL host.
2. If DNS changed, temporarily restore routing/TLS for one already-authorized host.
3. Otherwise add the exact recovery hostname to `APP_HOST_ALIASES` in deployment configuration and roll out Web/application.
4. Sign in through that valid host and correct **Settings → System → App URL**.
5. Align `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`, DNS, TLS, proxy/ingress, and provider callback registrations; roll out again if environment changed.
6. Test login, a generated notification link, OIDC/ChatOps callbacks, webhooks, and the new canonical host.
7. Remove the temporary alias only after the canonical path passes.

Avoid direct SQL as routine recovery: it bypasses URL validation, concurrency protection, and the audit event produced by the settings API.

## Expected result

The intended public HTTPS host serves readiness, login, and the application; redirects and generated links stay on it; provider callbacks match it; and an unrelated host still returns 421.

## Related guides

- [Application URL and host routing](../../operate/deploy/application-url-and-host-routing)
- [Reverse-proxy contract](../../operate/deploy/reverse-proxy-contract)
- [Initial setup](../../start/initial-setup)

