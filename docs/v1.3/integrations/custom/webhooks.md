---
order: 1
title: Webhooks
description: Receive alerts from external systems and send incident events to external endpoints
---

# Webhooks

OpsKnight supports both incoming webhooks (receiving alerts from monitoring tools) and outgoing webhooks (sending incident events to external systems).

---

## Endpoint

```
POST /api/integrations/webhook?integrationId=YOUR_INTEGRATION_ID
```

This is the generic inbound webhook endpoint for tools without a dedicated integration.

---

## Incoming Webhooks

Receive alerts from external monitoring tools and create incidents automatically.

### Supported Integrations

OpsKnight has dedicated endpoints for popular monitoring tools:

| Integration                 | Endpoint                                    |
| --------------------------- | ------------------------------------------- |
| **Prometheus**              | `/api/integrations/prometheus`              |
| **Grafana**                 | `/api/integrations/grafana`                 |
| **Datadog**                 | `/api/integrations/datadog`                 |
| **New Relic**               | `/api/integrations/newrelic`                |
| **Sentry**                  | `/api/integrations/sentry`                  |
| **AWS CloudWatch**          | `/api/integrations/cloudwatch`              |
| **Azure Monitor**           | `/api/integrations/azure`                   |
| **Google Cloud Monitoring** | `/api/integrations/google-cloud-monitoring` |
| **Dynatrace**               | `/api/integrations/dynatrace`               |
| **AppDynamics**             | `/api/integrations/appdynamics`             |
| **Splunk On-Call**          | `/api/integrations/splunk-oncall`           |
| **Splunk Observability**    | `/api/integrations/splunk-observability`    |
| **Elastic**                 | `/api/integrations/elastic`                 |
| **Honeycomb**               | `/api/integrations/honeycomb`               |
| **UptimeRobot**             | `/api/integrations/uptimerobot`             |
| **Pingdom**                 | `/api/integrations/pingdom`                 |
| **Better Uptime**           | `/api/integrations/better-uptime`           |
| **Uptime Kuma**             | `/api/integrations/uptime-kuma`             |
| **GitHub**                  | `/api/integrations/github`                  |
| **Bitbucket**               | `/api/integrations/bitbucket`               |
| **Generic Webhook**         | `/api/integrations/webhook`                 |

### Generic Webhook

For tools without a dedicated endpoint, use the generic webhook:

```
POST /api/integrations/webhook?integrationId=YOUR_INTEGRATION_ID
Content-Type: application/json
```

### Generic Webhook Payload

The generic webhook accepts flexible payloads with automatic field mapping:

```json
{
  "summary": "Alert title",
  "severity": "critical",
  "status": "triggered",
  "dedup_key": "unique-alert-id",
  "source": "my-monitoring-tool"
}
```

### Field Mapping

OpsKnight automatically maps common field names:

| Purpose       | Accepted Fields                       |
| ------------- | ------------------------------------- |
| **Title**     | `summary`, `title`, `message`, `name` |
| **Severity**  | `severity`, `level`, `priority`       |
| **Status**    | `status`, `action`, `state`           |
| **Dedup Key** | `dedup_key`, `id`, `alert_id`         |
| **Source**    | `source`, `origin`, `system`          |

### Status Values

| Action          | Trigger Values                                 |
| --------------- | ---------------------------------------------- |
| **Trigger**     | triggered, fired, alert, critical, error, open |
| **Resolve**     | resolved, ok, normal, closed, fixed            |
| **Acknowledge** | acknowledge, ack                               |

### Severity Mapping

| Input           | OpsKnight Severity |
| --------------- | ------------------ |
| critical, high  | critical           |
| error           | error              |
| warning, medium | warning            |
| info, low       | info               |

### Signature Verification

Optionally secure incoming webhooks with HMAC signatures:

1. Set a **Signature Secret** on the integration
2. Include signature header in requests:
   - `X-Signature: sha256=abc123...`
   - or `X-Webhook-Signature: sha256=abc123...`

OpsKnight verifies the HMAC-SHA256 signature against the request body.

---

## Outgoing Webhooks

Send incident events to external systems via status page webhooks.

### Creating Outgoing Webhooks

1. Go to **Settings** → **Status Page** → **Webhooks**
2. Click **Add Webhook**
3. Configure:

