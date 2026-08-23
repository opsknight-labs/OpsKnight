---
order: 1
title: UptimeRobot
description: Trigger and resolve OpsKnight incidents from UptimeRobot down and up notifications.
---

# UptimeRobot integration

The UptimeRobot adapter turns a monitor-down notification into a trigger and the matching monitor-up notification into a resolve for one OpsKnight service. It accepts JSON or URL-encoded form data in the POST body.

## Configure OpsKnight

1. Go to **Services → select a service → Integrations**.
2. Add an **UptimeRobot** integration.
3. Copy its integration ID and integration key.
4. Build the webhook URL:

```text
https://ops.example.com/api/integrations/uptimerobot?integrationId=INTEGRATION_ID&integrationKey=INTEGRATION_KEY
```

The query key is supported because webhook senders do not always allow custom authentication headers. Treat the complete URL as a secret because it can appear in UptimeRobot, proxy, and application logs.

## Configure UptimeRobot

Create a webhook alert contact and attach it to the intended monitors. Configure the POST body to include, at minimum, a stable `monitorID`, the monitor name, and the alert type. The adapter accepts these fields:

| Field                   | Purpose                                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| `monitorID`             | Preferred stable deduplication key.                                    |
| `monitorFriendlyName`   | Incident summary and deduplication fallback when no monitor ID exists. |
| `alertType`             | Down/up lifecycle value.                                               |
| `alertTypeFriendlyName` | Summary fallback.                                                      |
| `alertDetails`          | Provider detail retained in incident custom details.                   |
| `alertDateTime`         | Provider timestamp retained in incident custom details.                |

Example JSON body:

```json
{
  "monitorID": 12345,
  "monitorFriendlyName": "Public API",
  "alertType": "1",
  "alertTypeFriendlyName": "Down",
  "alertDetails": "Connection timeout"
}
```

Do not configure an OpsKnight signature secret unless the sender or a trusted intermediary can create the generic signature required by OpsKnight: `X-Signature` or `X-Webhook-Signature` containing the raw hexadecimal HMAC-SHA256 of the exact request body. UptimeRobot setup still always requires the integration key.

## Lifecycle and severity

| `alertType`                                  | OpsKnight action | Normalized severity |
| -------------------------------------------- | ---------------- | ------------------- |
| `1`, `down`, or text containing `down`       | Trigger          | `critical`          |
| `2`, `up`, or text containing `up`           | Resolve          | `info`              |
| Any other value, including pause-like values | Trigger fallback | `critical`          |

Use UptimeRobot's down (`1`) and up (`2`) notifications for a predictable lifecycle. Service urgency mappings determine the final incident urgency.

## Deduplication and recovery

When `monitorID` is present, its string value is used directly as the deduplication key. Otherwise OpsKnight uses a normalized name-based fallback such as `uptimerobot-public-api`.

Down, repeated-down, and up requests must produce the same key. A repeated down event updates the matching active incident instead of creating another one; an up event resolves that matching incident. If the recovery payload omits or changes the monitor ID/name used by the trigger, it cannot resolve the same incident. A later down event after resolution can create a new incident for the same monitor.

## Test before production

Send down and up events with the same synthetic monitor ID:

```bash
export OPSKNIGHT_URL="https://ops.example.com"
export INTEGRATION_ID="replace-me"
export INTEGRATION_KEY="replace-me"

curl --fail-with-body \
  --request POST \
  "${OPSKNIGHT_URL}/api/integrations/uptimerobot?integrationId=${INTEGRATION_ID}" \
  --header "Content-Type: application/json" \
  --header "X-Integration-Key: ${INTEGRATION_KEY}" \
  --data '{
    "monitorID": 8888,
    "monitorFriendlyName": "OpsKnight synthetic",
    "alertType": "1",
    "alertDetails": "Controlled down test"
  }'
```

Repeat with `"alertType": "2"`. Accepted requests normally return HTTP 202. Confirm one incident is triggered for the intended service, the recovery resolves it, and the intended responder notification is delivered.

## Troubleshooting

| Symptom                                | Check                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Request is rejected as malformed       | Send POST body data as valid JSON or URL-encoded form data; do not put alert fields only in the query string. |
| Recovery creates/targets no incident   | Compare `monitorID` in both bodies; if absent, compare the exact monitor name used for fallback.              |
| Every event triggers                   | Ensure UptimeRobot sends `alertType=2` for recovery rather than a localized/custom value.                     |
| 401 signature error                    | Clear an unusable signature secret or have the sender produce the exact generic raw-body HMAC.                |
| 429 rate limited                       | Honor `Retry-After` and investigate retry storms or too many monitors sharing one integration.                |
| Accepted but no responder notification | Inspect the incident timeline, escalation target, notification history, and provider configuration.           |

## Related topics

- [Inbound webhook reference](../inbound-webhook-reference)
- [How integrations work](../../core-concepts/integrations)
- [API rate limiting](../../api/rate-limiting)
- [Troubleshooting](../../troubleshooting)
