---
order: 5
title: API Reference
description: Published Events and Incidents contracts, API-key authentication, rate limits, and the supported CLI.
---

# API Reference

Only the pages listed here are published automation contracts for v1.4. Other `/api/*` routes support the OpsKnight UI or integrations and can change without public-API compatibility guarantees.

| Guide                            | Use it for                                                          |
| -------------------------------- | ------------------------------------------------------------------- |
| [Events API](./events)           | Trigger, acknowledge, and resolve a deduplicated monitoring event.  |
| [Incidents API](./incidents)     | List, create, read, and update supported incident fields.           |
| [Rate limiting](./rate-limiting) | Route limits, `Retry-After`, storage, cleanup, and client behavior. |
| [CLI](./cli)                     | Supported command-line workflows.                                   |

Services, schedules, users, and teams remain UI-managed public workflows in this version. Some API-key scopes and internal handlers exist for them, but no v1.4 public REST contract is published. There are no published language SDK packages.

## Create an API key

1. Open **Settings → API Keys**.
2. Create a descriptively named key and select only required scopes.
3. Copy the `ok_...` token immediately; the complete token is shown only once.
4. Store it in a secret manager, not source code or shell history.

Keys belong to the user who creates them. Incident authorization still considers that user's role, assignments, and team memberships. Disabling/removing the user or revoking the key affects automation access.

The v1.4 key form permits these scopes:

| Scope             | Published use                                                        |
| ----------------- | -------------------------------------------------------------------- |
| `events:write`    | Events API.                                                          |
| `incidents:read`  | Incident list and detail.                                            |
| `incidents:write` | Incident create and patch.                                           |
| `services:read`   | Reserved for instance/UI-backed behavior; no public services guide.  |
| `schedules:read`  | Reserved for instance/UI-backed behavior; no public schedules guide. |

An API key with no required scope receives HTTP 403. There is no `incidents:delete` public operation in v1.4.

## Authenticate

Bearer is preferred:

```http
Authorization: Bearer ok_REDACTED
```

The API-key middleware also accepts:

```http
Authorization: Api-Key ok_REDACTED
```

or:

```http
X-API-Key: ok_REDACTED
```

Never send API keys in query parameters. Use HTTPS in production.

## Base URL and JSON

All paths are relative to the OpsKnight origin:

```text
https://ops.example.com/api
```

Send JSON request bodies with `Content-Type: application/json`. Successful responses are route-specific rather than wrapped in a universal `data` envelope. Errors use an `error` string and can include validation details under `meta`.

```json
{
  "error": "Invalid request body.",
  "meta": {
    "issues": []
  }
}
```

Common statuses are 400 invalid input, 401 invalid/missing key, 403 missing scope or inaccessible resource, 404 missing resource, 429 rate limited, and 500 server failure.

## Operational rules

- Treat IDs and timestamps as opaque values.
- Honor `Retry-After` on HTTP 429 and retry idempotent requests with bounded exponential backoff and jitter.
- Do not automatically retry a create request unless your automation can prove it did not succeed; prefer the Events API when deduplication is required.
- Record request purpose and response status without logging tokens or sensitive payload data.
- Test against a non-production service and verify resulting escalation/notifications before production rollout.

## Key rotation

Create a replacement key, deploy it to consumers, confirm `lastUsedAt` moves on the replacement, then revoke the old key. If `API_KEY_SECRET` or its default `NEXTAUTH_SECRET` basis changes without a migration plan, stored key hashes can no longer be matched; rotate keys deliberately.

## Related topics

- [Events API](./events)
- [Incidents API](./incidents)
- [Rate limiting](./rate-limiting)
- [Security](../security/README)
