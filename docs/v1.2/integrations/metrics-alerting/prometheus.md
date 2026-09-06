---
order: 1
title: Prometheus / Alertmanager
description: Receive Prometheus Alertmanager alerts in OpsKnight
---

# Prometheus Alertmanager Integration

Receive alerts from Prometheus Alertmanager and create incidents automatically.

---

## Endpoint

```
POST /api/integrations/prometheus?integrationId=YOUR_INTEGRATION_ID
```

---

## Setup

### Step 1: Create Integration in OpsKnight

1. Go to **Services** and select your service
2. Click **Integrations** tab
3. Click **Add Integration**
4. Select **Prometheus**
5. Copy the **Integration ID**

### Step 2: Configure Alertmanager

Add OpsKnight as a receiver in your `alertmanager.yml`:

```yaml
receivers:
  - name: 'opsknight'
    webhook_configs:
      - url: 'https://YOUR_OPSKNIGHT_URL/api/integrations/prometheus?integrationId=YOUR_INTEGRATION_ID'
        send_resolved: true

route:
  receiver: 'opsknight'
  routes:
    - match:
        severity: critical
      receiver: 'opsknight'
```

Replace `YOUR_OPSKNIGHT_URL` with your OpsKnight instance URL and `YOUR_INTEGRATION_ID` with the ID from Step 1.

---

## Payload Format

OpsKnight accepts the standard Alertmanager webhook payload:

```json
{
  "version": "4",
  "groupKey": "{}:{alertname=\"HighMemoryUsage\"}",
  "status": "firing",
  "receiver": "opsknight",
  "groupLabels": {
    "alertname": "HighMemoryUsage"
  },
  "commonLabels": {
    "alertname": "HighMemoryUsage",
    "severity": "critical"
  },
  "commonAnnotations": {
    "summary": "Memory usage is above 90%"
  },
  "externalURL": "http://alertmanager:9093",
  "alerts": [
    {
      "status": "firing",
      "labels": {
        "alertname": "HighMemoryUsage",
        "severity": "critical",
        "instance": "web-01:9090"
      },
      "annotations": {
        "summary": "Memory usage is above 90%",
        "description": "Memory usage on web-01 is 95%"
      },
      "startsAt": "2024-01-15T10:00:00Z",
      "generatorURL": "http://prometheus:9090/graph",
      "fingerprint": "abc123def456"
    }
  ]
}
```

---

## Event Mapping

| Alertmanager Status | OpsKnight Action |
| ------------------- | ---------------- |
| `firing`            | Trigger incident |
| `resolved`          | Resolve incident |

The integration checks both `status` at the payload level and individual alert `status`. If an alert has `endsAt` set, it's treated as resolved.

---

## Severity Mapping

OpsKnight reads the `severity` label from alerts:

| Prometheus Severity Label | OpsKnight Severity |
| ------------------------- | ------------------ |
| `critical`, `page`        | critical           |
| `error`                   | error              |
| `warning`                 | warning            |
| (default)                 | warning            |

### Setting Severity in Alert Rules

```yaml
groups:
  - name: example
    rules:
      - alert: HighCPUUsage
        expr: cpu_usage > 90
        labels:
          severity: critical
        annotations:
          summary: 'CPU usage is above 90%'
```

---

## Incident Title

The incident title is extracted in this order:

1. `annotations.summary`
2. `annotations.description`
3. `labels.alertname`
4. Fallback: "Prometheus Alert"

---

## Deduplication

Dedup keys are generated as follows:

1. **Fingerprint** (preferred): Uses Alertmanager's `fingerprint` field
2. **Label hash**: If no fingerprint, creates SHA-256 hash from sorted labels

This ensures identical alerts map to the same incident, preventing duplicates during alert storms.

---

## Security

### Signature Verification (Optional)

You can secure the webhook with HMAC signature verification:

1. In OpsKnight, set a **Signing Secret** on the integration
2. Configure Alertmanager to send the signature (requires custom webhook or proxy)
3. Include header: `X-Signature: sha256=<hmac_signature>`

---

## Testing

### Using Alertmanager API

Manually fire a test alert:

```bash
curl -X POST http://alertmanager:9093/api/v2/alerts \
  -H "Content-Type: application/json" \
  -d '[{
    "labels": {
      "alertname": "TestAlert",
      "severity": "warning",
      "instance": "test-01"
    },
    "annotations": {
      "summary": "Test alert from curl"
    }
  }]'
```

### Using cURL Directly

Send a test payload directly to OpsKnight:

```bash
curl -X POST "https://YOUR_OPSKNIGHT_URL/api/integrations/prometheus?integrationId=YOUR_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "4",
    "groupKey": "test",
    "status": "firing",
    "receiver": "test",
    "groupLabels": {},
    "commonLabels": {"alertname": "TestAlert", "severity": "warning"},
    "commonAnnotations": {"summary": "Test alert"},
    "externalURL": "http://test",
    "alerts": [{
      "status": "firing",
      "labels": {"alertname": "TestAlert", "severity": "warning"},
      "annotations": {"summary": "Test alert"},
      "startsAt": "2024-01-15T10:00:00Z",
      "generatorURL": "http://test",
      "fingerprint": "test123"
    }]
  }'
```

---

## Troubleshooting

### Alerts Not Appearing

1. **Check Alertmanager logs** for webhook errors
2. **Verify URL** is correct and accessible from Alertmanager
3. **Check integration ID** is valid
4. **Test with curl** to isolate network issues

### Duplicate Incidents

1. **Verify fingerprint** is being sent by Alertmanager
2. **Check labels** are consistent across alerts
3. **Ensure `send_resolved: true`** to properly close incidents

### Wrong Severity

1. **Add severity label** to your alert rules
2. **Use lowercase** values: `critical`, `error`, `warning`, `info`

---

## Related Topics

- [Grafana Integration](../apm-monitoring/grafana) — Grafana can also send Alertmanager-format webhooks
- [Events API](../../api/events) — Programmatic event submission
- [Integrations Overview](.) — All integrations
