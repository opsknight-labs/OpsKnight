---
order: 4
title: AppDynamics
description: Send AppDynamics policy open and close events to OpsKnight with stable incident correlation
---

# AppDynamics Integration

Receive health rule violations from AppDynamics.

---

## Endpoint

```
POST /api/integrations/appdynamics?integrationId=YOUR_INTEGRATION_ID&integrationKey=YOUR_INTEGRATION_KEY
```

---

## Setup

### Step 1: Create Integration in OpsKnight

1. In OpsKnight, go to **Service -> Integrations**.
2. Add a **AppDynamics** integration.
3. Copy the **Webhook URL**:
   `https://[YOUR_DOMAIN]/api/integrations/appdynamics?integrationId=[ID]&integrationKey=[KEY]`

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

| AppDynamics event type                                           | OpsKnight action              |
| ---------------------------------------------------------------- | ----------------------------- |
| Value containing `CLOSE`, `RESOLVED`, `RECOVERED`, `OK`, or `UP` | Resolve                       |
| Value containing `ACK`/`ACKNOWLEDGE`                             | Acknowledge an existing match |
| Every other value, including open/upgraded violations            | Trigger                       |

## Deduplication

The key is the raw `incidentId`, falling back to raw `eventId`. If neither exists, OpsKnight uses `appdynamics-<normalized application-or-summary>`. The opening and closing templates must send the same `incidentId`; do not use a per-notification event ID if it changes on close.

## Security and operating boundary

The complete URL contains the required integration key. The optional generic signature requires an unprefixed raw-body HMAC-SHA256 digest in `X-Signature` or `X-Webhook-Signature`. AppDynamics HTTP templates do not automatically generate that OpsKnight digest; leave the signing secret unset for direct delivery or use a trusted signing gateway.

After a controlled open/close test, confirm both deliveries receive HTTP `202`, update the same incident, and then verify the service's urgency mapping and outbound page separately. The default integration limit is 100 requests per 60 seconds per integration.

## Testing

### Using cURL

```bash
curl -X POST "https://YOUR_OPSKNIGHT_URL/api/integrations/appdynamics?integrationId=YOUR_ID&integrationKey=YOUR_KEY" \
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

If a close does not resolve, compare the rendered `eventType` and selected ID in both raw payloads. A missing/changed ID or a close token not recognized by the table above prevents the expected update.

## Related topics

- [Inbound webhook reference](../inbound-webhook-reference)
- [Urgency mapping](../../core-concepts/urgency-mapping)
- [Troubleshooting](../../troubleshooting)
