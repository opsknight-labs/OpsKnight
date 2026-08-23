---
order: 7
title: Sentry
description: Receive Sentry issue alerts in OpsKnight
---

# Sentry Integration

Receive error and issue alerts from Sentry and create incidents automatically.

---

## Endpoint

```
POST /api/integrations/sentry?integrationId=YOUR_INTEGRATION_ID
```

---

## Setup

### Step 1: Create Integration in OpsKnight

1. Go to **Services** and select your service
2. Click **Integrations** tab
3. Click **Add Integration**
4. Select **Sentry**
5. Copy the **Integration ID**
6. (Optional) Generate a **Signing Secret** for security

### Step 2: Configure Sentry Webhook

1. In Sentry, go to **Settings** → **Integrations**
2. Search for **Webhooks**
3. Click **Add to Project** or configure existing
4. Set **Callback URL**:
   ```
   https://YOUR_OPSKNIGHT_URL/api/integrations/sentry?integrationId=YOUR_INTEGRATION_ID
   ```

### Step 3: Create Alert Rule

1. Go to **Alerts** in Sentry
2. Click **Create Alert Rule**
3. Configure conditions (e.g., "When an event is seen")
4. Add action: **Send a notification via webhooks**
5. Select your OpsKnight webhook
6. Save the rule

---

## Security

> **Strict Security Enforcement**: If you generate a Signing Secret in OpsKnight, you **MUST** configure the same secret in Sentry. OpsKnight will reject any requests without a valid signature if a secret exists.

### Configuring Signing Secret

1. In OpsKnight, copy the **Signing Secret** from the integration
2. In Sentry webhook settings, add the secret
3. Sentry will include signature in requests

---

## Supported Formats

### Issue Format

```json
{
  "action": "created",
  "issue": {
    "id": "12345",
    "shortId": "PROJECT-ABC",
    "title": "TypeError: Cannot read property 'foo' of undefined",
    "culprit": "app/components/Button.tsx",
    "level": "error",
    "status": "unresolved",
    "metadata": {
      "type": "TypeError",
      "value": "Cannot read property 'foo' of undefined"
    },
    "permalink": "https://sentry.io/organizations/myorg/issues/12345/"
  },
  "project": {
    "name": "My Project",
    "slug": "my-project"
  }
}
```

### Legacy Event Format

```json
{
  "event": {
    "event_id": "abc123def456",
    "message": "Failed to process payment",
    "level": "error",
    "timestamp": 1705312800,
    "platform": "javascript",
    "tags": {
      "environment": "production"
    }
  },
  "project": {
    "name": "My Project",
    "slug": "my-project"
  }
}
```

---

## Event Mapping

| Sentry Action | OpsKnight Action     |
| ------------- | -------------------- |
| `created`     | Trigger incident     |
| `resolved`    | Resolve incident     |
| `ignored`     | Acknowledge incident |

If `issue.status` is `resolved` or `ignored`, the corresponding action is taken regardless of the `action` field.

---

## Severity Mapping

| Sentry Level | OpsKnight Severity |
| ------------ | ------------------ |
| `fatal`      | critical           |
| `error`      | error              |
| `warning`    | warning            |
| `info`       | info               |
| `debug`      | info               |

---

## Incident Title

The incident title is extracted as:

- **Issue format**: `issue.title`
- **Event format**: `event.message` or "Sentry Error"

The source includes project name: `Sentry - {project.name}`

---

## Deduplication

Dedup keys are generated as:

- **Issue format**: `sentry-{issue.id}`
- **Event format**: `sentry-{event.event_id}`

This ensures the same Sentry issue maps to the same OpsKnight incident.

---

## Testing

### Using Sentry UI

1. Go to **Alerts** in Sentry
2. Click on your alert rule
3. Click **Test** to send a test notification
4. Verify incident appears in OpsKnight

### Using cURL

Send a test payload directly:

```bash
curl -X POST "https://YOUR_OPSKNIGHT_URL/api/integrations/sentry?integrationId=YOUR_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "created",
    "issue": {
      "id": "test-001",
      "shortId": "TEST-001",
      "title": "Test Error from Sentry",
      "culprit": "test/file.js",
      "level": "error",
      "status": "unresolved",
      "permalink": "https://sentry.io/test"
    },
    "project": {
      "name": "Test Project",
      "slug": "test-project"
    }
  }'
```

---

## Troubleshooting

### Alerts Not Appearing

1. **Check webhook URL** is correct in Sentry
2. **Verify integration ID** is valid
3. **Check alert rule** is active and conditions are met
4. **Verify webhook** is selected in alert actions

### 401 Unauthorized Error

1. **Check signing secret** matches in both OpsKnight and Sentry
2. **Remove secret** from OpsKnight if you don't want signature verification
3. **Verify Sentry** is sending the signature header

### Issues Not Resolving

1. **Configure alert rule** to also notify on issue resolution
2. **Check issue status** in Sentry

### Wrong Severity

1. **Set error level** appropriately in your Sentry SDK
2. **Use standard levels**: `fatal`, `error`, `warning`, `info`

---

## Related Topics

- [Events API](../../api/events) — Programmatic event submission
- [Integrations Overview](.) — All integrations
