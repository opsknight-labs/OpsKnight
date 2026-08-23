---
order: 5
title: Grafana
description: Receive Grafana alerts in OpsKnight
---

# Grafana Integration

Receive alerts from Grafana (Legacy Alerting or Unified Alerting) and create incidents automatically.

---

## Endpoint

```
POST /api/integrations/grafana?integrationId=YOUR_INTEGRATION_ID
```

---

## Setup

### Step 1: Create Integration in OpsKnight

1. Go to **Services** and select your service
2. Click **Integrations** tab
3. Click **Add Integration**
4. Select **Grafana**
5. Copy the **Integration ID**
6. (Optional) Generate a **Signing Secret** for security

### Step 2: Configure Grafana Contact Point

#### Grafana 8+ (Unified Alerting)

1. Go to **Alerting** → **Contact points**
2. Click **+ Add contact point**
3. Configure:

| Field           | Value                                                                                   |
| --------------- | --------------------------------------------------------------------------------------- |
| **Name**        | `OpsKnight`                                                                             |
| **Integration** | Webhook                                                                                 |
| **URL**         | `https://YOUR_OPSKNIGHT_URL/api/integrations/grafana?integrationId=YOUR_INTEGRATION_ID` |

4. Click **Save contact point**
5. Click **Test** to verify

#### Grafana Legacy Alerting

1. Go to **Alerting** → **Notification channels**
2. Click **Add channel**
3. Configure:

| Field    | Value                                                                                   |
| -------- | --------------------------------------------------------------------------------------- |
| **Name** | `OpsKnight`                                                                             |
| **Type** | webhook                                                                                 |
| **URL**  | `https://YOUR_OPSKNIGHT_URL/api/integrations/grafana?integrationId=YOUR_INTEGRATION_ID` |

4. Click **Save**

### Step 3: Add to Notification Policy

1. Go to **Alerting** → **Notification policies**
2. Edit or create a policy
3. Add OpsKnight as a contact point
4. Save

---

## Security

> **Strict Security Enforcement**: If you generate a Signing Secret in OpsKnight, you **MUST** configure signature sending from your source. OpsKnight will reject any requests without a valid signature if a secret exists.

---

## Supported Formats

### Unified Alerting Format

```json
{
  "title": "CPU Usage High",
  "message": "CPU usage exceeded 90%",
  "state": "alerting",
  "ruleId": 12345,
  "ruleName": "High CPU Alert",
  "ruleUrl": "https://grafana.example.com/alerting/12345/view",
  "evalMatches": [
    {
      "metric": "cpu_usage",
      "value": 95.5,
      "tags": {
        "host": "web-01"
      }
    }
  ],
  "tags": {
    "severity": "critical"
  },
  "dashboardId": 1,
  "panelId": 2,
  "orgId": 1
}
```

### Alertmanager Format

Grafana can also send Prometheus Alertmanager-compatible payloads:

```json
{
  "status": "firing",
  "alerts": [
    {
      "status": "firing",
      "labels": {
        "alertname": "HighCPU",
        "severity": "critical"
      },
      "annotations": {
        "summary": "CPU usage is high",
        "description": "CPU above 90%"
      },
      "startsAt": "2024-01-15T10:00:00Z"
    }
  ],
  "groupLabels": {
    "alertname": "HighCPU"
  },
  "commonLabels": {
    "severity": "critical"
  },
  "commonAnnotations": {
    "summary": "CPU usage is high"
  }
}
```

---

## Event Mapping

| Grafana State       | OpsKnight Action |
| ------------------- | ---------------- |
| `alerting`          | Trigger incident |
| `no_data`           | Trigger incident |
| `ok`                | Resolve incident |
| `pending`, `paused` | No action        |

For Alertmanager format:

- `status: firing` triggers incident
- `status: resolved` or `endsAt` present resolves incident

---

## Severity Mapping

| Grafana State       | OpsKnight Severity |
| ------------------- | ------------------ |
| `alerting`          | critical           |
| `no_data`           | warning            |
| Alertmanager format | critical (default) |

---

## Incident Title

The incident title is extracted in this order:

1. `title`
2. `ruleName`
3. `message`
4. For Alertmanager format: `annotations.summary` → `annotations.description` → `labels.alertname`
5. Fallback: "Grafana Alert"

---

## Deduplication

Dedup keys are generated as:

- **Unified Alerting**: `grafana-{ruleId}`
- **Alertmanager format**: `grafana-{labels.alertname}`
- **Fallback**: `grafana-{timestamp}`

---

## Testing

### Using Grafana UI

1. Go to **Alerting** → **Contact points**
2. Click on OpsKnight contact point
3. Click **Test**
4. Verify incident appears in OpsKnight

### Using cURL

Send a test payload directly:

```bash
curl -X POST "https://YOUR_OPSKNIGHT_URL/api/integrations/grafana?integrationId=YOUR_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Alert from Grafana",
    "message": "This is a test alert",
    "state": "alerting",
    "ruleId": 999999,
    "ruleName": "Test Alert Rule"
  }'
```

---

## Troubleshooting

### Alerts Not Appearing

1. **Check contact point URL** is correct
2. **Verify integration ID** is valid
3. **Test contact point** in Grafana settings
4. **Check notification policy** includes OpsKnight

### 401 Unauthorized Error

1. **Check signing secret** if configured
2. **Remove secret** from OpsKnight if not using signature verification

### Incidents Not Resolving

1. **Ensure alert rules** send OK state
2. **Verify `state: ok`** is being sent

### Wrong Severity

Grafana alerts default to `critical` severity. To customize:

1. Use Alertmanager format with severity labels
2. Or accept default severity mapping

---

## Related Topics

- [Prometheus Integration](../metrics-alerting/prometheus) — Prometheus Alertmanager
- [Events API](../../api/events) — Programmatic event submission
- [Integrations Overview](.) — All integrations
