---
title: How integrations work
description: Understand inbound routing, authentication, signing, normalization, deduplication, recovery, and safe credential operations.
order: 12
---

# How integrations work

Provider-native integrations convert an external webhook into the same trigger, acknowledge, and resolve model used by the Events API. They are service-scoped: the selected integration record determines which service receives the event.

```text
Provider webhook
  → integration ID and key validation
  → optional provider-specific signature validation
  → payload schema and normalization
  → service-scoped deduplication
  → incident action
  → escalation and configured outbound notifications
```

See the [integration catalog](../integrations/README.md) for exact routes and vendor guides.

## Create an inbound integration

Application **Responders** and **Admins** can manage service integrations.

1. Open **Services**, select the receiving service, and switch to the **Integrations & Webhooks** tab.
2. Select **Add Monitoring Integration** to browse available providers by category.
3. Choose a provider type, enter a descriptive integration name, and create the integration.
4. From the newly generated integration card:
   - For **Events API v2**: copy the unique **Routing / API Key** and use the provided `curl` quick test.
   - For **Provider Webhooks**: copy the complete **Webhook Ingest URL**.
5. **Optional Signature Verification**: By default, signature verification is disabled (`No secret configured`), allowing senders that do not support HMAC signatures to function with standard key authentication. If your upstream provider supports HMAC webhook signing, click **Generate Secret** and configure the resulting 32-byte secret in your provider's webhook settings.
6. Send a synthetic trigger and recovery alert to verify intake.

An integration record contains its ID, type, service, generated 32-character hexadecimal routing key, enabled state, and optional HMAC signature secret.

## Authenticate provider-native routes

The standard native route shape is:

```text
POST /api/integrations/PROVIDER?integrationId=INTEGRATION_ID
```

The request must also provide the integration key. Accepted forms are:

```http
Authorization: Bearer INTEGRATION_KEY
```

```http
Authorization: Token token=INTEGRATION_KEY
```

```http
X-Integration-Key: INTEGRATION_KEY
```

`X-API-Key` is also accepted. For senders that cannot set headers, `integrationKey`, `integration_key`, or `key` query parameters are fallback options.

Prefer a header whenever possible. Query values leak more easily through provider UI, browser history, proxies, access logs, and monitoring. The integration ID is not a credential and does not authorize a request by itself.

The Events API uses the integration/routing key without an integration ID; follow the [Events API](../api/events.md) contract for that path.

## Optional signature verification

In OpsKnight, signature verification is **strictly optional**:

- **Default (Unconfigured)**: The integration displays `No secret configured (Signature verification disabled)`. Senders authenticate solely via their routing key in the header or URL.
- **Configured (Active)**: When a secret is generated, OpsKnight marks the integration with `Verification Active` and requires valid HMAC signatures matching the route's provider mode.
- **Removing / Disabling**: You can remove the secret at any time using the Remove Secret dialog, reverting the integration to optional key-only verification without downtime or re-creating the endpoint.

When `INTEGRATION_VERIFY_SIGNATURES` is not `false`, a stored signature secret activates the signature check for routes that do not explicitly skip it. The exact header and message construction depend on the route's provider mode, such as GitHub, GitLab, Sentry, Grafana, Vercel, or generic HMAC.

Do not assume every vendor uses `X-Signature` or the same encoding. Follow the provider guide and validate a deliberately bad signature before production. The integration key remains required even when HMAC succeeds.

## Normalization

Each adapter maps the vendor payload to:

```json
{
  "event_action": "trigger",
  "dedup_key": "provider-stable-identity",
  "payload": {
    "summary": "Human-readable alert",
    "source": "provider or monitor",
    "severity": "critical",
    "custom_details": {}
  }
}
```

Allowed actions are `trigger`, `acknowledge`, and `resolve`. Allowed normalized severities are `critical`, `error`, `warning`, and `info`. See [Urgency and severity mapping](urgency-mapping.md).

Provider payload detail is stored as alert context and must be treated as potentially sensitive. Keep secrets and unnecessary customer data out of webhook fields.

## Deduplication and recovery

Deduplication is not a global SHA-256 fingerprinting service. Each adapter deliberately constructs a stable key from provider fields such as alarm ID, monitor ID, repository/workflow, check identity, or issue ID. Event processing matches the key within the integration's service.

