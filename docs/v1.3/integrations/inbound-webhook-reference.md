---
order: 1
title: Inbound Webhook Reference
description: Exact authentication, signature, lifecycle, deduplication, and response behavior for every provider-native inbound route
---

# Inbound Webhook Reference

This page defines the shared v1.3 contract for provider-native inbound webhooks. Use the provider guide for upstream configuration and this reference for OpsKnight request behavior.

## Endpoint and authentication

Provider routes use this form:

```text
POST https://ops.example.com/api/integrations/PROVIDER?integrationId=INTEGRATION_ID
```

`PROVIDER` is the literal route segment listed in the [integration catalog](./README); it is not the word `PROVIDER`.

Every request requires the integration key in one of these locations:

```http
Authorization: Bearer INTEGRATION_KEY
```

```http
X-Integration-Key: INTEGRATION_KEY
```

The middleware also accepts `Authorization: Token token=…`, `X-API-Key`, or the `integrationKey`, `integration_key`, or `key` query parameter. Prefer a header whenever the sender supports custom headers. A query key can appear in proxy, browser, and provider logs, so treat the complete webhook URL as a secret when a provider requires it.

The integration must exist, be enabled, and point to the intended service. The route validates the route-specific provider schema, but v1.3 does not separately compare the stored integration type with the route segment. Protect each integration ID/key pair and use only the URL generated for its intended sender. A workspace API key is not interchangeable with an integration key.

## Optional signature verification

The integration key is always required. When a signature secret is configured on the integration, OpsKnight also verifies the raw request according to the route's signature mode unless `INTEGRATION_VERIFY_SIGNATURES=false`. Verification is enabled by default; the environment override is a diagnostic escape hatch, not a production baseline.

| Signature mode | Routes                                                                                                                                                                                                                | Required header and calculation                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| GitHub         | `github`                                                                                                                                                                                                              | `X-Hub-Signature-256: sha256=<hex HMAC-SHA256>`                                                                    |
| GitLab         | `gitlab`; currently also `zabbix`                                                                                                                                                                                     | `X-Gitlab-Token` must equal the configured signature secret.                                                       |
| Sentry         | `sentry`                                                                                                                                                                                                              | `Sentry-Hook-Signature` is the hexadecimal HMAC-SHA256 of the raw body.                                            |
| Grafana        | `grafana`                                                                                                                                                                                                             | `X-Grafana-Signature` is the hexadecimal HMAC-SHA256 of the raw body.                                              |
| Vercel         | `vercel`                                                                                                                                                                                                              | `X-Vercel-Signature` is the hexadecimal HMAC-SHA1 of the raw body.                                                 |
| Generic        | AppDynamics, Better Uptime, Bitbucket, Datadog, Dynatrace, Elastic, Google Cloud Monitoring, Honeycomb, Icinga, Nagios, Pingdom, Splunk Observability, Splunk On-Call, Uptime Kuma, UptimeRobot, and generic webhooks | `X-Signature` or `X-Webhook-Signature` is the hexadecimal HMAC-SHA256 of the raw body, without a `sha256=` prefix. |

Do not configure a signature secret until the sender can produce the exact required header. Missing or invalid signatures are rejected when a secret is present and verification is enabled. CloudWatch, Azure Monitor, New Relic, and Prometheus currently use the integration-key boundary without an additional provider-signature mode in their route.

## Provider lifecycle and deduplication

OpsKnight normalizes each accepted payload to `trigger`, `acknowledge`, or `resolve`. Resolution works only when the recovery payload produces the same deduplication key as the trigger.