| Field       | Description                |
| ----------- | -------------------------- |
| **Name**    | Friendly identifier        |
| **URL**     | Endpoint to receive events |
| **Secret**  | HMAC signing secret        |
| **Events**  | Which events to send       |
| **Enabled** | Toggle on/off              |

### Event Types

| Event                   | Description              |
| ----------------------- | ------------------------ |
| `incident.created`      | New incident created     |
| `incident.acknowledged` | Incident acknowledged    |
| `incident.resolved`     | Incident resolved        |
| `incident.snoozed`      | Incident snoozed         |
| `incident.suppressed`   | Incident suppressed      |
| `incident.updated`      | Incident details changed |

### Outgoing Payload Format

```json
{
  "event": "incident.created",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "id": "cuid_abc123",
    "title": "Database connection timeout",
    "description": "Connection pool exhausted",
    "status": "OPEN",
    "urgency": "HIGH",
    "priority": null,
    "service": {
      "id": "svc_xyz789",
      "name": "API Gateway"
    },
    "assignee": null,
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

### Outgoing Webhook Headers

| Header                | Value                                 |
| --------------------- | ------------------------------------- |
| `Content-Type`        | `application/json`                    |
| `X-Webhook-Signature` | `sha256=<hmac_signature>`             |
| `X-Webhook-Event`     | Event name (e.g., `incident.created`) |
| `User-Agent`          | `OpsKnight-StatusPage/1.0`            |

### Verifying Signatures

Verify incoming webhook signatures in your receiving application:

```javascript
const crypto = require('crypto');

function verifySignature(payload, signature, secret) {
  const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  const providedSignature = signature.replace('sha256=', '');

  return crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(providedSignature));
}

// Usage
app.post('/webhook', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const payload = JSON.stringify(req.body);

  if (!verifySignature(payload, signature, 'your-secret')) {
    return res.status(401).send('Invalid signature');
  }

  // Process the webhook
  console.log('Event:', req.body.event);
  console.log('Data:', req.body.data);

  res.status(200).send('OK');
});
```

```python
import hmac
import hashlib

def verify_signature(payload: str, signature: str, secret: str) -> bool:
    expected = hmac.new(
        secret.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()

    provided = signature.replace('sha256=', '')
    return hmac.compare_digest(expected, provided)
```

---

## Testing Webhooks

### Test Incoming Webhooks

Use cURL to test your integration:

```bash
curl -X POST "https://your-opsknight.com/api/integrations/webhook?integrationId=YOUR_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "summary": "Test alert",
    "severity": "warning",
    "status": "triggered",
    "dedup_key": "test-alert-001",
    "source": "manual-test"
  }'
```

### Test Outgoing Webhooks

1. Go to **Settings** → **Status Page** → **Webhooks**
2. Click **Test** on a webhook
3. A test event is sent to the configured URL

### Using webhook.site

For testing outgoing webhooks:

1. Go to [webhook.site](https://webhook.site)
2. Copy the unique URL
3. Use as webhook endpoint in OpsKnight
4. View received payloads in real-time

---

## Use Cases

### ITSM Integration

Automatically create tickets in ServiceNow, Jira, or other ITSM tools:

- Subscribe to `incident.created` events
- Create tickets with incident details
- Update tickets on `incident.resolved`

### Custom Dashboards

Push incident data to custom systems:

- Real-time status displays
- Executive dashboards
- Analytics pipelines

### ChatOps

Send to messaging platforms:

- Microsoft Teams (incoming webhook)
- Google Chat
- Discord
- Telegram bots

### Runbook Automation

Trigger automated responses:

- Subscribe to specific incident types
- Execute remediation scripts
- Scale infrastructure automatically

---

## Best Practices

### For Incoming Webhooks

- **Use dedicated endpoints** when available for your monitoring tool
- **Set signature secrets** to verify webhook authenticity
- **Use descriptive dedup_keys** to prevent duplicate incidents
- **Include source information** for better incident context

### For Outgoing Webhooks

- **Always verify signatures** in your receiving application
- **Return 2xx quickly** — process asynchronously if needed
- **Handle duplicate events** gracefully (idempotency)
- **Monitor webhook delivery** via status page webhook logs

### Security

- Store secrets securely (environment variables, secrets manager)
- Use HTTPS for all webhook URLs
- Implement signature verification
- Log webhook activity for debugging

---

## Related Topics

- [Events API](../../api/events) — Programmatic event submission
- [Integrations Overview](.) — All integrations
- [Status Page](../../core-concepts/status-page) — Status page configuration
