---
order: 4
title: Uptime Kuma
description: Send Uptime Kuma down and up events to OpsKnight with stable monitor correlation
---

# Uptime Kuma Integration

Receive alerts from Uptime Kuma.

---

## Endpoint

```
POST /api/integrations/uptime-kuma?integrationId=YOUR_INTEGRATION_ID&integrationKey=YOUR_INTEGRATION_KEY
```

---

## Setup

### Step 1: Create Integration in OpsKnight

1. In OpsKnight, go to **Service -> Integrations**.
2. Add a **Uptime Kuma** integration.
3. Copy the **Webhook URL**:
   `https://[YOUR_DOMAIN]/api/integrations/uptime-kuma?integrationId=[ID]&integrationKey=[KEY]`

### Step 2: Configure Uptime Kuma

1. Go to **Settings -> Notifications**.
2. Click **Setup Notification**.
3. Notification Type: **Webhook**.
4. Friendly Name: OpsKnight.
5. Post URL: Paste the OpsKnight Webhook URL.
6. Content Type: `application/json`.
7. Test and Save.

## Payload Format

Uptime Kuma sends:

```json
{
  "heartbeat": {
    "status": 0,
    "msg": "Connection timeout",
    "monitorID": 1
  },
  "monitor": {
    "name": "My API",
    "url": "https://api.example.com"
  }
}
```

## Event Mapping

| Status Code | Meaning | OpsKnight Action |
| ----------- | ------- | ---------------- |
| `1`         | Up      | Resolve incident |
| `0`         | Down    | Trigger incident |

## Deduplication

The key is the raw `heartbeat.monitorID`, falling back to raw `monitor.id`. Only when both IDs are absent does OpsKnight use `uptime-kuma-<normalized monitor name>`. Keep the same ID in down and up deliveries.

## Testing

### Using Uptime Kuma UI

1. Go to **Settings** -> **Notifications**
2. Click **Test** on your defined notification

### Using cURL

```bash
curl -X POST "https://YOUR_OPSKNIGHT_URL/api/integrations/uptime-kuma?integrationId=YOUR_ID&integrationKey=YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "heartbeat": { "status": 0, "msg": "Test Down", "monitorID": 99 },
    "monitor": { "name": "Test Monitor" }
  }'
```

## Status Logic

OpsKnight translates status codes:

| Status Code     | Meaning | Action             |
| --------------- | ------- | ------------------ |
| `1`             | UP      | Resolve            |
| `0` (or others) | DOWN    | Trigger (Critical) |

This supports both numeric status codes and string values like "Up" or "Resolved".

## Security and validation

The complete URL contains the required integration key. The optional generic signature requires an unprefixed raw-body HMAC-SHA256 digest in `X-Signature` or `X-Webhook-Signature`. Uptime Kuma's direct webhook does not automatically emit that contract; leave the OpsKnight signing secret unset or use a trusted signing gateway.

The notification **Test** proves delivery but might not contain a real monitor ID or both lifecycle states. Force one disposable monitor down and back up, confirm both requests receive HTTP `202`, and verify the same incident resolves. The default integration limit is 100 requests per 60 seconds per integration.

If recovery misses, compare `heartbeat.monitorID` and `monitor.id` in both raw payloads. If a request receives `401`, restore the current integration key or remove an incompatible signing secret.

## Related topics

- [Inbound webhook reference](../inbound-webhook-reference)
- [Urgency mapping](../../core-concepts/urgency-mapping)
- [Troubleshooting](../../troubleshooting)
