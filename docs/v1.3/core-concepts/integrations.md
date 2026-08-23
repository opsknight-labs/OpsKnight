---
order: 8
title: Integrations
description: Complete guide to alert ingestion and notification integrations
---

# Integrations

OpsKnight integrations connect your monitoring stack to incident management. This guide covers both **alert ingestion** (getting alerts into OpsKnight) and **notification channels** (sending alerts out to responders).

<!-- placeholder:integrations-overview -->
<!-- Add: Diagram showing alert sources → OpsKnight → notification channels -->

---

## Integration Types

OpsKnight has two categories of integrations:

| Type                      | Purpose                              | Direction |
| ------------------------- | ------------------------------------ | --------- |
| **Alert Ingestion**       | Receive alerts from monitoring tools | Inbound   |
| **Notification Channels** | Send alerts to responders            | Outbound  |

```
Alert Sources (Datadog, Prometheus, etc.)
              │
              ▼
        ┌───────────┐
        │ OpsKnight │
        │ Incidents │
        └─────┬─────┘
              │
              ▼
Notification Channels (Email, Slack, SMS, etc.)
```

---

# Part 1: Alert Ingestion Integrations

Alert ingestion integrations bring alerts from your monitoring tools into OpsKnight, creating and managing incidents automatically.

## How Alert Ingestion Works

1. **External system** sends a webhook to OpsKnight
2. **OpsKnight validates** the request (authentication, signature)
3. **Payload is transformed** to a standard event format
4. **Deduplication** checks for existing incidents
5. **Incident is created** or updated
6. **Escalation policy** triggers notifications

```
POST /api/integrations/{type}?integrationId=xxx
  OR
POST /api/events (with routing key)
              │
              ▼
    ┌─────────────────────┐
    │   Authentication    │
    │ (Integration key or │
    │   API key + scope)  │
    └─────────┬───────────┘
              │
              ▼
    ┌─────────────────────┐
    │ Signature Verify    │
    │ (if secret set)     │
    └─────────┬───────────┘
              │
              ▼
    ┌─────────────────────┐
    │ Payload Transform   │
    │ (Datadog → Event)   │
    └─────────┬───────────┘
              │
              ▼
    ┌─────────────────────┐
    │   Deduplication     │
    │ (same dedup_key?)   │
    └─────────┬───────────┘
              │
              ▼
    ┌─────────────────────┐
    │  Create/Update      │
    │    Incident         │
    └─────────────────────┘
```

---

## Supported Alert Sources (23+)

### Monitoring & APM

| Integration                 | Description                         |
| --------------------------- | ----------------------------------- |
| **Datadog**                 | Full Datadog monitor alerts         |
| **Prometheus Alertmanager** | Prometheus/Alertmanager alerts      |
| **Grafana**                 | Grafana alerting (unified & legacy) |
| **New Relic**               | New Relic alert policies            |
| **Dynatrace**               | Dynatrace problem notifications     |
| **AppDynamics**             | AppDynamics health violations       |
| **Elastic/Kibana**          | Elasticsearch Watcher alerts        |
| **Honeycomb**               | Honeycomb triggers                  |
| **Splunk Observability**    | Splunk detector alerts              |
| **Sentry**                  | Sentry issue alerts                 |

### Cloud Providers

| Integration                 | Description               |
| --------------------------- | ------------------------- |
| **AWS CloudWatch**          | CloudWatch alarms via SNS |
| **Azure Monitor**           | Azure Monitor alerts      |
| **Google Cloud Monitoring** | GCP alerts via Pub/Sub    |

### CI/CD & DevOps

| Integration   | Description                        |
| ------------- | ---------------------------------- |
| **GitHub**    | Workflow failures, security alerts |
| **GitLab**    | Pipeline failures, alerts          |
| **Bitbucket** | Pipeline notifications             |

### Uptime Monitoring

| Integration       | Description               |
| ----------------- | ------------------------- |
| **UptimeRobot**   | Uptime monitor alerts     |
| **Pingdom**       | Pingdom check alerts      |
| **Better Uptime** | Better Uptime monitors    |
| **Uptime Kuma**   | Self-hosted uptime alerts |

### Other

| Integration         | Description                        |
| ------------------- | ---------------------------------- |
| **Events API V2**   | Generic API (PagerDuty-compatible) |
| **Generic Webhook** | Flexible custom webhook            |

---

## Creating an Integration

### Step 1: Navigate to Service Integrations

1. Go to **Services** in the sidebar
2. Select the service to receive alerts
3. Click the **Integrations** tab

<!-- placeholder:service-integrations-tab -->
<!-- Add: Screenshot of service integrations page -->

### Step 2: Add Integration

1. Click **Add Integration**
2. Select the integration type (e.g., Datadog, Prometheus)
3. Enter a **Name** (e.g., "Production Datadog Monitors")
4. Click **Create**

