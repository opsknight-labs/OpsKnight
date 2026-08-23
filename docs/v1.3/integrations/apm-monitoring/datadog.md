---
order: 1
title: Datadog
description: Receive Datadog monitor alerts in OpsKnight
---

# Datadog Integration

Receive alerts from Datadog monitors and create incidents automatically.

---

## Endpoint

```
POST /api/integrations/datadog?integrationId=YOUR_INTEGRATION_ID
```

---

## Setup

### Step 1: Create Integration in OpsKnight

1. Go to **Services** and select your service
2. Click **Integrations** tab
3. Click **Add Integration**
4. Select **Datadog**
5. Copy the **Integration ID**

### Step 2: Create Webhook in Datadog

1. In Datadog, go to **Integrations** → **Webhooks**
2. Click **+ New Webhook**
3. Configure:

| Field              | Value                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------- |
| **Name**           | `OpsKnight`                                                                             |
| **URL**            | `https://YOUR_OPSKNIGHT_URL/api/integrations/datadog?integrationId=YOUR_INTEGRATION_ID` |
| **Payload**        | Use default (leave empty)                                                               |
| **Custom Headers** | Optional                                                                                |

4. Click **Save**

### Step 3: Add Webhook to Monitors

1. Open your Datadog Monitor
2. In the **Notify your team** section, add: `@webhook-OpsKnight`
3. Save the monitor

---

## Payload Format

OpsKnight accepts the standard Datadog webhook payload:

```json
{
  "event_type": "alert",
  "title": "[Triggered] CPU High on web-01",
  "text": "CPU usage exceeded 90% threshold",
  "alert_type": "error",
  "date_happened": 1705312800,
  "tags": ["env:production", "team:platform"],
  "host": "web-01",
  "aggregation_key": "datadog-alert-12345"
}
```

### Monitor Format

Datadog can also send monitor-specific payloads:

```json
{
  "monitor": {
    "id": 12345,
    "name": "CPU Usage High",
    "status": "triggered",
    "message": "CPU usage exceeded threshold"
  }
}
```

### Alert Format

```json
{
  "alert": {
    "id": "abc123",
    "title": "Database Connection Error",
    "message": "Connection pool exhausted",
    "status": "triggered",
    "severity": "error"
  }
}
```

---

## Event Mapping

| Datadog Status         | OpsKnight Action |
| ---------------------- | ---------------- |
| `triggered`, `alert`   | Trigger incident |
| `resolved`, `ok`       | Resolve incident |
| `success` (alert_type) | Resolve incident |

---

## Severity Mapping

| Datadog Alert Type | OpsKnight Severity |
| ------------------ | ------------------ |
| `error`            | critical           |
| `warning`          | warning            |
| `info`             | info               |
| `success`          | info               |

---

## Incident Title

The incident title is extracted in this order:

1. `title` (from event)
2. `alert.title`
3. `monitor.name`
4. Fallback: "Datadog Alert"

---

## Deduplication

Dedup keys are generated in this order:

1. `aggregation_key` (if provided)
2. `datadog-alert-{alert.id}` (if alert format)
3. `datadog-monitor-{monitor.id}` (if monitor format)
4. `datadog-{timestamp}` (fallback)

### Best Practice

Use the `aggregation_key` in your Datadog webhook payload for consistent deduplication:

```json
{
  "aggregation_key": "cpu-high-{{host.name}}"
}
```

---

## Security

### Signature Verification (Optional)

You can secure the webhook with HMAC signature verification:

1. In OpsKnight, set a **Signing Secret** on the integration
2. Include header: `X-Signature: sha256=<hmac_signature>`

---

## Testing

### Using Datadog UI

1. Open a monitor in Datadog
2. Click **Test Notifications**
3. Select the OpsKnight webhook
4. Verify incident appears in OpsKnight

### Using cURL

Send a test payload directly:

```bash
curl -X POST "https://YOUR_OPSKNIGHT_URL/api/integrations/datadog?integrationId=YOUR_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "alert",
    "title": "Test Alert from Datadog",
    "text": "This is a test alert",
    "alert_type": "warning",
    "date_happened": 1705312800,
    "aggregation_key": "test-alert-001"
  }'
```

---

## Troubleshooting

### Alerts Not Appearing

1. **Check webhook URL** is correct in Datadog
2. **Verify integration ID** is valid
3. **Check Datadog webhook logs** for delivery status
4. **Ensure `@webhook-OpsKnight`** is added to monitor notifications

### Incidents Not Resolving

1. **Verify monitor sends recovery notifications**
2. **Check aggregation_key** is consistent between trigger and resolve

### Wrong Severity

1. **Set alert_type** appropriately in webhook payload
2. **Use error/warning/info** values

---

## Related Topics

- [Events API](../../api/events) — Programmatic event submission
- [Integrations Overview](.) — All integrations
