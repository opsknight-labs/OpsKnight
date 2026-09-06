---
order: 2
title: Notifications
description: Configure Email, SMS, Push, WhatsApp, and Slack notification channels
---

# Notification Configuration

Notifications are the lifeblood of incident management. Without reliable notifications, incidents go unnoticed and response times suffer. This guide covers setting up all six notification channels supported by OpsKnight.

<!-- placeholder:notifications-overview -->
<!-- Add: Screenshot of the Notifications settings page showing all providers -->

---

## Why Multiple Channels Matter

Different situations call for different notification methods:

| Scenario            | Best Channel | Why                          |
| ------------------- | ------------ | ---------------------------- |
| Normal alerts       | Email, Slack | Non-intrusive, async         |
| Critical incidents  | SMS, Push    | Immediate attention          |
| On-call escalation  | SMS + Push   | Can't be missed              |
| Team coordination   | Slack        | Interactive, threaded        |
| International teams | WhatsApp     | Global reach                 |
| Automated systems   | Webhooks     | Integration with other tools |

**Recommendation**: Configure at least **Email + Slack** for basic coverage, add **SMS** for critical alerts.

---

## Notification Channels Overview

| Channel      | Provider Options                | Best For                     |
| ------------ | ------------------------------- | ---------------------------- |
| **Email**    | SMTP, SendGrid, AWS SES, Resend | All users, reliable delivery |
| **SMS**      | Twilio, AWS SNS                 | Critical alerts, on-call     |
| **Push**     | Web Push (PWA)                  | Mobile/PWA users             |
| **Slack**    | Slack OAuth                     | Team collaboration           |
| **WhatsApp** | Twilio                          | International teams          |
| **Webhooks** | Any HTTP endpoint               | Custom integrations          |

---

## Email Configuration

Email is the most universal notification channel — every user has an email address.

### Provider Options

| Provider     | Pros                   | Cons                 |
| ------------ | ---------------------- | -------------------- |
| **SMTP**     | Universal, self-hosted | May hit spam filters |
| **SendGrid** | High deliverability    | Cost at scale        |
| **AWS SES**  | Low cost, scalable     | AWS account required |
| **Resend**   | Developer-friendly     | Newer service        |

### SMTP Configuration

For Gmail, Microsoft 365, or any SMTP server:

1. Go to **Settings** → **Notification Provider** → **Email**
2. Select **SMTP** provider
3. Enter credentials:

| Field            | Example              | Notes                          |
| ---------------- | -------------------- | ------------------------------ |
| **SMTP Host**    | `smtp.gmail.com`     | Your mail server               |
| **SMTP Port**    | `587`                | Usually 587 (TLS) or 465 (SSL) |
| **Username**     | `alerts@yourco.com`  | Email account                  |
| **Password**     | `••••••••`           | App password recommended       |
| **From Address** | `noreply@yourco.com` | Sender address                 |
| **From Name**    | `OpsKnight Alerts`   | Display name                   |

4. Click **Test Connection** to verify
5. Click **Save**

<!-- placeholder:smtp-config -->
<!-- Add: Screenshot of SMTP configuration form -->

#### Gmail Setup Notes

For Gmail/Google Workspace:

1. Enable "Less secure app access" OR
2. Create an **App Password** (recommended):
   - Go to Google Account → Security → App Passwords
   - Generate password for "Mail"
   - Use this as the SMTP password

### SendGrid Configuration

1. Create a SendGrid account at sendgrid.com
2. Go to Settings → API Keys → Create API Key
3. In OpsKnight:
   - Select **SendGrid** provider
   - Enter your API key
   - Set From Address (must be verified in SendGrid)
4. Test and save

### AWS SES Configuration

1. Set up AWS SES in your AWS account
2. Verify your sending domain
3. In OpsKnight:
   - Select **AWS SES** provider
   - Enter AWS credentials (Access Key, Secret Key)
   - Set Region (e.g., `us-east-1`)
   - Set From Address (must be verified)
4. Test and save

### Resend Configuration

1. Create a Resend account at resend.com
2. Generate an API key
3. In OpsKnight:
   - Select **Resend** provider
   - Enter your API key
   - Set From Address
4. Test and save

---

## SMS Configuration

SMS cuts through the noise — it's the best way to reach on-call responders for critical incidents.

### Twilio Setup

Twilio is the most popular option for SMS:

1. **Create Twilio Account**
   - Sign up at twilio.com
   - Note your Account SID and Auth Token