### Step 3: Copy Integration Details

After creation, you'll see:

- **Webhook URL**: The endpoint to configure in your monitoring tool
- **Integration Key**: Unique routing key for this integration

<!-- placeholder:integration-details -->
<!-- Add: Screenshot showing integration card with key and URL -->

### Step 4: Configure Your Monitoring Tool

Use the webhook URL and integration key to configure alerts in your monitoring system.

---

## Integration Fields Explained

When you create an integration, OpsKnight generates and stores:

| Field               | Description                                  | Generated?    | Required?         |
| ------------------- | -------------------------------------------- | ------------- | ----------------- |
| **id**              | Unique integration identifier                | Auto          | -                 |
| **name**            | Display name (e.g., "Prod Datadog")          | User input    | Yes               |
| **type**            | Integration type (DATADOG, PROMETHEUS, etc.) | User select   | Yes               |
| **key**             | 32-character hex routing key                 | Auto          | -                 |
| **signatureSecret** | HMAC secret for webhook verification         | User input    | **No (Optional)** |
| **enabled**         | Toggle to enable/disable                     | Default: true | -                 |
| **serviceId**       | Which service receives alerts                | User select   | Yes               |

### About the Integration Key (Routing Key)

The **integration key** (also called routing key) is:

- **Auto-generated**: 32-character hexadecimal string
- **Unique per integration**: Each integration has its own key
- **Used for authentication**: External systems send this key to identify the integration
- **Tied to a service**: Routes alerts to the correct service

Example key: `a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6`

### About the Signature Secret (Optional)

The **signature secret** is:

- **Optional**: Not required, but recommended for security
- **User-configured**: You set this after creation
- **Used for verification**: Validates webhook requests are genuine
- **HMAC-SHA256**: Standard cryptographic verification

**When to use a signature secret**:

- Your monitoring tool supports webhook signing (most do)
- You want to verify requests are from your monitoring tool
- You're in a production environment

---

## Authentication Methods

### Method 1: Integration Key via Events API

Send alerts using the routing key in the Authorization header:

```bash
curl -X POST https://your-opsknight.com/api/events \
  -H "Authorization: Token token=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6" \
  -H "Content-Type: application/json" \
  -d '{
    "event_action": "trigger",
    "dedup_key": "unique-alert-id",
    "payload": {
      "summary": "High CPU on web-01",
      "source": "monitoring",
      "severity": "critical"
    }
  }'
```

### Method 2: Integration-Specific Webhooks

Configure your monitoring tool to send webhooks directly:

```
https://your-opsknight.com/api/integrations/datadog?integrationId=<integration_id>
```

Each integration type has its own endpoint that understands the native payload format.

### Method 3: API Key with Scopes

For programmatic access with specific permissions:

```bash
curl -X POST https://your-opsknight.com/api/events \
  -H "Authorization: Bearer sk_live_abc123..." \
  -H "Content-Type: application/json" \
  -d '{
    "service_id": "svc_xyz",
    "event_action": "trigger",
    ...
  }'
```

Requires `events:write` scope.

---

## Signature Verification

### Why Use Signature Verification?

Signature verification ensures:

- Webhooks are from your monitoring tool, not attackers
- Payloads haven't been tampered with
- Replay attacks are prevented

### Setting Up Signature Verification

1. Open the integration in OpsKnight
2. Click **Set Signature Secret**
3. Enter a secret (or generate one)
4. Copy the secret to your monitoring tool's webhook settings

### How Verification Works

```
1. Monitoring tool computes HMAC-SHA256:
   signature = HMAC-SHA256(payload_body, secret)

2. Sends header:
   X-Signature: sha256=<computed_signature>

3. OpsKnight verifies:
   expected = HMAC-SHA256(received_body, stored_secret)
   if expected != received_signature → 401 Unauthorized
```

### Provider-Specific Headers

Different tools use different signature headers:

| Provider | Header                                 |
| -------- | -------------------------------------- |
| GitHub   | `X-Hub-Signature-256`                  |
| GitLab   | `X-Gitlab-Token`                       |
| Sentry   | `Sentry-Hook-Signature`                |
| Slack    | `X-Slack-Signature`                    |
| Grafana  | `X-Grafana-Signature`                  |
| Generic  | `X-Signature` or `X-Webhook-Signature` |

---

## Events API V2 Format

The Events API uses a PagerDuty-compatible format that works with any tool:

### Trigger Event

```json
{
  "event_action": "trigger",
  "dedup_key": "srv-web-01/high-cpu",
  "payload": {
    "summary": "High CPU usage on web-01 (95%)",
    "source": "monitoring-system",
    "severity": "critical",
    "custom_details": {
      "cpu_percent": 95,
      "host": "web-01",
      "region": "us-east-1"
    }
  }
}
```

