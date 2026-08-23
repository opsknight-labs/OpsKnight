---
order: 6
title: Honeycomb
description: Send Honeycomb trigger and recovery notifications to OpsKnight with stable alert correlation
---

# Honeycomb Integration

Receive trigger notifications from Honeycomb.

---

## Endpoint

```
POST /api/integrations/honeycomb?integrationId=YOUR_INTEGRATION_ID&integrationKey=YOUR_INTEGRATION_KEY
```

---

## Setup

### Step 1: Create Integration in OpsKnight

1. In OpsKnight, go to **Service -> Integrations**.
2. Add a **Honeycomb** integration.
3. Copy the **Webhook URL**:
   `https://[YOUR_DOMAIN]/api/integrations/honeycomb?integrationId=[ID]&integrationKey=[KEY]`

### Step 2: Configure Honeycomb

1. Go to **Team Settings -> Integrations -> Webhooks**.
2. Add a new Webhook.
3. Name: OpsKnight.
4. URL: Paste the OpsKnight Webhook URL.
5. Add this webhook as a recipient to your Triggers.

## Payload Format

Honeycomb sends:

```json
{
  "alert_name": "High Latency",
  "alert_severity": "critical",
  "result_url": "https://ui.honeycomb.io/...",
  "status": "triggered"
}
```

## Event Mapping

| Status      | OpsKnight Action |
| ----------- | ---------------- |
| `triggered` | Trigger incident |
| `resolved`  | Resolve incident |

Values containing `ack`/`acknowledge` acknowledge an existing match. Other status/event-type values trigger.

## Correlation and security

The key is raw `alert_id` when present; otherwise it is `honeycomb-<normalized alert name>`. Trigger and recovery must use the same first available value. Renaming a trigger while relying on the fallback prevents recovery from matching.

The complete URL contains the required integration key. The optional generic signature requires an unprefixed raw-body HMAC-SHA256 digest in `X-Signature` or `X-Webhook-Signature`. Leave the signing secret unset for direct delivery unless Honeycomb or a trusted gateway emits that exact contract.

## Testing

### Using cURL

```bash
curl -X POST "https://YOUR_OPSKNIGHT_URL/api/integrations/honeycomb?integrationId=YOUR_ID&integrationKey=YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "alert_name": "Test Alert",
    "status": "triggered",
    "alert_severity": "critical"
  }'
```

## Trigger Logic

OpsKnight maps Honeycomb triggers to incidents.

- **Summary**: Derived from `alert_name` or `trigger_reason`.
- **Urgency**: Maps `alert_severity` if present, defaults to `warning`.
- **Details**: Includes the `result_url` link back to your Honeycomb query.

Test a real trigger and recovery, not only the provider's connection test. Confirm HTTP `202`, a shared `alert_id`, one resolved incident, and then the OpsKnight paging path. The default limit is 100 requests per 60 seconds per integration.

If recovery misses, inspect `alert_id`, `alert_name`, `status`, and `event_type` in both raw payloads. If OpsKnight returns `401`, restore the current integration key or remove an incompatible signing secret.

## Related topics

- [Inbound webhook reference](../inbound-webhook-reference)
- [Urgency mapping](../../core-concepts/urgency-mapping)
- [Troubleshooting](../../troubleshooting)
