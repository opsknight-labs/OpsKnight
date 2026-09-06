---
order: 3
---

# Incidents

Incidents track issues from trigger to resolution. They drive notifications, escalations, and reporting.

## Incident Lifecycle

```
TRIGGERED -> ACKNOWLEDGED -> RESOLVED
     \-> SNOOZED
     \-> ESCALATED
```

### Statuses

| Status       | Description                     |
| ------------ | ------------------------------- |
| Triggered    | New incident, awaiting response |
| Acknowledged | Ownership assigned              |
| Resolved     | Issue fixed                     |
| Snoozed      | Temporarily silenced            |
| Suppressed   | Matched a suppression rule      |

## Create Incidents

### Via API

```bash
curl -X POST https://your-ops.com/api/events \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "routing_key": "SERVICE_ROUTING_KEY",
    "event_action": "trigger",
    "dedup_key": "cpu-high",
    "payload": {
      "summary": "CPU usage above 90%",
      "source": "prometheus",
      "severity": "warning"
    }
  }'
```

### Via UI

1. Go to **Incidents**
2. Click **+ New Incident**
3. Fill in details and submit

## Priority and Urgency

| Priority | Response Time | Use Case             |
| -------- | ------------- | -------------------- |
| P1       | Immediate     | Production down      |
| P2       | < 1 hour      | Major feature broken |
| P3       | < 4 hours     | Degraded performance |
| P4       | < 24 hours    | Minor issues         |

## Deduplication

The `dedup_key` groups related alerts into a single incident.

- Same key → update existing incident
- New key → create new incident

## Incident Actions

### Acknowledge

```bash
curl -X POST https://your-ops.com/api/events \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "routing_key": "SERVICE_ROUTING_KEY",
    "event_action": "acknowledge",
    "dedup_key": "cpu-high"
  }'
```

### Resolve

```bash
curl -X POST https://your-ops.com/api/events \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "routing_key": "SERVICE_ROUTING_KEY",
    "event_action": "resolve",
    "dedup_key": "cpu-high"
  }'
```

## Best Practices

- Use descriptive `dedup_key` values.
- Add context in `payload.summary` and `custom_details`.
- Resolve incidents when the issue clears.
- Record notes during triage.