### Acknowledge Event

```json
{
  "event_action": "acknowledge",
  "dedup_key": "srv-web-01/high-cpu"
}
```

### Resolve Event

```json
{
  "event_action": "resolve",
  "dedup_key": "srv-web-01/high-cpu"
}
```

### Event Fields

| Field                    | Required      | Description                            |
| ------------------------ | ------------- | -------------------------------------- |
| `event_action`           | Yes           | `trigger`, `acknowledge`, or `resolve` |
| `dedup_key`              | Yes           | Unique identifier for deduplication    |
| `payload.summary`        | Yes (trigger) | Alert title/summary                    |
| `payload.source`         | Yes (trigger) | Origin system name                     |
| `payload.severity`       | No            | `critical`, `error`, `warning`, `info` |
| `payload.custom_details` | No            | Additional metadata (any JSON)         |

### Deduplication

The `dedup_key` is crucial for deduplication:

- Same `dedup_key` = same incident
- New triggers update existing open incident
- Resolve events close the matching incident
- Choose keys that uniquely identify the alert (e.g., `host/check`)

---

## Integration-Specific Setup

### Datadog

1. In Datadog, go to **Integrations → Webhooks**
2. Create a new webhook:
   - **Name**: OpsKnight
   - **URL**: `https://your-opsknight.com/api/integrations/datadog?integrationId=<id>`
3. In your monitors, add the `@webhook-OpsKnight` notification

**Payload transformation**:

- `alert_type` → `severity` (error → critical, warning → warning)
- `aggregation_key` → `dedup_key`
- `title` → `summary`

### Prometheus Alertmanager

Add to `alertmanager.yml`:

```yaml
receivers:
  - name: opsknight
    webhook_configs:
      - url: 'https://your-opsknight.com/api/integrations/prometheus?integrationId=<id>'
        send_resolved: true
```

**Payload transformation**:

- `status: firing` → trigger event
- `status: resolved` → resolve event
- `labels.alertname` → summary
- `labels.severity` → severity
- Fingerprint or label hash → dedup_key

### Grafana

1. In Grafana, go to **Alerting → Contact points**
2. Add new contact point:
   - **Type**: Webhook
   - **URL**: `https://your-opsknight.com/api/integrations/grafana?integrationId=<id>`
3. Create notification policy using this contact point

**Supports both formats**:

- Grafana unified alerting (new)
- Prometheus Alertmanager format

### Generic Webhook

For tools not explicitly supported, use the generic webhook with custom field mapping:

```
URL: https://your-opsknight.com/api/integrations/webhook?integrationId=<id>
```

Configure field mapping in OpsKnight:

- `summaryField`: Path to alert title (e.g., `alert.title`)
- `severityField`: Path to severity (e.g., `level`)
- `dedupKeyField`: Path to unique ID (e.g., `alert_id`)
- `actionField`: Path to action (e.g., `status`)
- `triggerValues`: Values that mean "trigger" (e.g., `["fired", "alert"]`)
- `resolveValues`: Values that mean "resolve" (e.g., `["ok", "resolved"]`)

---

## Rate Limiting

Integration webhooks are rate-limited to prevent abuse:

| Limit             | Value                              |
| ----------------- | ---------------------------------- |
| Per integration   | 120 requests/minute                |
| Response on limit | HTTP 429 with `Retry-After` header |

If rate-limited:

1. Queue alerts in your monitoring tool
2. Retry with exponential backoff
3. Respect the `Retry-After` header

---

## Enabling/Disabling Integrations

Toggle integrations without deleting them:

1. Open the service integrations page
2. Find the integration
3. Click the **Enable/Disable** toggle

When disabled:

- Webhooks return 403 Forbidden
- No incidents are created
- Easy to re-enable later

---

# Part 2: Notification Integrations

Notification integrations send alerts to responders through various channels.

## Notification Channels

| Channel      | Description                           |
| ------------ | ------------------------------------- |
| **Email**    | SMTP, SendGrid, Resend                |
| **SMS**      | Twilio, AWS SNS                       |
| **Push**     | Browser/mobile push via OneSignal     |
| **Slack**    | Slack workspace integration           |
| **Webhook**  | Google Chat, Teams, Discord, Telegram |
| **WhatsApp** | WhatsApp Business API                 |

---

## Service-Level Notification Settings

Each service can have its own notification preferences.

### Configure Service Notifications

1. Open the service
2. Go to **Settings**
3. Configure notification options:

| Setting                    | Description                           |
| -------------------------- | ------------------------------------- |
| **Notification Channels**  | Which channels to use                 |
| **Notify on Triggered**    | Send notification when incident opens |
| **Notify on Acknowledged** | Send notification when acknowledged   |
| **Notify on Resolved**     | Send notification when resolved       |
| **Notify on SLA Breach**   | Send notification on SLA breach       |

