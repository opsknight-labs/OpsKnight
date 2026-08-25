---
title: Webhook authentication and signatures
description: Exact inbound integration authentication, optional provider signatures, Slack verification, and outbound signature formats
version: v1.5
order: 4
---

# Webhook authentication and signatures

OpsKnight has several webhook systems with different credentials and signature formats. Do not copy a header from one system into another. This page separates provider-native inbound integration routes, the published Events API, Slack callbacks, service webhooks, and status-page webhooks.

## Provider-native inbound routes

Routes under `/api/integrations/<provider>` use an integration ID plus integration key. The shared form is:

```text
POST /api/integrations/PROVIDER?integrationId=INTEGRATION_ID
```

Send the matching integration key with one of these methods:

```http
Authorization: Bearer INTEGRATION_KEY
```

```http
X-Integration-Key: INTEGRATION_KEY
```

The shared middleware also accepts `Authorization: Token token=…`, `X-API-Key`, or query key `integrationKey`, `integration_key`, or `key`. Headers are safer because query strings commonly appear in logs. Key equality uses a timing-safe comparison.

The integration must exist and be enabled. The route validates against the route's provider schema, but v1.4 does not separately enforce that the stored integration `type` equals the provider path segment. Keep each integration ID/key pair secret, configure only its intended upstream sender, and test the exact route shown in the service UI.

The PagerDuty-compatible adapter has different key locations. The published `/api/events` endpoint also has a different authentication contract. Use [Inbound webhook reference](../integrations/inbound-webhook-reference) and [Events API](../api/events) instead of assuming the shared middleware rules apply.

## Optional provider signatures

The integration key is always required by the shared provider middleware. A second provider signature is verified only when all of these are true:

- the route has a signature mode;
- the integration has `signatureSecret` configured;
- the route does not explicitly skip signature verification; and
- `INTEGRATION_VERIFY_SIGNATURES` is not set to `false`.

Signature verification is enabled by default. Setting `INTEGRATION_VERIFY_SIGNATURES=false` weakens the boundary for every route using the shared handler and should be limited to controlled diagnosis.

| Mode         | Routes                                          | Expected signature                                                                              |
| ------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| GitHub       | GitHub                                          | `X-Hub-Signature-256: sha256=<HMAC-SHA256 of raw body>`                                         |
| GitLab token | GitLab and, currently, Zabbix                   | `X-Gitlab-Token` exactly matches the configured signature secret                                |
| Sentry       | Sentry                                          | `Sentry-Hook-Signature: <hex HMAC-SHA256 of raw body>`                                          |
| Grafana      | Grafana                                         | `X-Grafana-Signature: <hex HMAC-SHA256 of raw body>`                                            |
| Vercel       | Vercel                                          | `X-Vercel-Signature: <hex HMAC-SHA1 of raw body>`                                               |
| Generic      | Provider routes listed in the inbound reference | `X-Signature` or `X-Webhook-Signature` with hex HMAC-SHA256 of raw body and no `sha256=` prefix |

CloudWatch, Azure Monitor, New Relic, and Prometheus currently rely on the integration key in their provider route rather than an additional signature mode. CloudWatch SNS subscription confirmation separately validates the confirmation URL before fetching it.

Provider signatures are computed over the raw request body. Any proxy or middleware that reformats JSON before OpsKnight receives it will change the bytes and invalidate HMAC verification.

## Slack callbacks

Slack actions, commands, and events use Slack request signing rather than an integration key. OpsKnight reads `X-Slack-Request-Timestamp` and `X-Slack-Signature`, rejects timestamps outside the five-minute window, calculates Slack's `v0` HMAC-SHA256 base string over the raw body, and compares the signature safely.

Signing-secret lookup uses the configured Slack workspace secret with `SLACK_SIGNING_SECRET` as an optional environment override. Keep the Slack OAuth routes and callback URLs exactly as documented in [Slack OAuth setup](../integrations/communication/slack-oauth-setup) and [Slack ChatOps](../integrations/communication/slack-chatops).

## Outbound service webhooks

When a service webhook has a secret, OpsKnight sends:

```http
X-OpsKnight-Timestamp: 1786973846000
X-OpsKnight-Signature: sha256=HEX_HMAC
```

The timestamp is Unix time in **milliseconds**. The signed bytes are:

```text
TIMESTAMP + "." + EXACT_JSON_BODY
```

Receiver verification procedure:

1. Read the request body as raw bytes/text before JSON reserialization.
2. Parse `X-OpsKnight-Timestamp` as milliseconds and enforce the freshness window required by your organization.
3. Calculate HMAC-SHA256 over `timestamp + "." + rawBody` with the shared secret.
4. Add the `sha256=` prefix and compare without timing leaks.
5. Reject missing, stale, or mismatched requests before processing the event.

OpsKnight signs the timestamp but the receiving system decides how much clock skew and replay age to allow.

## Outbound status-page webhooks

Status-page webhooks use a different contract:

```http
X-Webhook-Signature: sha256=HEX_HMAC
X-Webhook-Event: incident.created
X-Webhook-Delivery: UUID
X-Webhook-Timestamp: 1786973846000
```

The timestamp is Unix time in milliseconds. The HMAC-SHA256 input is `timestamp + "." + exactJsonBody`. Verify the raw body and timestamp exactly as described for service webhooks, reject stale timestamps, and use `X-Webhook-Delivery` as an idempotency key. The same delivery ID and signature are retained across retries.

Outbound service and status-page webhook destinations are revalidated before every attempt, redirects are rejected, and private/reserved network destinations are blocked. Receivers should still require HTTPS, a unique secret, bounded replay age, and idempotent processing.

## Secret rotation

Inbound provider signature secrets and keys do not support a documented two-key overlap in one integration. Coordinate rotation with the sender, update the OpsKnight integration, immediately update the upstream destination/header, and run failure and recovery tests.

For outbound webhooks, update both OpsKnight and the receiver in a controlled window. If the receiver supports multiple verification secrets, accept old and new briefly, then remove the old value after observing successful signed deliveries.

## Troubleshooting

**Integration key is rejected**

Confirm the ID and key come from the same enabled integration. Check for whitespace and confirm a proxy did not remove `Authorization` or custom headers.

**Signature is missing after adding a signature secret**

The sender must generate the exact header required by the route. Remove the signature secret only if your security policy accepts integration-key-only authentication.

**Signature mismatches**

Capture a sanitized raw-body hash and header names at both sides. Check HMAC algorithm, prefix, hexadecimal encoding, body bytes, timestamp units, proxy transformations, and secret version. Never log the secret or complete authenticated query URL.

**Slack reports retries or timeouts**

Verify the public URL, proxy body handling, timestamp clock skew, signing secret, and route path. Slack requires a timely acknowledgment even when longer processing continues separately.

## Related topics

- [Inbound webhook reference](../integrations/inbound-webhook-reference)
- [Custom webhooks](../integrations/custom/webhooks)
- [Status page](../core-concepts/status-page)
- [Slack ChatOps](../integrations/communication/slack-chatops)
- [Secrets and encryption](./encryption)