2. **Get a Phone Number**
   - Buy a phone number with SMS capability
   - Format: `+1234567890`

3. **Configure in OpsKnight**
   - Go to **Settings** → **Notifications** → **SMS**
   - Select **Twilio** provider
   - Enter credentials:

| Field            | Description                |
| ---------------- | -------------------------- |
| **Account SID**  | From Twilio Console        |
| **Auth Token**   | From Twilio Console        |
| **Phone Number** | Your Twilio number (+1...) |

4. **Test** by sending a test SMS
5. **Save** configuration

<!-- placeholder:twilio-config -->
<!-- Add: Screenshot of Twilio configuration form -->

### AWS SNS Setup

For high-volume SMS or if you're already on AWS:

1. **Set Up AWS SNS**
   - Enable SMS in AWS SNS console
   - Request production access for higher limits

2. **Configure in OpsKnight**
   - Select **AWS SNS** provider
   - Enter credentials:

| Field                 | Description         |
| --------------------- | ------------------- |
| **AWS Region**        | e.g., `us-east-1`   |
| **Access Key ID**     | IAM user access key |
| **Secret Access Key** | IAM user secret key |

3. **Test** and **Save**

### User Phone Numbers

Users must add and verify their phone numbers:

1. User goes to **Profile** → **Contact Info**
2. Enters phone number (with country code)
3. Clicks **Verify**
4. Enters SMS verification code
5. Phone number is now active for SMS

> **Note**: Users can enable/disable SMS notifications in their preferences.

---

## Push Notifications (PWA)

Push notifications reach users on their mobile and desktop devices via the OpsKnight Progressive Web App (PWA).

### VAPID Configuration

OpsKnight uses standard Web Push with VAPID keys, independent of third-party services like Firebase.

1. **Generate VAPID Keys**
   - You can generate these via command line: `npx web-push generate-vapid-keys`
   - Or use an online VAPID generator

2. **Configure in OpsKnight**
   - Go to **Settings** → **Notification Provider** → **Web Push (PWA)**
   - Enter your VAPID details:

| Field                 | Description                    |
| --------------------- | ------------------------------ |
| **VAPID Public Key**  | The public key string          |
| **VAPID Private Key** | The private key string         |
| **Contact Email**     | `mailto:admin@yourcompany.com` |

3. **Save** configuration

### User Device Registration

For push notifications to work, users must install the PWA:

1. **Open OpsKnight** in a browser (Chrome/Edge/Safari)
2. **Install App**:
   - Desktop: Click install icon in address bar
   - Mobile (iOS): Share → Add to Home Screen
   - Mobile (Android): Install App prompt
3. **Enable Notifications**:
   - Open the installed app
   - Accept notification permission when prompted
   - Device is automatically registered

Users can manage their push preferences in **Settings** → **Profile**.

---

## WhatsApp Configuration

WhatsApp is useful for international teams where SMS may be unreliable or expensive.

### Twilio WhatsApp Setup

WhatsApp uses Twilio's WhatsApp Business API:

1. **Enable WhatsApp in Twilio**
   - Go to Twilio Console → Messaging → WhatsApp
   - Complete WhatsApp Business onboarding

2. **Get WhatsApp Number**
   - Use your existing Twilio number OR
   - Request a dedicated WhatsApp number

3. **Configure in OpsKnight**
   - Use the same Twilio credentials as SMS
   - Enable WhatsApp channel
   - Enter WhatsApp-enabled phone number

4. **Test** and **Save**

### WhatsApp User Setup

Users must:

1. Add their WhatsApp number to their profile
2. Opt-in by sending a message to the OpsKnight WhatsApp number
3. Receive confirmation

---

## Slack Integration

Slack provides rich, interactive notifications with buttons for quick actions.

### Why Slack is Recommended

- **Interactive buttons** — Acknowledge/Resolve without leaving Slack
- **Thread updates** — Timeline events in threads
- **Channel routing** — Different channels for different services
- **Team visibility** — Everyone sees incident activity

### Setup

Full setup guide: [Slack OAuth Setup](../integrations/communication/slack-oauth-setup)

Quick overview:

1. Go to **Settings** → **Integrations** → **Slack**
2. Click **Connect to Slack**
3. Authorize OpsKnight in your workspace
4. Select default notification channel
5. Done!

### Per-Service Channels

You can route different services to different Slack channels:

1. Edit a service
2. Set **Slack Channel** to the desired channel
3. Alerts for that service go to that channel

