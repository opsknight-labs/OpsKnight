---
order: 3
title: API Rate Limiting
description: Understand v1.5 API-key, event, integration, status API, and subscription limits and their exact client-visible behavior.
---

# API Rate Limiting

OpsKnight uses PostgreSQL counters for the published API and standard integration limits. Counters coordinate across application replicas that share a database and are removed by scheduled maintenance after expiration.

Limits are route-specific. There is no single middleware that adds rate-limit headers to every `/api/*` response.

## Published limits

| Surface                               | Key/bucket                                        |                                                                                                  Default limit |
| ------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------: |
| Events API                            | Integration ID or API-key identity, Events bucket |                                                                                    120 requests per 60 seconds |
| Incidents list/detail                 | API key, shared `get` bucket                      |                                                                                     60 requests per 60 seconds |
| Incidents create                      | API key, `post` bucket                            |                                                                                     60 requests per 60 seconds |
| Incidents patch                       | API key, `patch` bucket                           |                                                                                     60 requests per 60 seconds |
| Standard provider integration handler | Integration ID                                    |                                                                                    100 requests per 60 seconds |
| Status-page subscribe                 | Source IP                                         |                                                                                     10 requests per 60 seconds |
| Status-page subscribe                 | Status page plus normalized email                 |                                                                                      3 requests per 60 seconds |
| Public status JSON API                | Valid token hash, otherwise source IP             | Disabled by default; when enabled, defaults to 120 requests per 60 seconds and is configurable per status page |

Provider-specific/legacy integration routes can have their own handler behavior. Load-test the exact endpoint you deploy; do not assume the standard 100/minute value applies to every adapter.

## Fixed-window behavior

The database key includes the current fixed time window. Every accepted or rejected check increments the counter. `resetAt` is the beginning of the next window.

This is not a queue and it does not smooth traffic. A burst at a window boundary can produce a different traffic shape than a rolling-window limiter. Clients should still pace requests.

If the database rate-limit check throws, OpsKnight fails closed for external traffic and returns the normal limited response. Explicit health/internal buckets remain available for recovery diagnostics. Database readiness, limiter errors, and 429 monitoring therefore all matter.

## HTTP 429 contract

Events and Incidents return:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 17
Content-Type: application/json
```

```json
{ "error": "Rate limit exceeded." }
```

`Retry-After` is the ceiling of seconds until the fixed window resets.

The standard integration handler additionally returns:

```http
X-RateLimit-Remaining: 0
X-RateLimit-Reset: UNIX_SECONDS
Retry-After: SECONDS
```

with:

```json
{ "error": "RATE_LIMITED", "message": "Rate limit exceeded" }
```

Successful published API responses do not universally include limit/remaining/reset headers. Do not build a client that requires those headers before every request.

## Client behavior

1. Stop sending to the affected bucket when HTTP 429 is received.
2. Parse `Retry-After` as seconds and wait at least that long.
3. Add jitter before retrying a fleet of workers.
4. Bound retries and surface permanent failure to the owning team.
5. Retry only idempotent operations automatically.

For alert lifecycle delivery, the Events API is idempotent around a stable `dedup_key`. The Incidents create endpoint has no deduplication key; blindly retrying it can create duplicate incidents.

```javascript
async function requestWithRateLimitRetry(url, options, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, options);
    if (response.status !== 429 || attempt === attempts) return response;

    const seconds = Number(response.headers.get('retry-after') || '1');
    const jitterMs = Math.floor(Math.random() * 500);
    await new Promise(resolve => setTimeout(resolve, seconds * 1000 + jitterMs));
  }
}
```

## Operator controls

`INTEGRATION_RATE_LIMIT=false` disables rate limiting in the standard integration handler only. It does not disable Events, Incidents, subscription, or status API limits. Disabling it on an internet-facing deployment removes an abuse control and should be limited to a controlled diagnostic window.

Status API limits and windows are configured on the status page. There is no per-API-key custom-limit form or published API for creating keys with a custom limit.

Application API and standard integration constants are code-defined in v1.5. Changing them requires maintaining a custom application build and updating this public contract; prefer pacing and workload design first.

## Operations

- Keep the internal scheduler enabled on at least one healthy application process so expired counter records are cleaned up.
- Monitor 429 response volume by route/integration without logging secrets.
- Monitor PostgreSQL availability and growth of the rate-limit table.
- Use distinct integration/API keys per producer so one producer cannot consume another's bucket.
- Preserve correct client IP forwarding for IP-keyed status and subscription paths; trust only your configured proxies.

The authenticated `/api/metrics` endpoint publishes application/job health metrics, but not per-key rate-limit counters. Configure `PROMETHEUS_SCRAPE_TOKEN` and send it as a Bearer token, or use an Admin session for interactive diagnosis. Internal requests do not receive a universal bypass header.

## Troubleshooting

| Symptom                                        | Check                                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 429 sooner than expected                       | Shared key/integration across workers, shared `get` bucket, retries, or a boundary-time burst. |
| Every producer throttles together              | Producers reuse one API or integration key; issue separate least-privilege keys.               |
| Counters accumulate                            | Internal scheduler disabled/failing or PostgreSQL cleanup errors.                              |
| External requests are limited during DB outage | Expected fail-closed behavior; restore database readiness before reopening normal traffic.     |
| Integration ignores `INTEGRATION_RATE_LIMIT`   | It may use a legacy/provider-specific handler rather than the standard handler.                |
| Status JSON limit differs                      | Status-page owner configured a custom maximum/window or disabled it.                           |

## Related topics

- [API Reference](./README)
- [Events API](./events)
- [Incidents API](./incidents)
- [Maintenance](../deployment/maintenance)
