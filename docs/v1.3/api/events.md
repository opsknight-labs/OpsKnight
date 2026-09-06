---
order: 1
title: Events API
description: Trigger, acknowledge, and resolve incidents programmatically via the Events API
---

# Events API

The Events API allows external monitoring systems to create and manage incidents in OpsKnight programmatically.

---

## Endpoint

```
POST /api/events
```

---

## Authentication

### Integration Key (Recommended)

Use an integration key for service-specific event routing:

```http
Authorization: Token token=YOUR_INTEGRATION_KEY
```

Integration keys are created per-service and automatically route events to the correct service.

### API Key

Alternatively, use an API key with `events:write` scope:

```http
Authorization: Bearer YOUR_API_KEY
```

When using an API key, you must include `service_id` in the request body.

---

## Request Format

### Content Type

```http
Content-Type: application/json
```

### Request Body

```json
{
  "event_action": "trigger",
  "dedup_key": "unique-alert-identifier",
  "service_id": "svc_abc123",
  "payload": {
    "summary": "Brief description of the issue",
    "source": "monitoring-system",
    "severity": "critical",
    "custom_details": {
      "metric": "cpu_usage",
      "value": 95.5
    }
  }
}
```

---

## Fields Reference

| Field          | Type   |  Required   | Description                                         |
| -------------- | ------ | :---------: | --------------------------------------------------- |
| `event_action` | string |     Yes     | `trigger`, `acknowledge`, or `resolve`              |
| `dedup_key`    | string |     Yes     | Unique identifier for deduplication (max 200 chars) |
| `service_id`   | string | Conditional | Required when using API key authentication          |
| `payload`      | object |     Yes     | Event details                                       |

### Payload Fields

| Field            | Type   | Required | Description                                      |
| ---------------- | ------ | :------: | ------------------------------------------------ |
| `summary`        | string |   Yes    | Brief description (max 500 chars)                |
| `source`         | string |   Yes    | Source system identifier (max 200 chars)         |
| `severity`       | string |   Yes    | `critical`, `error`, `warning`, or `info`        |
| `custom_details` | object |    No    | Arbitrary key-value pairs for additional context |

### Severity to Urgency Mapping

| Severity   | OpsKnight Urgency |
| ---------- | ----------------- |
| `critical` | HIGH              |
| `error`    | MEDIUM            |
| `warning`  | MEDIUM            |
| `info`     | LOW               |

> **Note**: Warning maps to MEDIUM (not LOW) to ensure important alerts requiring attention are not missed. This aligns with industry best practices where warnings often indicate issues that need attention before they become critical.

---

## Event Actions

### trigger

Creates a new incident or updates an existing one based on the dedup_key.

**Behavior**:

- If no open incident exists with the dedup_key: creates new incident
- If an open/acknowledged/snoozed/suppressed incident exists: adds alert to existing incident (deduplicated)
- Incident title is set from `payload.summary`
- Incident description is set from `payload.custom_details` (JSON formatted)

```json
{
  "event_action": "trigger",
  "dedup_key": "server-cpu-high-web01",
  "payload": {
    "summary": "CPU usage above 90% on web-01",
    "source": "prometheus",
    "severity": "critical",
    "custom_details": {
      "cpu_percent": 95.5,
      "host": "web-01"
    }
  }
}
```

### acknowledge

Marks an existing incident as acknowledged.

**Behavior**:

- Finds open incident with matching dedup_key and service
- Updates status to ACKNOWLEDGED
- Stops escalation (sets escalationStatus to COMPLETED)
- Records acknowledgedAt timestamp
- No effect if no matching incident exists

```json
{
  "event_action": "acknowledge",
  "dedup_key": "server-cpu-high-web01",
  "payload": {
    "summary": "Acknowledged via API",
    "source": "automation",
    "severity": "info"
  }
}
```

### resolve

Marks an incident as resolved.

**Behavior**:

- Finds open/acknowledged incident with matching dedup_key and service
- Updates status to RESOLVED
- Stops escalation
- Records resolvedAt timestamp
- Triggers Slack notification if configured
- No effect if no matching incident exists

```json
{
  "event_action": "resolve",
  "dedup_key": "server-cpu-high-web01",
  "payload": {
    "summary": "Issue resolved",
    "source": "prometheus",
    "severity": "info"
  }
}
```

---

## Response Format

### Success Response

```json
{
  "status": "success",
  "result": {
    "action": "triggered",
    "incident": {
      "id": "clxyz123",
      "title": "CPU usage above 90% on web-01",
      "status": "OPEN",
      "urgency": "HIGH"
    }
  }
}
```

**HTTP Status**: 202 Accepted

### Result Actions

| Action         | Description                                        |
| -------------- | -------------------------------------------------- |
| `triggered`    | New incident created                               |
| `deduplicated` | Alert added to existing incident                   |
| `acknowledged` | Incident acknowledged                              |
| `resolved`     | Incident resolved                                  |
| `ignored`      | No matching incident found for acknowledge/resolve |

### Error Responses

| HTTP Status | Error                   | Description                                |
| ----------- | ----------------------- | ------------------------------------------ |
| 400         | Invalid JSON            | Request body is not valid JSON             |
| 400         | Invalid request body    | Validation failed (missing/invalid fields) |
| 401         | Unauthorized            | Missing or invalid API key                 |
| 403         | Invalid Integration Key | Integration key not found                  |
| 403         | API key missing scope   | API key lacks `events:write` scope         |
| 403         | Service access denied   | User doesn't have access to the service    |
| 404         | Service not found       | service_id doesn't exist                   |
| 429         | Rate limit exceeded     | Too many requests                          |
| 500         | Internal Server Error   | Server error                               |

