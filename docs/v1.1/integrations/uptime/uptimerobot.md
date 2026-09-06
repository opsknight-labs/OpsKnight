---
order: 1
title: UptimeRobot
description: Integrate UptimeRobot alerts with OpsKnight.
---

# UptimeRobot Integration

Receive monitor alerts from UptimeRobot.

---

## Endpoint

```
POST /api/integrations/uptimerobot?integrationId=YOUR_INTEGRATION_ID
```

---

## Setup

### Step 1: Create Integration in OpsKnight

1. In OpsKnight, go to **Service -> Integrations**.
2. Add a **UptimeRobot** integration.
3. Copy the **Webhook URL**:
   `https://[YOUR_DOMAIN]/api/integrations/uptimerobot?integrationId=[ID]`

### Step 2: Configure UptimeRobot

1. Go to **My Settings -> Alert Contacts**.
2. Add **Web-Hook**.
3. Friendly Name: OpsKnight.
4. URL: Paste the OpsKnight Webhook URL.
5. Enable it for your monitors.

## Payload Format

UptimeRobot sends parameters as query strings or JSON. OpsKnight supports JSON:

```json
{
  "monitorID": 12345,
  "monitorFriendlyName": "My Website",
  "alertType": "1",
  "alertDetails": "Connection Timeout"
}
```

## Event Mapping

| Alert Type | Status  | OpsKnight Action   |
| ---------- | ------- | ------------------ |
| `1`        | Down    | Trigger (Critical) |
| `2`        | Up      | Resolve            |
| `98`       | Started | Info               |
| `99`       | Paused  | Info               |

## Deduplication

Dedup key is generated from `uptimerobot-{monitorID}`. This guarantees that a single monitor only ever has one active incident at a time.

## Testing

### Using cURL

```bash
curl -X POST "https://YOUR_OPSKNIGHT_URL/api/integrations/uptimerobot?integrationId=YOUR_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "monitorID": 8888,
    "monitorFriendlyName": "Test Monitor",
    "alertType": "1",
    "alertDetails": "Test Down"
  }'
```

## Troubleshooting

### Parameters Missing

Ensure you configured the UptimeRobot webhook data to send JSON, or at least confirmed the POST parameters are included. OpsKnight prefers JSON.

## Monitor Status Logic

OpsKnight translates UptimeRobot alert types:

| Alert Type | Meaning | OpsKnight Action   |
| ---------- | ------- | ------------------ |
| `1`        | Down    | Trigger (Critical) |
| `2`        | Up      | Resolve            |

The integration automatically uses the `monitorID` for deduplication, ensuring that a single flapping monitor updates the same incident rather than creating duplicates.
