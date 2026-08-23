---
order: 2
title: New Relic
description: Receive New Relic alerts and incidents in OpsKnight
---

# New Relic Integration

Receive alerts from New Relic and create incidents automatically.

---

## Endpoint

```
POST /api/integrations/newrelic?integrationId=YOUR_INTEGRATION_ID
```

---

## Setup

### Step 1: Create Integration in OpsKnight

1. Go to **Services** and select your service
2. Click **Integrations** tab
3. Click **Add Integration**
4. Select **New Relic**
5. Copy the **Integration ID**

### Step 2: Configure New Relic Webhook

1. In New Relic, go to **Alerts & AI** → **Destinations**
2. Click **+ Add destination**
3. Select **Webhook**
4. Configure:

| Field            | Value                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------- |
| **Name**         | `OpsKnight`                                                                              |
| **Endpoint URL** | `https://YOUR_OPSKNIGHT_URL/api/integrations/newrelic?integrationId=YOUR_INTEGRATION_ID` |

5. Click **Save destination**

### Step 3: Create Workflow

1. Go to **Alerts & AI** → **Workflows**
2. Click **+ Add workflow**
3. Configure filter conditions
4. Add **Notify** action with the OpsKnight destination
5. Save the workflow

---

## Supported Formats

OpsKnight automatically detects and handles multiple New Relic payload formats:

### Incident Format (Workflows)

```json
{
  "account_id": 12345,
  "account_name": "My Account",
  "event_type": "INCIDENT_CREATED",
  "incident": {
    "id": "inc-abc123",
    "title": "High CPU usage on production servers",
    "state": "open",
    "severity": "critical",
    "created_at": "2024-01-15T10:00:00Z",
    "updated_at": "2024-01-15T10:00:00Z",
    "condition_name": "CPU Usage > 90%",
    "condition_id": 67890,
    "policy_name": "Production Alerts",
    "policy_id": 11111
  }
}
```

### Legacy Alert Format

```json
{
  "alert": {
    "id": "alert-xyz789",
    "alert_policy_name": "Production Alerts",
    "alert_condition_name": "High Memory Usage",
    "severity": "warning",
    "timestamp": 1705312800,
    "state": "open",
    "message": "Memory usage exceeded 85%"
  }
}
```

### APM Format

```json
{
  "alertType": "VIOLATION_OPEN",
  "alertSeverity": "critical",
  "alertTitle": "Error rate too high",
  "alertMessage": "Error rate exceeded 5% threshold",
  "alertTimestamp": 1705312800,
  "account_id": 12345
}
```

---

## Event Mapping

| New Relic State      | OpsKnight Action     |
| -------------------- | -------------------- |
| `open`               | Trigger incident     |
| `acknowledged`       | Acknowledge incident |
| `resolved`, `closed` | Resolve incident     |

For APM format, resolved/closed keywords in `alertType` trigger resolution.

---

## Severity Mapping

| New Relic Severity | OpsKnight Severity |
| ------------------ | ------------------ |
| `critical`         | critical           |
| `warning`          | warning            |
| `info`             | info               |

---

## Incident Title

The incident title is extracted based on format:

**Incident format**: `incident.title`

**Legacy format**: `alert.alert_condition_name` or `alert.message`

**APM format**: `alertTitle`

---

## Deduplication

Dedup keys are generated based on format:

- **Incident format**: `newrelic-{incident.id}`
- **Legacy format**: `newrelic-{alert.id}`
- **APM format**: `newrelic-{alertTimestamp}`

---

## Security

### Signature Verification (Optional)

You can secure the webhook with HMAC signature verification:

1. In OpsKnight, set a **Signing Secret** on the integration
2. Include header: `X-Signature: sha256=<hmac_signature>`

---

## Testing

### Using New Relic UI

1. Go to **Alerts & AI** → **Workflows**
2. Select your workflow
3. Click **Test workflow**
4. Verify incident appears in OpsKnight

### Using cURL

Send a test payload directly:

```bash
curl -X POST "https://YOUR_OPSKNIGHT_URL/api/integrations/newrelic?integrationId=YOUR_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "account_id": 12345,
    "account_name": "Test Account",
    "incident": {
      "id": "test-incident-001",
      "title": "Test Alert from New Relic",
      "state": "open",
      "severity": "warning",
      "created_at": "2024-01-15T10:00:00Z",
      "updated_at": "2024-01-15T10:00:00Z"
    }
  }'
```

---

## Troubleshooting

### Alerts Not Appearing

1. **Check destination URL** is correct
2. **Verify integration ID** is valid
3. **Check workflow** is active and correctly configured
4. **Test destination** in New Relic settings

### Incidents Not Resolving

1. **Verify workflow** sends close notifications
2. **Check incident state** is being sent correctly

### Unknown Format Warning

If you see "unknown format" in incident details:

1. **Check payload** matches one of the supported formats
2. **Verify JSON** is valid
3. Contact support if using a new New Relic notification format

---

## Related Topics

- [Events API](../../api/events) — Programmatic event submission
- [Integrations Overview](.) — All integrations