- A trigger with the same service and key reuses an active Open, Acknowledged, Snoozed, or Suppressed incident.
- An acknowledge or resolve action needs the same service and key to find the incident.
- A key is capped at 512 characters.
- A different integration attached to the same service can still match if it produces the same key; design adapter keys to avoid collisions.
- A recovery with a changed key cannot close the original incident.

Test the provider's real recovery payload. A provider page showing “webhook delivered” is not evidence that OpsKnight resolved the intended incident.

## Rate limiting and responses

Standard provider routes apply a per-integration PostgreSQL-backed rate limit unless `INTEGRATION_RATE_LIMIT=false` or a route explicitly skips it. The default integration limit is defined by the integration rate-limit configuration; rely on response headers rather than a hard-coded old-doc number.

Common results:

|      Status | Meaning                                                     | Sender action                                                |
| ----------: | ----------------------------------------------------------- | ------------------------------------------------------------ |
|       `202` | Valid payload accepted and processed into an event result.  | Record success.                                              |
|       `400` | Missing integration ID, malformed payload, or schema error. | Fix configuration; do not retry unchanged data.              |
| `401`/`403` | Invalid key or signature.                                   | Stop retries and rotate/fix credentials.                     |
|       `404` | Integration record not found.                               | Recreate provider URL from the service.                      |
|       `429` | Integration limit exceeded.                                 | Honor rate-limit headers and retry with backoff.             |
|       `500` | Unexpected processing failure.                              | Retry with bounded exponential backoff and investigate logs. |

Not every older route returns an identical error envelope. Test the exact provider path.

## Enable, disable, rotate, and remove

### Disable

The enabled flag is intended to stop event intake while preserving the record. In v1.4, legacy middleware rejects disabled integrations, but the newer standardized handler passes the flag to processors without consistently rejecting it. Verify the exact provider route before relying on the toggle, and treat key removal, network controls, or deletion as the effective stop when strict revocation is required. Track this behavior as a product defect rather than documenting the toggle as a universal security boundary.

### Rotate the integration key

The UI currently generates the routing key when the integration is created; it exposes rotation for the optional signature secret, not a dedicated in-place routing-key rotation. If the routing key is exposed, create a replacement integration, update and test the sender, then delete the old integration.

### Rotate or clear a signature secret

1. Coordinate a maintenance window or provider dual-secret capability.
2. Rotate the secret in OpsKnight.
3. Update the provider immediately.
4. Send valid and invalid test requests.
5. Clear a secret only when signature verification is intentionally being removed.

### Delete

Deleting an integration immediately invalidates its ID/key path and cannot be undone from the UI. Remove or update the provider destination first, preserve required audit evidence, and confirm another source covers the service.

## Test without creating noise

Use an isolated service and a unique key such as `docs-test/PROVIDER/TIMESTAMP`:

1. Send the smallest valid trigger.
2. Confirm service, source, summary, urgency, and custom detail.
3. Repeat the trigger and confirm no duplicate incident.
4. Send acknowledge if the provider supports it.
5. Send recovery and confirm the same incident resolves.
6. Send a bad key, then a bad signature, and confirm rejection.
7. Disable the integration and confirm rejection/behavior.
8. Review Event Logs, incident timeline, notification history, and server logs.

## Troubleshooting

### Request says `integrationId is required`

Use the exact URL copied from the service integration. The routing key cannot replace the record ID in the query.

### Request says invalid integration key

Confirm the key belongs to the same integration ID, remove whitespace, and use one accepted header form. Do not use a workspace API key.

### Signature validation fails

Compare the provider mode, header name, secret, raw request bytes, encoding, timestamp, and any prefix such as `sha256=`. JSON reserialization changes the signed bytes.

### Repeated alerts create duplicates

Inspect the provider guide's deduplication source and compare actual trigger payloads. Remove timestamps or random values from the identity at the provider when configurable.

### Recovery does not resolve

Compare integration/service and the normalized deduplication key between trigger and recovery. Check whether the adapter recognized the recovery state.

## Related topics

- [Integration catalog](../integrations/README.md)
- [Events API](../api/events.md)
- [Services](services.md)
- [Incident management](incidents.md)
- [Notifications](../administration/notifications.md)
