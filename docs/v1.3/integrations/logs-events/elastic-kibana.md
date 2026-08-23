---
order: 1
title: Elastic / Kibana
description: Integrate Elastic Watcher alerts with OpsKnight.
---

# Elastic / Kibana Integration

Receive alerts from Elasticsearch Watcher or Kibana Alerts.

## Endpoint

```
POST /api/integrations/elastic?integrationId=YOUR_INTEGRATION_ID
```

## Setup

1. In OpsKnight, go to **Service -> Integrations**.
2. Add a **Elastic** integration.
3. Copy the **Webhook URL**:
   `https://[YOUR_DOMAIN]/api/integrations/elastic?integrationId=[ID]`

## Configuration in Kibana

1. Create a **Connector**.
2. Select **Webhook**.
3. Name: OpsKnight.
4. Method: `POST`.
5. URL: Paste the OpsKnight Webhook URL.
6. Use this connector in your Rules/Actions.

## Payload Format

Configure your Connector to send:

```json
{
  "rule": { "name": "High CPU" },
  "alert": {
    "id": "123",
    "severity": "critical",
    "status": "active",
    "reason": "CPU > 90%"
  }
}
```

## Event Mapping

| Alert Status | OpsKnight Action |
| ------------ | ---------------- |
| `active`     | Trigger incident |
| `recovered`  | Resolve incident |

## Deduplication

Dedup key is generated from `elastic-{alert.id}` or `elastic-{rule.id}`.

## Testing

### Using cURL

```bash
curl -X POST "https://YOUR_OPSKNIGHT_URL/api/integrations/elastic?integrationId=YOUR_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "rule": { "name": "Test Rule" },
    "alert": { "id": "test-1", "severity": "critical", "status": "active" }
  }'
```

## Alert Field Mapping

OpsKnight extracts fields in this priority order:

1. **Summary**: `rule.name` > `alert.reason` > `message`
2. **Urgency**: `alert.severity` (maps to Warning/Error/Critical)
3. **Status**: `alert.status` or `event.action` (maps to Trigger/Resolve)

Tip: Ensure your Connector payload maps these standard Elastic fields.
