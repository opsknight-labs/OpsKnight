---
order: 1
title: Webhooks
description: Configure generic inbound alerts, service lifecycle webhooks, and status-page webhooks without confusing their contracts.
---

# Webhooks

OpsKnight v1.3 has three distinct webhook systems. Choose the one that matches the direction and ownership of your workflow.

| Need                                        | Configure at                                  | Contract                                                                              |
| ------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| Send an alert into OpsKnight                | **Service → Integrations**                    | Provider-specific or generic inbound integration endpoint.                            |
| Send a service incident lifecycle event out | **Service → Settings → Webhook Integrations** | Generic, Google Chat, Microsoft Teams, Slack, Discord, or Telegram-formatted payload. |
| Notify systems about the public status page | **Settings → Status Page → Webhooks**         | Status-page event contract, HMAC headers, attempts, and delivery log.                 |

These systems use different secrets, payloads, retry behavior, and event sets. A successful test on one does not validate another.

## Generic inbound alerts

Create a **Custom Webhook** integration on the destination service and copy the URL displayed by OpsKnight:

```http
POST /api/integrations/webhook?integrationId=INTEGRATION_ID&integrationKey=INTEGRATION_KEY
Content-Type: application/json
```

The UI-generated URL is authoritative. Keep the integration key secret and rotate/delete the integration if it is exposed.

### Payload

```json
{
  "summary": "Database connection pool exhausted",
  "severity": "critical",
  "status": "triggered",
  "dedup_key": "db-pool-primary",
  "source": "custom-monitor"
}
```

Common aliases are normalized:

| Purpose           | Accepted fields                       |
| ----------------- | ------------------------------------- |
| Title             | `summary`, `title`, `message`, `name` |
| Severity          | `severity`, `level`, `priority`       |
| Action            | `status`, `action`, `state`           |
| Deduplication key | `dedup_key`, `id`, `alert_id`         |
| Source            | `source`, `origin`, `system`          |

Trigger-like values include `triggered`, `fired`, `alert`, `critical`, `error`, and `open`. Resolve-like values include `resolved`, `ok`, `normal`, `closed`, and `fixed`; `acknowledge` and `ack` acknowledge a matching incident.

Use a stable `dedup_key` for the same alert lifecycle. Test trigger and resolve with the same key, then confirm one incident is updated rather than two incidents being created.

### Optional signature

When the integration has a Signature Secret, calculate HMAC-SHA256 over the raw request body and send either:

```http
X-Signature: HEX_HMAC_SHA256
```

or:

```http
X-Webhook-Signature: HEX_HMAC_SHA256
```

Do not reserialize JSON between signing and sending. Signature verification is enabled by default on the standard integration handler; `INTEGRATION_VERIFY_SIGNATURES=false` is a diagnostic escape hatch, not a production configuration.

See [Events API](../../api/events) for the stable public event contract and [Integrations](../README) for provider-specific endpoint names.

## Service lifecycle webhooks

Service webhooks are outbound notifications independent of escalation-policy paging and user notification preferences.

1. Open **Service → Settings**.
2. Enable the **WEBHOOK** service notification channel.
3. Choose whether service notifications fire for Triggered, Acknowledged, and Resolved events.
4. Add a webhook integration with a unique name, type, HTTPS URL, optional secret, and optional channel/room value.
5. Trigger a controlled incident and validate the receiver.

Supported formatting choices are `GENERIC`, `GOOGLE_CHAT`, `TEAMS`, `SLACK`, `DISCORD`, and `TELEGRAM`. These are payload formatters for a URL you supply; they are not workspace OAuth connections or full chat-product integrations. For Telegram, the Channel/Room field supplies the target chat ID.

### Generic payload

```json
{
  "event": { "type": "triggered", "timestamp": "2026-08-21T10:30:00.000Z" },
  "incident": {
    "id": "incident_id",
    "title": "Database connection pool exhausted",
    "description": "Primary pool has no available connections",
    "status": "OPEN",
    "urgency": "HIGH",
    "url": "https://ops.example.com/incidents/incident_id",
    "service": { "id": "service_id", "name": "API" },
    "assignee": null,
    "timestamps": {
      "created": "2026-08-21T10:30:00.000Z",
      "acknowledged": null,
      "resolved": null
    }
  }
}
```

The lifecycle event types produced by this path are `triggered`, `acknowledged`, `resolved`, and `updated`.

### Delivery and signature behavior

- Requests are JSON `POST`s with `User-Agent: OpsKnight/1.0`.
- The default timeout is 10 seconds per attempt.
- Network/timeout failures, HTTP 429, and HTTP 5xx are retried up to three total attempts with backoff.
- Other HTTP 4xx responses fail without retry.
- URLs are checked by outbound network/SSRF validation; private or restricted destinations may be rejected.
- A destination secret adds `X-OpsKnight-Timestamp` and `X-OpsKnight-Signature`.

The signature input is `TIMESTAMP + "." + RAW_JSON_BODY`. The headers are:

```http
X-OpsKnight-Signature: sha256=HEX_HMAC_SHA256
X-OpsKnight-Timestamp: UNIX_TIME_IN_MILLISECONDS
```

Compare the digest in constant time and reject stale timestamps according to your receiver's replay policy.

There is no service-webhook delivery-history UI or manual replay control in v1.3. Use receiver logs and OpsKnight system logs, then validate fixes with a new controlled event.

## Status-page webhooks

Status-page webhooks have a separate contract and delivery log. Verified runtime emitters cover `incident.created`, `incident.updated`, and `incident.resolved`; do not design an automation around other UI-listed event names until a controlled test proves emission in your deployed build.

They sign the raw body with `X-Webhook-Signature`, identify the event in `X-Webhook-Event`, use a 10-second timeout, and retry network errors, HTTP 429, and HTTP 5xx up to three total attempts. See [Status page](../../core-concepts/status-page#outbound-webhooks) for setup and exact verification guidance.

## Production verification

- [ ] The correct webhook system and service/status page are selected.
- [ ] HTTPS, DNS, certificate, firewall, and outbound policy permit the destination.
- [ ] Inbound integration keys and all signing secrets are stored as secrets.
- [ ] Trigger, acknowledge/update where applicable, and resolve are tested.
- [ ] Deduplication is tested with a repeated inbound event.
- [ ] The receiver verifies signatures against raw bytes and handles duplicates idempotently.
- [ ] Receiver latency remains below the 10-second sender timeout.
- [ ] HTTP 429/5xx retry behavior cannot create duplicate downstream work.

## Troubleshooting

| Symptom                           | Check                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| Inbound 400/401                   | Integration ID/key, signature secret, raw-body HMAC, and signature-verification setting.  |
| A new incident appears on resolve | Trigger and resolve used different or missing deduplication keys.                         |
| Outbound URL rejected             | HTTPS scheme, DNS resolution, redirect target, and private/restricted address checks.     |
| Chat receiver rejects payload     | Correct webhook type, current receiver product requirements, and a captured test payload. |
| Repeated downstream action        | Receiver idempotency; retries can repeat a logically identical delivery.                  |
| No service webhook                | WEBHOOK channel, enabled integration, selected lifecycle event, and service association.  |

## Related topics

- [Integration contract](../README)
- [Events API](../../api/events)
- [Notifications](../../administration/notifications)
- [Status page](../../core-concepts/status-page)
