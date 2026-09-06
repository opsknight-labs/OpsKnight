---
order: 4
title: Uptime Kuma
description: Integrate self-hosted Uptime Kuma with OpsKnight.
---

# Uptime Kuma Integration

Receive alerts from Uptime Kuma.

---

## Endpoint

```
POST /api/integrations/uptime-kuma?integrationId=YOUR_INTEGRATION_ID
```

---

## Setup

### Step 1: Create Integration in OpsKnight

1. In OpsKnight, go to **Service -> Integrations**.
2. Add a **Uptime Kuma** integration.
3. Copy the **Webhook URL**:
   `https://[YOUR_DOMAIN]/api/integrations/uptime-kuma?integrationId=[ID]`

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

Dedup key is generated from `uptime-kuma-{monitorID}`.

## Testing

### Using Uptime Kuma UI

1. Go to **Settings** -> **Notifications**
2. Click **Test** on your defined notification

### Using cURL

```bash
curl -X POST "https://YOUR_OPSKNIGHT_URL/api/integrations/uptime-kuma?integrationId=YOUR_ID" \
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
