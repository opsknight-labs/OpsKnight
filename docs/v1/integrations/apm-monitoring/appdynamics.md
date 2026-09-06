---
order: 4
title: AppDynamics
description: Integrate AppDynamics with OpsKnight.
---

# AppDynamics Integration

Receive health rule violations from AppDynamics.

---

## Endpoint

```
POST /api/integrations/appdynamics?integrationId=YOUR_INTEGRATION_ID
```

---

## Setup

### Step 1: Create Integration in OpsKnight

1. In OpsKnight, go to **Service -> Integrations**.
2. Add a **AppDynamics** integration.
3. Copy the **Webhook URL**:
   `https://[YOUR_DOMAIN]/api/integrations/appdynamics?integrationId=[ID]`

### Step 2: Configure AppDynamics

1. Go to **Alert & Respond -> HTTP Request Templates**.
2. Create a new Template named "OpsKnight".
3. Request URL: Paste the OpsKnight Webhook URL.
4. Method: `POST`.
5. Payload MIME Type: `application/json`.
6. Add this template to your **policies**.

## Payload Format

Template your AppDynamics HTTP Request with JSON:

```json
{
  "summary": "${latestEvent.displayName}",
  "severity": "${latestEvent.severity}",
  "eventType": "${latestEvent.eventType}",
  "incidentId": "${latestEvent.id}",
  "eventMessage": "${latestEvent.summaryMessage}",
  "application": "${latestEvent.application.name}"
}
```

## Event Mapping

| AppDynamics Event | OpsKnight Action |
| ----------------- | ---------------- |
| `POLICY_OPEN`     | Trigger incident |
| `POLICY_CLOSE`    | Resolve incident |
| `POLICY_UPGRADED` | Trigger (Update) |

## Deduplication

Dedup key is generated from `appdynamics-{incidentId}`.

## Testing

### Using cURL

```bash
curl -X POST "https://YOUR_OPSKNIGHT_URL/api/integrations/appdynamics?integrationId=YOUR_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "summary": "Health Rule Violation",
    "severity": "ERROR",
    "eventType": "POLICY_OPEN",
    "incidentId": "101",
    "application": "E-Commerce"
  }'
```

## Troubleshooting

### Variable Substitution Not Working

Ensure you are using the correct `${variable}` syntax in the AppDynamics HTTP Template editor. Check AppDynamics documentation for the exact variable names available in your version.

## Event Logic

- **Summary**: Derived from `summary`, `eventMessage`, or `eventType`.
- **Urgency**: Maps `severity` or `eventSeverity` to OpsKnight urgency (automatically normalized).
- **Deduplication**: Uses `incidentId` or `eventId` to group updates.