| Provider                                                         | Trigger / update behavior                                                                                                        | Resolve behavior                                                                       | Stable deduplication basis                                              |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| AWS CloudWatch                                                   | Any alarm state other than `OK` triggers. Direct alarm JSON and SNS-wrapped alarm JSON are accepted.                             | `NewStateValue=OK`.                                                                    | AWS account when present + region + alarm name.                         |
| Azure Monitor                                                    | `monitorCondition=Fired` or `Activated`.                                                                                         | Any other monitor condition, normally `Resolved`.                                      | Alert ID, falling back to context ID.                                   |
| Google Cloud Monitoring                                          | States not recognized as acknowledgement or recovery trigger.                                                                    | State containing resolved, closed, recovered, OK, or up.                               | Incident ID; otherwise policy/resource or summary.                      |
| Datadog                                                          | Monitor/alert status other than resolved/OK or `alert_type=success`. Arrays can create multiple normalized events.               | Resolved/OK status or success alert type.                                              | Alert ID, monitor ID, or stable title hash.                             |
| Grafana                                                          | Legacy `alerting`/`no_data` and Alertmanager firing alerts trigger.                                                              | Legacy `ok` or Alertmanager resolved state.                                            | Rule ID/name, or alert name plus instance.                              |
| Prometheus Alertmanager                                          | Firing alerts trigger; each alert is processed separately. An empty array acknowledges an informational event.                   | Resolved group/alert.                                                                  | Fingerprint; otherwise a hash of stable labels or alert name.           |
| New Relic                                                        | Open/activated incident or alert payloads trigger; unknown formats acknowledge.                                                  | Closed/resolved state or resolved event type.                                          | Incident/alert ID or stable APM alert hash.                             |
| Dynatrace, AppDynamics, Elastic, Honeycomb, Splunk Observability | Provider status is normalized; unknown states trigger.                                                                           | Resolved/closed/recovered/OK/up states.                                                | Provider incident/event/detector ID, then a stable name-based fallback. |
| Sentry                                                           | Created/reopened issues and event payloads trigger; assigned, unassigned, or ignored issues acknowledge.                         | Resolved issue/action.                                                                 | Issue ID or event group key.                                            |
| Nagios and Icinga                                                | Problem/down/critical states trigger; acknowledgement states acknowledge.                                                        | Recovery/OK/up states.                                                                 | Host plus service, or host for host checks.                             |
| Zabbix                                                           | Problem/value `1` triggers; ACK/update acknowledges.                                                                             | Resolved/OK/recovered or value `0`.                                                    | Event ID, then trigger ID, then host/summary.                           |
| GitHub                                                           | Failed workflow, check, or deployment triggers; queued/in-progress/pending acknowledges.                                         | Successful workflow, check, or deployment.                                             | Repository plus workflow/check/branch, or deployment ID.                |
| GitLab                                                           | Failed pipeline/deployment or open issue triggers as applicable; running/pending/canceled and non-actionable events acknowledge. | Successful pipeline/deployment, merged/closed merge request, or closed/resolved issue. | Project plus pipeline/ref, merge request, environment, or issue ID.     |
| Bitbucket                                                        | Non-success pipeline/build status triggers.                                                                                      | Successful/completed-success status.                                                   | Repository plus commit-status name when present.                        |
| Vercel                                                           | Deployment error/failed triggers; created/canceled/unknown events acknowledge.                                                   | Deployment succeeded/ready.                                                            | Production project/target; non-production project/target/deployment ID. |
| UptimeRobot                                                      | Down (`1`) triggers.                                                                                                             | Up (`2`).                                                                              | Monitor ID or monitor name.                                             |
| Pingdom                                                          | Down states trigger.                                                                                                             | Up/resolved state.                                                                     | Check ID or check name.                                                 |
| Better Uptime                                                    | Started/open/down state triggers; acknowledged state acknowledges.                                                               | Resolved/recovered state.                                                              | Incident ID or incident name.                                           |
| Uptime Kuma                                                      | Heartbeat status `0` or non-up state triggers.                                                                                   | Heartbeat status `1` or up/resolved text.                                              | Monitor ID or monitor name.                                             |
| Splunk On-Call                                                   | Problem state/message type triggers; acknowledgement state acknowledges.                                                         | Resolved/recovered state.                                                              | Incident, entity, or alert ID; then entity name.                        |

Severity mapping normalizes common provider values to `critical`, `error`, `warning`, or `info`. Service urgency rules can further determine incident urgency; do not assume every provider severity creates the same paging behavior without a synthetic test.

## CloudWatch subscription confirmation

The CloudWatch route accepts SNS `SubscriptionConfirmation`. It validates and normalizes the `SubscribeURL` before requesting it, restricting the destination to HTTPS under an Amazon SNS hostname. Successful confirmation returns HTTP 200. Alarm notifications return the normal accepted response.

## Responses and rate limits

Accepted event requests normally return HTTP 202 with a JSON result. Common failures are:

| Status | Meaning                                                                                                                           |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 400    | Missing ID/key, malformed JSON, invalid key on standardized-handler routes, or invalid payload.                                   |
| 401    | Invalid key on legacy-handler routes, disabled integration on standardized-handler routes, or missing/invalid required signature. |
| 403    | Disabled integration on legacy-handler routes.                                                                                    |
| 404    | Integration not found.                                                                                                            |
| 429    | Per-integration rate limit exceeded; honor `Retry-After`.                                                                         |
| 500    | Unexpected processing failure.                                                                                                    |

Provider routes are being consolidated on the standardized handler, so some authentication failures currently differ between `400`, `401`, and `403`. Treat all three as non-retryable configuration/authentication failures; inspect the JSON message rather than branching only on one status.

Integration routes default to 100 requests per 60 seconds per integration when integration rate limiting is enabled. Rate-limit responses include remaining/reset information; successful routes do not guarantee every provider displays those headers.

## Production acceptance

For every configured provider, test a failure and recovery using the real upstream sender. Confirm the first event creates or updates the intended service incident, repeated events deduplicate, recovery resolves the same incident, invalid credentials are rejected, and responders receive the expected notification. Preserve the provider delivery record and OpsKnight event/timeline evidence for troubleshooting.

## Related topics

- [Integration catalog](./README)
- [How integrations work](../core-concepts/integrations)
- [Webhook verification](../security/webhook-verification)
- [Rate limiting](../api/rate-limiting)
- [Troubleshooting](../troubleshooting)