---

## Webhooks (Custom)

Send notifications to any HTTP endpoint for custom integrations.

### Configuration

Webhooks are configured per-service, allowing specific routing for different services.

1. Go to **Services** and select a service
2. Click **Settings** (tab)
3. Under **Service Notification Channels**, check **WEBHOOK**
4. In the **Webhook Integrations** card that appears, click **Add Webhook**
5. Configure:

| Field    | Description                                   |
| -------- | --------------------------------------------- |
| **Name** | Display name (e.g., "Internal Ops Dashboard") |
| **URL**  | Your webhook endpoint                         |
| **Type** | Generic, Google Chat, Microsoft Teams, etc.   |

### Webhook Payload

```json
{
  "event": "incident.triggered",
  "incident": {
    "id": "inc_abc123",
    "title": "High CPU on web-01",
    "status": "OPEN",
    "urgency": "HIGH",
    "service": "Payment API"
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Signature Verification

OpsKnight signs webhooks with HMAC-SHA256 if a secret is configured. Requests include these headers:

```
X-OpsKnight-Signature: sha256=abc123...
X-OpsKnight-Timestamp: 1706179200000
```

Verify by computing HMAC of the request body with your secret. You can use the timestamp to protect against replay attacks.

---

## Notification Preferences

### User-Level Preferences

Each user controls their notification preferences:

**Settings** → **Profile** → **Notifications**

| Setting                    | Description             |
| -------------------------- | ----------------------- |
| **Email notifications**    | Enable/disable email    |
| **SMS notifications**      | Enable/disable SMS      |
| **Push notifications**     | Enable/disable push     |
| **WhatsApp notifications** | Enable/disable WhatsApp |
| **Digest level**           | ALL, HIGH only, or NONE |

### Service-Level Settings

Per-service notification settings:

| Setting                   | Default | Description            |
| ------------------------- | ------- | ---------------------- |
| **Notify on trigger**     | Yes     | When incident created  |
| **Notify on acknowledge** | Yes     | When someone acks      |
| **Notify on resolve**     | Yes     | When incident resolved |
| **Notify on SLA breach**  | Yes     | When SLA exceeded      |

---

## Notification Delivery Tracking

OpsKnight tracks delivery status for all notifications:

| Status        | Meaning                              |
| ------------- | ------------------------------------ |
| **PENDING**   | Queued for delivery                  |
| **SENT**      | Sent to provider                     |
| **DELIVERED** | Confirmed delivery (where supported) |
| **FAILED**    | Delivery failed                      |

### Viewing Delivery Status

1. Open an incident
2. Check the **Timeline** for notification events
3. See delivery status for each notification

### Troubleshooting Failed Notifications

1. Check **Event Logs** for error details
2. Verify provider credentials
3. Check user has valid contact info
4. Verify user has channel enabled
5. Check for rate limits

---

## Best Practices

## Notification Best Practices

### Reduce Alert Fatigue

- **Tune Triggers**: Ensure only actionable events trigger high-urgency incidents.
- **Use Service Isolation**: Configure service-specific channels for non-critical alerts.
- **Review Regularly**: Check Event Logs to identify noisy services.

### Testing

- **Test each provider** after configuration
- **Test as different users** to verify routing
- **Verify phone numbers** before relying on SMS
- **Check spam folders** for email delivery

### Redundancy

- Configure **multiple channels** for critical services
- SMS should always be a backup for on-call
- Don't rely solely on email (can be delayed)

---

## Troubleshooting

### Email Not Arriving

1. Check spam/junk folder
2. Verify SMTP credentials
3. Check if From Address is verified (SES, SendGrid)
4. Test with "Send Test Email"
5. Check **Event Logs** for errors

### SMS Not Received

1. Verify phone number format (+1234567890)
2. Check Twilio console for delivery status
3. Verify user has SMS enabled
4. Check Twilio account balance
5. Verify phone number can receive SMS

### Push Not Working

1. User must accept notification permission
2. **Check Push notifications are enabled** in Settings → Profile
3. Verify VAPID keys
4. Check service worker is installed (PWA)

### Slack Not Posting

1. Verify OAuth connection is active
2. Check bot has access to channel
3. Re-authorize if permissions changed
4. Check Slack channel exists

---

## Related Topics

- [Slack Integration](../integrations/communication/slack) — Full Slack setup
- [User Management](../core-concepts/users) — User notification preferences
- [Escalation Policies](../core-concepts/escalation-policies) — Channel routing
