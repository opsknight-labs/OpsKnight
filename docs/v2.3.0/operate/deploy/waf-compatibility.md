---
title: Run OpsKnight behind a web application firewall
description: Find which OpsKnight requests generic WAF rules block, and add narrow exclusions for AWS WAF, Cloudflare, and ModSecurity or Coraza with the OWASP Core Rule Set.
type: deployment
product_area: deployment
audience: [operator]
keywords: [WAF, AWS WAF, Cloudflare, ModSecurity, Coraza, OWASP CRS, SSO, false positive]
reader:
  status: READER_COMPLETE
  task: Keep a WAF in front of OpsKnight without blocking sign-in, status pages, runbooks, or integrations.
verification:
  level: source
  verified_at: 2026-11-04
  evidence:
    - src/lib/status-pages/status-auth-return.ts
    - src/lib/app-routes.ts
    - src/lib/auth-redirect.ts
    - src/lib/auth.ts
    - src/middleware.ts
    - agent/src/client.ts
    - next.config.ts
---

# Run OpsKnight behind a web application firewall

Generic WAF rule sets are written for typical websites. Some ordinary OpsKnight requests look like attacks to them: sign-in callbacks with long query strings, runbooks that contain shell commands, alert payloads that contain internal URLs. This page lists those requests and gives narrow exclusions for each. Use it with the [reverse-proxy contract](./reverse-proxy-contract). The WAF is one more hop that must follow that contract.

Never fix a block by turning the WAF off or putting the whole application in a detection-only mode. Find the rule ID that fired, then remove that one rule for one path and, where the product allows it, one field.

## Prerequisites

You need access to the WAF logs or sampled requests, so you can see which rule blocked a request. You also need to know which rule sets are on: AWS managed rule groups, Cloudflare Managed or OWASP rulesets, or the OWASP Core Rule Set (CRS) version and paranoia level.

## What OpsKnight changed to avoid false positives

Releases after 2.1.0 no longer send these request shapes:

- **Status-page single sign-on** used to send `returnTo=https://<status-host>/` to the app host. It now sends a bare `returnHost`, an optional `returnScheme=http`, and a relative `returnTo` path. The old form is still accepted, so links issued before an upgrade keep working.
- **Forced sign-out** used to nest a login URL inside `callbackUrl`, which encoded it twice (`%252F`). It now links to `/auth/signout?surface=…&error=…&callbackUrl=…` with flat parameters.
- **Leaving the set-password page** used to post the full page URL, including the reset token, as `callbackUrl`. It now posts `/login?password=1`.
- **The Runbook Agent** sends `User-Agent: OpsKnight-Agent/<version>`. The middleware status-domain lookup sends `User-Agent: OpsKnight-Internal/1.0`. Both used the runtime default `node`.
- **Login** keeps a deep link when NextAuth turns `callbackUrl` into an absolute URL on the application's own origin, instead of dropping it.
- **SSO errors** no longer travel as `/api/auth/error?error=<raw exception text>`. The sign-in callback returns a fixed code (`OAuthCallback`) and NextAuth's error page is the OpsKnight login page. Raw database or IdP messages carry quotes, backticks and URLs that SQL-injection and XSS rules block.
- **The SSO retry hop** (`GET /api/auth/signin`, reached after every SSO error) now redirects to `/login` with a relative `callbackUrl`. NextAuth itself would send `callbackUrl=https%3A%2F%2F<app>%2F…`.