### Channel Priority

Channels are tried in order based on user preferences:

1. Push notification (fastest)
2. Slack (if workspace connected)
3. SMS (for high urgency)
4. Email (always sent)

---

## Slack Integration

### Connecting Slack

1. Go to **Settings → Integrations → Slack**
2. Click **Connect to Slack**
3. Authorize OpsKnight in your workspace
4. Select a default notification channel

### Slack Features

- **Incident notifications** in channels
- **Interactive buttons** (Acknowledge, Resolve)
- **Thread updates** for incident timeline
- **User mentions** for on-call responders
- **Slash commands** (optional)

### Per-Service Slack Channels

Configure different Slack channels per service:

1. Open the service
2. Go to **Settings → Notifications**
3. Select the Slack channel for this service

---

## Webhook Integrations (Outbound)

Send notifications to external systems via webhooks.

### Supported Destinations

| Type                | Description                  |
| ------------------- | ---------------------------- |
| **Google Chat**     | Google Workspace chat        |
| **Microsoft Teams** | Teams channels via connector |
| **Discord**         | Discord server webhooks      |
| **Telegram**        | Telegram bot notifications   |
| **Generic**         | Any HTTP endpoint            |

### Creating a Webhook Integration

1. Go to **Settings → Integrations → Webhooks**
2. Click **Add Webhook**
3. Configure:
   - **Name**: Display name
   - **Type**: Google Chat, Teams, Discord, Telegram, or Generic
   - **URL**: Webhook endpoint URL
   - **Secret**: HMAC secret (optional)
   - **Channel**: Channel identifier (if applicable)

### Webhook Payload Format

**Generic webhook payload**:

```json
{
  "event": "incident.triggered",
  "timestamp": "2024-01-23T10:30:00Z",
  "incident": {
    "id": "inc_abc123",
    "title": "High CPU on web-01",
    "status": "OPEN",
    "urgency": "HIGH",
    "service": {
      "id": "svc_xyz",
      "name": "Web Application"
    },
    "assignee": {
      "id": "usr_123",
      "name": "Jane Doe"
    },
    "url": "https://opsknight.example.com/incidents/inc_abc123"
  }
}
```

---

## Email Configuration

### Email Providers

| Provider     | Configuration                  |
| ------------ | ------------------------------ |
| **Resend**   | API key                        |
| **SendGrid** | API key                        |
| **SMTP**     | Host, port, username, password |

### Configure via Settings

1. Go to **Settings → Notifications → Email**
2. Select provider and enter credentials
3. Test with **Send Test Email**

### Configure via Environment

```bash
# SMTP
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user@example.com
SMTP_PASSWORD=password
SMTP_FROM=noreply@example.com

# Or Resend
RESEND_API_KEY=re_xxx

# Or SendGrid
SENDGRID_API_KEY=SG.xxx
```

---

## SMS Configuration

### Twilio

```bash
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_PHONE_NUMBER=+1234567890
```

### AWS SNS

```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
```

### User Phone Numbers

Users must add their phone number in **Profile → Contact Methods** to receive SMS.

---

## Push Notifications

### OneSignal Setup

```bash
ONESIGNAL_APP_ID=xxx
ONESIGNAL_API_KEY=xxx
```

### User Opt-In

Users enable push notifications via:

1. Installing the PWA
2. Allowing notification permissions
3. Device registered automatically

---

## Best Practices

### For Alert Ingestion

- **Use signature verification** in production
- **Choose meaningful dedup keys** (e.g., `host/check/severity`)
- **Send resolve events** when alerts clear
- **Test integrations** before going live
- **Monitor rate limits** if sending many alerts

### For Notifications

- **Enable multiple channels** for critical services
- **Configure service-level channels** for team-specific Slack
- **Set up SMS** for high-urgency incidents
- **Test notification flow** with a test incident

---

## Troubleshooting

### Integration Not Receiving Alerts

1. Check integration is **enabled**
2. Verify **webhook URL** is correct in monitoring tool
3. Check **integration key** matches
4. Review OpsKnight logs for errors

### Signature Verification Failing

1. Verify **secret matches** in both systems
2. Check **header name** is correct for your provider
3. Ensure **payload isn't modified** in transit

### Notifications Not Sending

1. Check **notification channel** is configured
2. Verify **user contact methods** are set
3. Check **service notification settings**
4. Review notification logs in incident timeline

---

## Related Topics

- [Services](./services) — Service configuration
- [Escalation Policies](./escalation-policies) — Notification routing
- [Events API](../api/events) — API documentation
- [Notifications](../administration/notifications) — Channel setup
- [Slack Integration](../integrations/communication/slack) — Detailed Slack setup