---

## Rate Limiting

| Limit               | Value      |
| ------------------- | ---------- |
| Requests per minute | 120        |
| Window              | 60 seconds |

Rate limits apply per integration key or API key.

### Rate Limit Response

```json
{
  "error": "Rate limit exceeded."
}
```

**HTTP Status**: 429 Too Many Requests

**Header**: `Retry-After: <seconds>`

---

## Deduplication

Deduplication prevents duplicate incidents from the same alert source.

### How It Works

Events with the same `dedup_key` and `service_id` are grouped:

```
Event 1: dedup_key="cpu-high" → New incident created
Event 2: dedup_key="cpu-high" → Alert added to same incident
Event 3: dedup_key="cpu-high" → Alert added to same incident
Event 4: dedup_key="disk-full" → New incident created
```

### Deduplication Scope

- Deduplication only applies to incidents with status: OPEN, ACKNOWLEDGED, SNOOZED, SUPPRESSED
- Resolved incidents are excluded from deduplication
- A new trigger event after resolution creates a new incident

### Dedup Key Best Practices

**Good dedup keys**:

```
server-cpu-high-web01           # host + metric + server
database-connection-error-prod  # service + issue + environment
api-latency-p99-exceeded        # service + specific metric
```

**Bad dedup keys**:

```
alert-123456                    # Random, not meaningful
cpu-high                        # Too generic
2024-01-15-alert               # Date-based, creates duplicates
alert-{timestamp}               # Timestamp defeats deduplication
alert-{uuid}                    # Random UUID defeats deduplication
```

> **Warning**: Never use `Date.now()`, timestamps, or random UUIDs in dedup keys. Each event will create a new incident instead of being deduplicated, potentially causing alert storms.

---

## Examples

### cURL - Trigger Incident

```bash
curl -X POST https://your-opsknight.com/api/events \
  -H "Authorization: Token token=YOUR_INTEGRATION_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "event_action": "trigger",
    "dedup_key": "database-connection-timeout",
    "payload": {
      "summary": "Database connection timeout on primary",
      "source": "monitoring-agent",
      "severity": "critical",
      "custom_details": {
        "database": "postgres-primary",
        "timeout_ms": 30000
      }
    }
  }'
```

### cURL - Resolve Incident

```bash
curl -X POST https://your-opsknight.com/api/events \
  -H "Authorization: Token token=YOUR_INTEGRATION_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "event_action": "resolve",
    "dedup_key": "database-connection-timeout",
    "payload": {
      "summary": "Database connection restored",
      "source": "monitoring-agent",
      "severity": "info"
    }
  }'
```

### Python Example

```python
import requests

OPSKNIGHT_URL = "https://your-opsknight.com"
INTEGRATION_KEY = "your-integration-key"

def send_event(action, dedup_key, summary, source, severity, custom_details=None):
    url = f"{OPSKNIGHT_URL}/api/events"
    headers = {
        "Authorization": f"Token token={INTEGRATION_KEY}",
        "Content-Type": "application/json"
    }

    data = {
        "event_action": action,
        "dedup_key": dedup_key,
        "payload": {
            "summary": summary,
            "source": source,
            "severity": severity
        }
    }

    if custom_details:
        data["payload"]["custom_details"] = custom_details

    response = requests.post(url, headers=headers, json=data)
    return response.json()

# Trigger an incident
result = send_event(
    action="trigger",
    dedup_key="api-error-rate-high",
    summary="API error rate above 5%",
    source="prometheus",
    severity="error",
    custom_details={
        "error_rate": 7.5,
        "threshold": 5.0
    }
)
print(result)

# Resolve the incident
result = send_event(
    action="resolve",
    dedup_key="api-error-rate-high",
    summary="Error rate normalized",
    source="prometheus",
    severity="info"
)
print(result)
```

### Node.js Example

```javascript
const axios = require('axios');

const OPSKNIGHT_URL = 'https://your-opsknight.com';
const INTEGRATION_KEY = 'your-integration-key';

async function sendEvent(action, dedupKey, summary, source, severity, customDetails = null) {
  const response = await axios.post(
    `${OPSKNIGHT_URL}/api/events`,
    {
      event_action: action,
      dedup_key: dedupKey,
      payload: {
        summary,
        source,
        severity,
        ...(customDetails && { custom_details: customDetails }),
      },
    },
    {
      headers: {
        Authorization: `Token token=${INTEGRATION_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return response.data;
}

// Trigger incident
sendEvent(
  'trigger',
  'memory-usage-critical',
  'Memory usage above 95%',
  'node-exporter',
  'critical',
  {
    memory_percent: 97.5,
    host: 'app-server-01',
  }
).then(console.log);
```

---

## Integration Setup

### Creating an Integration Key

1. Go to **Services** → Select a service
2. Click **Integrations** tab
3. Click **Add Integration**
4. Enter a name (e.g., "Prometheus Alerts")
5. Copy the generated **Integration Key**

### Integration Key Format

Integration keys are 32-character hexadecimal strings, auto-generated and unique per integration.

---

## What Happens After Trigger

When a new incident is triggered:

1. **Alert Logged**: Raw alert data stored for reference
2. **Incident Created**: New incident with title from summary
3. **Escalation Started**: Escalation policy executed if configured
4. **Notifications Sent**:
   - Service-level notifications (Slack, webhooks) if escalation policy exists
   - User notifications if no escalation policy
5. **Status Page Updated**: Webhooks triggered for status page integrations

---

## Related Topics

- [Incidents API](./incidents) — Direct incident management
- [Integrations](../integrations) — Integration configuration
- [Services](../core-concepts/services) — Service setup
