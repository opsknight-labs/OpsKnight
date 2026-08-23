---
order: 2
title: Azure Monitor
description: Integrate Azure Monitor with OpsKnight to receive alerts.
---

# Azure Monitor Integration

Receive alerts from Azure Monitor in OpsKnight.

---

## Endpoint

```
POST /api/integrations/azure?integrationId=YOUR_INTEGRATION_ID
```

---

## Setup

### Step 1: Create Integration in OpsKnight

1. In OpsKnight, go to **Service -> Integrations**.
2. Add a **Azure Monitor** integration.
3. Copy the **Webhook URL**:
   `https://[YOUR_DOMAIN]/api/integrations/azure?integrationId=[ID]`

### Step 2: Configure Azure Monitor

1. Go to **Monitor -> Alerts -> Action Groups**.
2. Create or Edit an Action Group.
3. Add a **Webhook** action.
4. Paste the OpsKnight Webhook URL.
5. Enable the Common Alert Schema if available (optional, OpsKnight handles both).

## Payload Format

OpsKnight supports the Azure Monitor Common Alert Schema:

```json
{
  "schemaId": "azureMonitorCommonAlertSchema",
  "data": {
    "essentials": {
      "alertId": "/subscriptions/...",
      "alertRule": "High CPU",
      "severity": "Sev0",
      "signalType": "Metric",
      "monitorCondition": "Fired",
      "monitoringService": "Platform",
      "alertTargetIDs": ["/subscriptions/..."],
      "firedDateTime": "2024-01-15T12:00:00.000Z"
    },
    "alertContext": { ... }
  }
}
```

## Event Mapping

| Monitor Condition | OpsKnight Action |
| ----------------- | ---------------- |
| `Fired`           | Trigger incident |
| `Resolved`        | Resolve incident |

## Severity Mapping

| Azure Severity | OpsKnight Severity |
| -------------- | ------------------ |
| `Sev0`         | critical           |
| `Sev1`         | error              |
| `Sev2`         | warning            |
| `Sev3`, `Sev4` | info               |

## Incident Title

The incident title is taken from `data.essentials.alertRule`.

## Deduplication

Dedup key is generated from `data.essentials.alertId`.

## Testing

### Using Azure Portal

1. Go to your **Action Group**
2. Click **Test action group**
3. Select "Common Alert Schema" sample type
4. Click **Test**

### Using cURL

```bash
curl -X POST "https://YOUR_OPSKNIGHT_URL/api/integrations/azure?integrationId=YOUR_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "essentials": {
        "alertId": "test-alert-123",
        "alertRule": "Test Alert",
        "severity": "Sev0",
        "monitorCondition": "Fired"
      }
    }
  }'
```

## Troubleshooting

### Monitor Condition "Resolved" Not Working

Ensure your Azure Alert Rule is configured to "Automatically resolve alerts" (stateless alerts do not send resolved events).

### Wrong Severity

Check if you are using the Common Alert Schema. If using the legacy schema, severity mapping might default to "warning".

## Alert Logic

OpsKnight maps Azure Severity to Urgency:

| Azure Severity  | OpsKnight Urgency |
| --------------- | ----------------- |
| Sev0 / Critical | `critical`        |
| Sev1 / Error    | `error`           |
| Sev2 / Warning  | `warning`         |
| Other           | `warning`         |

**State Handling**:

- Monitor Condition `Fired` / `Activated` -> **Trigger Incident**
- Monitor Condition `Resolved` -> **Resolve Incident**
