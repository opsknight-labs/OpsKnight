---
order: 2
---

# Services

Services represent the systems, applications, or dependencies you want to monitor.

## What is a Service?

A service can be:

- APIs and microservices
- Databases
- Infrastructure components
- Third-party dependencies
- Business workflows

## Create a Service

1. Go to **Services**
2. Click **+ New Service**
3. Fill in:

| Field             | Description                 | Required |
| ----------------- | --------------------------- | -------- |
| Name              | Unique service name         | ✅       |
| Description       | Short summary               | -        |
| Escalation Policy | How incidents are escalated | -        |

## Integrations

Each service can have multiple integrations. The Events API integration is the default entry point.

```bash
curl -X POST https://your-ops.com/api/events \
  -H "Content-Type: application/json" \
  -d '{
    "routing_key": "YOUR_SERVICE_ROUTING_KEY",
    "event_action": "trigger",
    "dedup_key": "unique-alert-id",
    "payload": {
      "summary": "Database connection timeout",
      "source": "monitoring",
      "severity": "critical"
    }
  }'
```

## Severity Levels

| Severity   | Description       |
| ---------- | ----------------- |
| `critical` | Service is down   |
| `error`    | Significant issue |
| `warning`  | Potential problem |
| `info`     | Informational     |

## Health Status

Service status updates based on incident severity:

| Status          | Meaning                   |
| --------------- | ------------------------- |
| 🟢 Operational  | No active incidents       |
| 🟡 Degraded     | Active warning incidents  |
| 🔴 Major Outage | Active critical incidents |

## Best Practices

- Use consistent naming (e.g., `api-gateway`, `user-service`).
- Assign an escalation policy for production services.
- Group services by team ownership.
