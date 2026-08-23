---
order: 1
title: Elastic and Kibana
description: Send Elastic or Kibana alert and recovery actions to OpsKnight with stable alert correlation
---

# Elastic / Kibana Integration

Receive alerts from Elasticsearch Watcher or Kibana Alerts.

## Endpoint

```
POST /api/integrations/elastic?integrationId=YOUR_INTEGRATION_ID&integrationKey=YOUR_INTEGRATION_KEY
```

## Setup

1. In OpsKnight, go to **Service -> Integrations**.
2. Add a **Elastic** integration.
3. Copy the **Webhook URL**:
   `https://[YOUR_DOMAIN]/api/integrations/elastic?integrationId=[ID]&integrationKey=[KEY]`

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

The key is raw `alert.id`, falling back to raw `rule.id`. Only when both are absent does OpsKnight use `elastic-<normalized rule name>`. Ensure recovery repeats the same highest-priority ID.

## Security and lifecycle boundary

The complete URL contains the required integration key. The optional generic signature requires an unprefixed raw-body HMAC-SHA256 digest in `X-Signature` or `X-Webhook-Signature`. Leave the OpsKnight signing secret unset for a direct Kibana connector unless the connector or a trusted gateway emits that exact contract.

OpsKnight checks `alert.status`, then `event.action`, then top-level `status`. Values containing `resolved`, `closed`, `recovered`, `ok`, or `up` resolve; values containing `ack` acknowledge; everything else triggers. Configure a recovery action in the rule—an active-only connector cannot resolve its incident.

## Testing

### Using cURL

```bash
curl -X POST "https://YOUR_OPSKNIGHT_URL/api/integrations/elastic?integrationId=YOUR_ID&integrationKey=YOUR_KEY" \
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

Test one real active/recovered pair and confirm both receive HTTP `202` and update the same incident. The default integration limit is 100 requests per 60 seconds per integration. If recovery misses, compare selected ID and status precedence in the two raw deliveries.

## Related topics

- [Inbound webhook reference](../inbound-webhook-reference)
- [Urgency mapping](../../core-concepts/urgency-mapping)
- [Troubleshooting](../../troubleshooting)
