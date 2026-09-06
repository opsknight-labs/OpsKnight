---
order: 6
title: Honeycomb
description: Integrate Honeycomb triggers with OpsKnight.
---

# Honeycomb Integration

Receive trigger notifications from Honeycomb.

---

## Endpoint

```
POST /api/integrations/honeycomb?integrationId=YOUR_INTEGRATION_ID
```

---

## Setup

### Step 1: Create Integration in OpsKnight

1. In OpsKnight, go to **Service -> Integrations**.
2. Add a **Honeycomb** integration.
3. Copy the **Webhook URL**:
   `https://[YOUR_DOMAIN]/api/integrations/honeycomb?integrationId=[ID]`

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

## Testing

### Using cURL

```bash
curl -X POST "https://YOUR_OPSKNIGHT_URL/api/integrations/honeycomb?integrationId=YOUR_ID" \
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