On 2.1.0 and earlier, also add the status-page and sign-out exclusions in [Requests that still need exclusions](#requests-that-still-need-exclusions).

## Requests that still need exclusions

These requests come from the identity provider, the Next.js framework, or the work OpsKnight exists to do. They cannot be changed in OpsKnight.

| Request | Why a WAF flags it | Typical rule |
|---|---|---|
| `GET /api/auth/callback/oidc` and `GET /api/auth/oidc/test/callback` | Microsoft Entra ID and some other IdPs send an authorization `code` over 1,000 characters. Some IdPs add `iss=https://…`. Errors arrive as `error_description` with quotes and URLs. | AWS `SizeRestrictions_QUERYSTRING`, `GenericRFI_QUERYARGUMENTS`; CRS 931130, 942xxx |
| `/login`, `/m/login` | Deep links carry the user's original query string, URL-encoded once, inside `callbackUrl`. | CRS 942xxx/941xxx when the original query held quotes or `<` |
| `POST /api/auth/signin/oidc` and the IdP round trip | The SSO button posts the CSRF token and a relative `callbackUrl`. The response sets NextAuth's state, PKCE and nonce cookies, about 1 KB together, for the 15-minute round trip. | AWS `SizeRestrictions_Cookie_HEADER` only alongside other large cookies |
| `POST /api/auth/control` (**Settings → Authentication**, SSO setup and **Test SSO**) | The JSON body holds the issuer URL, the client secret (random punctuation), scopes and up to 100 role-mapping rules. | CRS 931130, 942xxx; AWS `GenericRFI_BODY` (IP issuer), `SizeRestrictions_BODY` |
| `next-auth.callback-url` cookie | Holds an absolute, URL-encoded callback on the application's origin. | CRS 931xxx on `REQUEST_COOKIES`; AWS `CrossSiteScripting_COOKIE` when the deep link had `<` or quotes |
| Any page navigation or Server Action (requests with the `RSC`, `Next-Router-State-Tree` or `Next-Action` header) | `Next-Router-State-Tree` is URL-encoded JSON. Server Action bodies are JSON arrays and are capped at 2 MB. | CRS 920xxx, 942xxx; AWS `SizeRestrictions_BODY` (8 KB) |
| Runbook import, draft and publish (Server Actions on `/runbooks/*`), `/api/runbook-agent/v1/*` | Runbook steps hold shell, Docker, Kubernetes and HTTP commands. Agent results hold command output. | CRS 932xxx (remote code execution), 930xxx (local file inclusion); AWS `UNIXShellCommandsVariables_BODY`, `SizeRestrictions_BODY` |
| `/api/integrations/*`, `/api/events` | Alert payloads hold internal URLs such as `generatorURL=http://10.0.0.5:9090/…`, and SQL, shell or HTML in alert text. The body limit is 1 MiB. | AWS `GenericRFI_BODY`, `SizeRestrictions_BODY`; CRS 931xxx, 941xxx, 942xxx |
| Status-page branding and settings | Custom CSS, and logos sent as `data:image/…;base64`. | CRS 941xxx; AWS `SizeRestrictions_BODY` |
| Incident notes, postmortems, templates | Pasted stack traces, SQL errors and HTML. | CRS 941xxx, 942xxx |
| Provider webhooks: Slack, Twilio, GitHub, GitLab, Grafana, Jira, PagerDuty and AWS SNS | They come from provider infrastructure with provider user agents, and need their signature headers and raw body unchanged. | Bot-control and IP-reputation rules |

## Configure scoped exclusions

Remove one rule for one path, not a whole rule group for the whole site. Prefer excluding a single field, such as one argument or cookie, when the product allows it. Keep the path list in version control next to the rest of the proxy configuration.

### AWS WAF

Keep `AWSManagedRulesCommonRuleSet` and override the rules that fire to **Count**. Then add your own rule that blocks on the label they emit, except on OpsKnight's paths. For example, `SizeRestrictions_BODY` is allowed on body-heavy paths and still blocked everywhere else:

```json
{
  "Name": "opsknight-size-body-outside-allowed-paths",
  "Priority": 10,
  "Action": { "Block": {} },
  "VisibilityConfig": { "SampledRequestsEnabled": true, "CloudWatchMetricsEnabled": true, "MetricName": "opsknight-size-body" },
  "Statement": {
    "AndStatement": {
      "Statements": [
        { "LabelMatchStatement": { "Scope": "LABEL", "Key": "awswaf:managed:aws:core-rule-set:SizeRestrictions_Body" } },
        { "NotStatement": { "Statement": { "OrStatement": { "Statements": [
          { "ByteMatchStatement": { "FieldToMatch": { "UriPath": {} }, "PositionalConstraint": "STARTS_WITH", "SearchString": "/api/integrations/", "TextTransformations": [{ "Priority": 0, "Type": "NONE" }] } },
          { "ByteMatchStatement": { "FieldToMatch": { "UriPath": {} }, "PositionalConstraint": "STARTS_WITH", "SearchString": "/api/runbook-agent/v1/", "TextTransformations": [{ "Priority": 0, "Type": "NONE" }] } },
          { "ByteMatchStatement": { "FieldToMatch": { "SingleHeader": { "Name": "next-action" } }, "PositionalConstraint": "EXACTLY", "SearchString": "", "TextTransformations": [{ "Priority": 0, "Type": "NONE" }] } }
        ] } } } }
      ]
    }
  }
}
```

The last statement uses `EXACTLY ""` on a header that is present but empty. To match "the header is present" instead, use a `SizeConstraintStatement` on `SingleHeader: next-action` with `GT 0`. Apply the same Count-then-label pattern to these rules:

- `SizeRestrictions_QUERYSTRING` on `/api/auth/callback/oidc` and `/api/auth/oidc/test/callback`.
- `GenericRFI_QUERYARGUMENTS` on `/api/auth/callback/oidc` (IP-addressed IdPs in `iss`).
- `GenericRFI_BODY`, `SizeRestrictions_BODY` and `SQLi_BODY` on `/api/auth/control`.
- `GenericRFI_BODY` on `/api/integrations/` and `/api/events`.
- `CrossSiteScripting_BODY` on Server Actions and `/api/settings/status-page`.
- `UNIXShellCommandsVariables_BODY` from the Linux and POSIX rule groups, on runbook Server Actions and `/api/runbook-agent/v1/`.

If Bot Control is enabled, allow `OpsKnight-Agent/` and the provider webhook paths.

### Cloudflare

Create a WAF **exception** (skip) rule above the managed rulesets. Skip only the matching rules, not the whole ruleset, and limit the rule to OpsKnight's paths:

```text
(http.request.uri.path in {"/api/auth/callback/oidc" "/api/auth/oidc/test/callback" "/api/auth/control"})
or (starts_with(http.request.uri.path, "/api/integrations/"))
or (starts_with(http.request.uri.path, "/api/runbook-agent/v1/"))
or (any(http.request.headers.names[*] == "next-action"))
```

Action: **Skip** → *Specific rules* → choose the rule IDs shown in **Security → Events** for the blocked request. Make a separate exception for provider webhook paths that skips Bot Fight Mode or Super Bot Fight Mode. If you use the Cloudflare OWASP ruleset, keep it at paranoia level 1. Paranoia level 2 adds rule 931130, which blocks the absolute same-origin `callbackUrl`.

### Azure Front Door and Application Gateway WAF

Both Azure WAF products run a managed rule set whose rule IDs follow the OWASP CRS numbers used above (for example 931130, 920230 and the 941xxx, 942xxx and 932xxx families), so the "Typical rule" column applies directly. Application Gateway calls it the Core Rule Set (CRS 3.2 or later) and Front Door the Default Rule Set (DRS 2.0 or 2.1). Keep it in **Prevention** mode and change one rule at a time.

Azure exclusions remove a request attribute from inspection, not a URL path. An exclusion names a match variable (request header name, cookie name, query-string argument name, POST argument name, or, on Front Door DRS 2.0 and later, JSON argument name), an operator (`Equals`, `Contains`, `StartsWith`, `EndsWith`, `Equals any`) and a selector. Scope each one to a single rule rather than the rule set or the whole policy. Selectors are case sensitive. For a JSON body, an exclusion keeps the argument names inspected and skips their values.

| Request | Exclusion (scope: the rule that fired) |
|---|---|
| OIDC callback `iss` and `error_description` | Query-string argument name `Equals` `iss`, and `Equals` `error_description`, on rules 931130, 920230 and the SQLi and XSS rules shown in the log |
| `callbackUrl` on `/login` and `/api/auth/*` | Query-string argument name `Equals` `callbackUrl`; cookie name `Equals` `next-auth.callback-url` and `__Secure-next-auth.callback-url`, on rule 931130 |
| `Next-Router-State-Tree` header | Request header name `Equals` `Next-Router-State-Tree`, on the SQLi and XSS rules in the log |
| SSO settings JSON (`/api/auth/control`) | JSON argument name `Equals` `configuration.issuer` and `configuration.clientSecret`, on 931130 and the SQLi rules in the log |

A path cannot be named in an exclusion, so where a rule has to be relaxed for one path only (runbook Server Actions and `/api/runbook-agent/v1/`, `/api/integrations/*`, `/api/events`, branding), use a **custom rule** instead. Custom rules run before the managed rules. A rule with action **Allow** that matches the path (and, for Server Actions, a `Next-Action` header) ends evaluation for that request, so give it a narrow match condition and, where you can, restrict it to the provider's published source ranges:

```text
RequestUri  BeginsWith  /api/runbook-agent/v1/
and RequestHeaders[User-Agent]  BeginsWith  OpsKnight-Agent/
```

Use the same pattern for the provider webhook paths. If the Bot Manager rule set is on, allow `OpsKnight-Agent/` and the provider webhooks there too.

Body inspection is limited. Microsoft documents that the WAF inspects only the first part of a request body, 128 KB by default, and that on Application Gateway the inspection limit and the size limit can be set independently from CRS 3.2 on. The product accepts event bodies up to 1 MiB, so anything past the inspection limit reaches OpsKnight uninspected by the WAF; OpsKnight validates every body itself. Check the current limits in Microsoft's [Application Gateway request size limits](https://learn.microsoft.com/azure/web-application-firewall/ag/application-gateway-waf-request-size-limits) and [Front Door exclusion](https://learn.microsoft.com/azure/web-application-firewall/afds/waf-front-door-exclusion) pages before relying on a number. OpsKnight has been replayed against the OWASP CRS only; run the checks in [Verify every layer](#verify-every-layer) on your Azure policy before go-live.

### ModSecurity or Coraza with the OWASP CRS

Put exclusions in `REQUEST-900-EXCLUSION-RULES-BEFORE-CRS.conf` (runtime `ctl:` actions). Remove a rule for one argument or cookie, not for the whole request:

```apache
# OIDC callbacks: long authorization codes and RFC 9207 `iss` URLs
SecRule REQUEST_FILENAME "@rx ^/api/auth/(callback/oidc|oidc/test/callback)$" \
  "id:1000100,phase:1,pass,nolog,\
   ctl:ruleRemoveTargetById=931130;ARGS:iss,\
   ctl:ruleRemoveTargetById=920230;ARGS:iss,\
   ctl:ruleRemoveTargetByTag=attack-sqli;ARGS:error_description,\
   ctl:ruleRemoveTargetByTag=attack-xss;ARGS:error_description"

# Login and NextAuth: same-origin absolute callbackUrl, in the query and the cookie
SecRule REQUEST_FILENAME "@rx ^/(m/)?login$|^/api/auth/" \
  "id:1000101,phase:1,pass,nolog,\
   ctl:ruleRemoveTargetById=931130;ARGS:callbackUrl,\
   ctl:ruleRemoveTargetById=931130;REQUEST_COOKIES:__Secure-next-auth.callback-url,\
   ctl:ruleRemoveTargetById=931130;REQUEST_COOKIES:next-auth.callback-url"

# SSO settings: issuer URL and client secret in the JSON body
SecRule REQUEST_FILENAME "@streq /api/auth/control" \
  "id:1000104,phase:1,pass,nolog,\
   ctl:ruleRemoveTargetById=931130;ARGS:json.configuration.issuer,\
   ctl:ruleRemoveTargetByTag=attack-sqli;ARGS:json.configuration.clientSecret"

# Next.js router state header on navigations and Server Actions
SecRule &REQUEST_HEADERS:Next-Router-State-Tree "@gt 0" \
  "id:1000102,phase:1,pass,nolog,\
   ctl:ruleRemoveTargetByTag=attack-sqli;REQUEST_HEADERS:Next-Router-State-Tree,\
   ctl:ruleRemoveTargetByTag=attack-xss;REQUEST_HEADERS:Next-Router-State-Tree"

# Runbook Agent results carry command output
SecRule REQUEST_FILENAME "@beginsWith /api/runbook-agent/v1/" \
  "id:1000103,phase:1,pass,nolog,\
   ctl:ruleRemoveByTag=attack-rce,ctl:ruleRemoveByTag=attack-lfi,\
   ctl:ruleRemoveById=921130"

# Runbook Server Actions: steps hold shell, Docker, Kubernetes and HTTP commands. They are POSTs to the page
# path, so scope them by path and method (a Next-Action header condition did not match in testing).
SecRule REQUEST_FILENAME "@rx ^/runbooks(/|$)" \
  "id:1000105,phase:1,pass,nolog,chain"
  SecRule REQUEST_METHOD "@streq POST" \
    "ctl:ruleRemoveByTag=attack-rce,ctl:ruleRemoveByTag=attack-lfi"

# Alert ingestion: internal URLs (generatorURL=http://10.0.0.5:9090/...) and shell text in alert fields
SecRule REQUEST_FILENAME "@rx ^/api/(events$|integrations/)" \
  "id:1000106,phase:1,pass,nolog,\
   ctl:ruleRemoveById=931100,\
   ctl:ruleRemoveById=932130"

# Status-page branding: custom CSS and base64 logos
SecRule REQUEST_FILENAME "@streq /api/settings/status-page" \
  "id:1000107,phase:1,pass,nolog,\
   ctl:ruleRemoveTargetByTag=attack-rce;ARGS:json.customCss,\
   ctl:ruleRemoveTargetByTag=attack-xss;ARGS:json.customCss,\
   ctl:ruleRemoveTargetByTag=attack-rce;ARGS:json.logo,\
   ctl:ruleRemoveTargetByTag=attack-xss;ARGS:json.logo,\
   ctl:ruleRemoveTargetById=934170;ARGS:json.logo"

# MCP OAuth: native clients register and redirect to loopback IP URLs (RFC 8252). The authorize and token
# endpoints take the redirect_uri argument; registration takes a JSON array of them (array members are named
# json.redirect_uris.array_N, so the rules are removed for that one path instead).
SecRule REQUEST_FILENAME "@rx ^/oauth/mcp/(authorize|token)$" \
  "id:1000108,phase:1,pass,nolog,\
   ctl:ruleRemoveTargetById=931100;ARGS:redirect_uri,\
   ctl:ruleRemoveTargetById=934110;ARGS:redirect_uri"
SecRule REQUEST_FILENAME "@streq /oauth/mcp/register" \
  "id:1000109,phase:1,pass,nolog,\
   ctl:ruleRemoveById=931100,\
   ctl:ruleRemoveById=932130,\
   ctl:ruleRemoveById=934110"

# Only for sites that run paranoia level 2 or 3: routes that carry free text (alert and note text, runbook
# steps, OAuth parameters, SSO callbacks) stay at paranoia level 1, because levels 2 and 3 flag ordinary SQL,
# shell and HTML in that text. Everything else keeps the site-wide level.
SecRule REQUEST_FILENAME "@rx ^/(api/(events$|integrations/|runbook-agent/v1/|settings/status-page|slack/|intelligence/squire|search$|status/subscriptions$|auth/)|runbooks(/|$)|incidents(/|$)|oauth/mcp/|mcp$|login$|m/login$)" \
  "id:1000110,phase:1,pass,nolog,\
   setvar:tx.detection_paranoia_level=1,\
   setvar:tx.blocking_paranoia_level=1"
```

The CRS allows only `GET HEAD POST OPTIONS` by default (rule 911100), and the OpsKnight REST API also uses `PUT`, `PATCH` and `DELETE`. Allow them in `crs-setup.conf` (`tx.allowed_methods`) or, in the official container, with `ALLOWED_METHODS="GET HEAD POST OPTIONS PUT PATCH DELETE"`. Set `tx.max_file_size` and `SecRequestBodyLimit` to at least the [documented inbound limits](./reverse-proxy-contract#preserve-application-protocols).

**Paranoia level.** The exclusions above were checked by replaying 22 request shapes (SSO callbacks, Next.js navigations and Server Actions, runbook steps, alert and provider payloads including a 900 KB body, status-page branding, MCP OAuth and JSON-RPC, Slack and GitHub webhooks) through CRS 4.30 on nginx, with 10 hostile requests alongside:

| Paranoia level | Legitimate requests passed | Hostile requests blocked |
|---|---|---|
| 1, with these exclusions | 22 of 22 | 9 of 10 |
| 2 or 3, with these exclusions and the paranoia override | 22 of 22 | 9 of 10 |
| 2 or 3, without the override | 8 of 22 (level 2), 4 of 22 (level 3) | 9 of 10 |

Levels 2 and 3 add the SQL, shell and HTML rule families (941xxx, 942xxx, 932xxx and 931130), which flag ordinary alert text, notes, runbook steps and OAuth parameters. So the last rule in the file keeps those free-text routes at level 1 and leaves the rest of the site at your level. Use it only if you run level 2 or 3; it is the one place the file widens what reaches OpsKnight beyond a single rule. The one hostile request that passed is an XML body with an external entity sent to `/api/integrations/custom`: the CRS does not block it at any level, and OpsKnight does not parse XML bodies.

Runbook draft and import endpoints are Server Actions, which are POSTs to the page path. The file excludes the RCE and file-inclusion rules by path (`/runbooks/`) and method. In testing, a rule that waited for the `Next-Action` header did not match on CRS 4.30 with nginx, so do not rely on a header condition without trying it on your build.

## Run internal calls off the WAF

The middleware looks up status-page domains by calling OpsKnight itself, at `INTERNAL_API_URL`, which defaults to `http://127.0.0.1:<PORT>`. Do not point `INTERNAL_API_URL` at the public, WAF-fronted URL. If the WAF blocks that call, every host configured only in the database answers **421 Misdirected Request**, which looks like a site-wide outage. OpsKnight logs a warning when that lookup fails while `INTERNAL_API_URL` points at the public application URL. In split deployments, use the in-cluster Service address.

## Production and security considerations

Exclusions widen what reaches the application, so keep each one as narrow as the WAF allows and review the list when you upgrade. OpsKnight still validates every input, signature and callback target on its own; WAF exclusions do not turn those checks off. Do not exclude authentication or webhook paths from rate limiting.

## Verify every layer

With the WAF in blocking mode, confirm that each of these works and that no rule appears in the WAF log:

1. SSO sign-in from a deep link, such as `/incidents?status=open`, lands on that link.
2. A status page on a custom domain with **Require authentication** sends you through sign-in and back to the status host.
3. A forced sign-out on the mobile site (`/m`) returns to `/m/login`.
4. Saving and publishing a runbook with a shell step.
5. A test event to one integration, and one signed provider webhook.
6. A Runbook Agent heartbeat.
7. Uploading a status-page logo.

## Troubleshooting

- **403 from the WAF right after the IdP redirects back:** the OIDC callback query is too long or contains `iss`. Add the callback exclusion.
- **403 when saving or testing SSO settings:** a rule matched the issuer URL or client secret in the `/api/auth/control` body. Add the SSO settings exclusion.
- **Status pages answer 421 for every custom domain:** the middleware status-domain lookup is going through the WAF. Point `INTERNAL_API_URL` at loopback or the in-cluster Service.
- **Saving a runbook fails but loading it works:** a remote-code-execution or body-size rule is blocking the Server Action. Exclude it for requests with the `Next-Action` header.
- **A search containing `${jndi:` returns a bare 403 page:** the Log4Shell rule of the managed set blocks the `GET /api/search` query. It is expected for that string; the command palette reports that the search failed. Search for other text, or exclude the rule for the `q` argument on `/api/search` only if you need to search for it.
- **The Runbook Agent goes offline after the WAF is enabled:** a bot or user-agent rule is blocking it. Allow `OpsKnight-Agent/` on `/api/runbook-agent/v1/`.

## Related guides

- [Reverse-proxy contract](./reverse-proxy-contract)
- [Application URL and host routing](./application-url-and-host-routing)
- [Misdirected Request](../../troubleshooting/installation/misdirected-request)
