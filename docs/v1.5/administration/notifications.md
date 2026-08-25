---
title: Notifications
description: Configure providers, user preferences, push devices, delivery order, service messages, and failure investigation.
order: 2
---

# Notifications

OpsKnight can create in-app notifications and deliver incident messages through email, SMS, web push, WhatsApp, Slack, and service webhooks. There is no native voice/PSTN channel in v1.4.

Reliable delivery requires several independent layers:

```text
valid incident recipient
  + enabled workspace provider
  + enabled user preference and contact/device data
  + escalation or service event
  + user Quiet Hours policy when explicitly enabled
  → notification attempt and history
```

Saving one layer does not verify the whole path. Test every production recipient type with a controlled incident.

## Permissions and settings

- An application **Admin** configures workspace providers in **Settings → Notification Providers**.
- Each user configures personal Email, SMS, Push, WhatsApp, and Quiet Hours preferences under **Settings → Profile & Preferences → Notification Preferences**.
- Admins/Responders configure service-level Slack and webhook events under **Service → Settings**.
- Policy administration is Admin-only. New steps in the current v1.4 UI inherit user preferences; the UI does not expose new per-step channel overrides.
- Signed-in users can open **Settings → Notification History**; access to operational data should still be governed by deployment policy.

## Supported provider matrix

| Channel  | v1.4 provider/configuration                            | Recipient requirement                                               | Test method                                            |
| -------- | ------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------ |
| In-app   | Built in                                               | Active OpsKnight account                                            | Assign/target a test incident.                         |
| Email    | Resend, SendGrid, SMTP, or Amazon SES                  | Email preference enabled and valid account email                    | Controlled incident; inspect provider and history.     |
| SMS      | Twilio or AWS SNS                                      | SMS preference enabled and E.164 phone number                       | Controlled incident; inspect the provider and history. |
| Push     | Standard Web Push with VAPID keys                      | Push preference, browser permission, registered subscription, HTTPS | User's **Test Push** control.                          |
| WhatsApp | Twilio WhatsApp Business                               | WhatsApp preference and E.164 phone number                          | Approved test incident/template path.                  |
| Slack    | Slack workspace/OAuth or service webhook configuration | Service/workspace channel configuration                             | Slack setup and synthetic incident.                    |
| Webhook  | Service webhook integration                            | Reachable allowed URL and selected events                           | Webhook test plus synthetic incident.                  |

Microsoft Teams and Google Chat are not native notification-provider types. A generic webhook may work with a compatible incoming-webhook receiver, but its payload must be tested and it does not provide native rooms, slash commands, or interactive actions.

## Delivery selection for users

For a policy/user notification, OpsKnight builds the available user channels in this order:

1. Push
2. SMS
3. WhatsApp
4. Email

It attempts channels in order and normally stops after the first successful non-email delivery. For a High-urgency incident, it can continue to email after a successful primary non-email channel. Failed earlier channels are recorded and the next available channel is tried.

This is ordered fallback, not guaranteed fan-out to every enabled channel. An in-app notification is created separately even when no external channel is available.

Stored escalation-channel data, when present, is intersected with the user's available channels. If the intersection is empty, the implementation falls back to the user's available preferences rather than dropping the page. Quiet Hours filtering remains in force during fallback, so an intentionally suppressed LOW-urgency channel is not reintroduced by the fallback path.

Service-level Slack/webhook/email/SMS/push/WhatsApp notifications are a separate path selected by service event settings. Avoid configuring duplicate paths until you have observed their combined behavior.

## Quiet Hours

Quiet Hours is a **personal, explicit opt-in** notification policy. It is **off by default for both existing and new users**. OpsKnight never enables it automatically during an upgrade or when an account is created.

Users configure it at **Settings → Profile & Preferences → Notification Preferences → Quiet Hours**. When enabled, they can choose:

- start time;
- end time; and
- whether Saturday and Sunday are quiet all day.

The configured times are evaluated in the user's profile timezone. The initial editable schedule is 18:00–08:00 with all-day weekends, but it has no effect until the user turns Quiet Hours on.

During an active Quiet Hours window:

- **LOW urgency**: Push, SMS, and WhatsApp are suppressed;
- **Email and in-app** notifications remain available; and
- **MEDIUM and HIGH urgency** bypass Quiet Hours and continue paging normally.

Suppression is intentional policy behavior, not a provider failure. OpsKnight does not create a false failed-delivery result merely because a channel was excluded by Quiet Hours. Invalid timezone/window configuration fails open rather than silently suppressing a page.

For incident-response safety, do not use Quiet Hours as a substitute for escalation-policy design, schedule coverage, or urgency mapping. If a responder must always receive a class of alert, classify and route it appropriately instead of relying on a personal LOW-urgency policy.

## Configure email

Choose exactly the provider intended for workspace email and supply:

| Provider   | Required fields                                                          |
| ---------- | ------------------------------------------------------------------------ |
| Resend     | API key and From email.                                                  |
| SendGrid   | API key and From email.                                                  |
| SMTP       | Host, port, username, password, From email, and optional TLS/SSL switch. |
| Amazon SES | Access key ID, secret access key, AWS region, and From email.            |

1. Verify the sender/domain with the provider.
2. Enter secrets in **Notification Providers**, save, and enable the provider.
3. Enable Email for a test user.
4. Trigger a controlled incident targeted to that user.
5. Verify the message, link, sender, delivery record, and incident timeline.

Do not infer delivery from “Saved successfully.” The current provider card does not send a universal email test.

For status-page subscriber mail, also choose the status page's email provider in its Subscribers section and test verification/unsubscribe separately.

## Configure SMS

Choose either Twilio or AWS SNS in the SMS settings. Only the selected, enabled provider is used.

### Twilio

1. Obtain a Twilio Account SID, Auth Token, and sending number.
2. Enter the values under **Twilio (SMS)** and enable it.
3. Add the recipient phone in E.164 format, such as `+14155550100`.
4. Enable the user's SMS preference.
5. Trigger a controlled incident and inspect Twilio and Notification History.

Twilio trial accounts can generally send only to verified recipients. Regional permissions, sender registration, and carrier filtering can reject an otherwise valid request.

OpsKnight requires an explicit international prefix (`+` or `00`) and 7–15 digits. It does not guess a country code from a national number. Store extensions separately; extensions are not valid SMS or WhatsApp destinations.

Twilio SMS and WhatsApp sends register a signed delivery-status callback at `/api/webhooks/notifications/twilio`. Set the public application URL to the externally reachable HTTPS origin so Twilio can call it. Carrier `failed` or `undelivered` receipts update Notification History and make the record eligible for the configured retry workflow.

### AWS SNS

1. Create a least-privilege IAM principal permitted to publish SMS messages.
2. Enter its Access Key ID, Secret Access Key, and the intended AWS region under **SMS Notifications**.
3. Enable SMS, select **AWS SNS**, and save.
4. Add an E.164 recipient phone number and enable the user's SMS preference.
5. Use **Test SMS**, then validate a controlled incident and Notification History.

AWS sandbox status, origination identities, country-specific registration, opt-outs, and account spending limits can all affect delivery. Do not reuse the same IAM credentials as an unrelated Amazon SES provider.

## Configure WhatsApp

WhatsApp uses Twilio's WhatsApp Business capability and is stored with the Twilio provider configuration.

Required:

- approved Twilio Content/Template SID (`whatsappContentSid`) required for message template dispatch;
- recipient phone in E.164 format and enabled WhatsApp preference.

Test within Twilio's template and conversation-window rules. A normal SMS-capable Twilio number is not automatically WhatsApp-enabled.

## Configure web push

### Administrator

1. Open **Web Push (PWA)**.
2. Generate a VAPID key pair or provide a base64url public key, private key, and `mailto:` subject.
3. Save and enable the provider.
4. Serve OpsKnight over HTTPS; localhost is the only insecure-origin exception used by the client.

Key rotation retains previous VAPID keys so existing devices can continue while new registrations use the latest key. Preserve old keys until device migration is complete.

### User/device

1. Open the mobile/PWA notification settings in a browser with service-worker and PushManager support.
2. Allow browser notifications.
3. Select **Enable Push Notifications** to register `/sw.js` and save the browser endpoint to the account.
   Push registration is per browser profile/device. Clearing site data, denying permission, changing origin, or losing the subscription requires registration again. Installing the PWA is recommended for Android reliability but does not replace permission and subscription.

### Dispatch and background actions

- **Parallel Delivery**: When a user has multiple registered devices, OpsKnight dispatches Web Push payloads concurrently across endpoints via `Promise.allSettled`, preventing slow endpoints from delaying alerts to other devices.
- **Urgency and Expiration**: High-urgency incident notifications include RFC 8030 `Urgency: high` headers and shorter TTL windows to ensure mobile push services prioritize fast delivery.
- **Notification Actions**: The service worker (`/custom-sw.js`) handles both the **View** action and in-shade **Acknowledge** action directly from the operating system notification shade without requiring navigation to the full web client.

## Configure Slack and service webhooks

Slack notification connection, interactive actions, and ChatOps war rooms have provider-specific security and routing. See [Slack notifications](../integrations/communication/slack.md), [Slack OAuth](../integrations/communication/slack-oauth-setup.md), and [Slack ChatOps](../integrations/communication/slack-chatops.md).

Service webhooks send lifecycle events independently of user paging. See [Custom webhooks](../integrations/custom/webhooks.md). Status-page webhooks are a third, separately configured webhook system documented in [Status page](../core-concepts/status-page.md).

## User and team readiness

For every on-call user:

- [ ] account status is Active;
- [ ] at least one external channel is enabled and usable;
- [ ] phone number is E.164 when SMS/WhatsApp is enabled;
- [ ] push is registered on the intended device;
- [ ] Quiet Hours is understood and intentionally configured if enabled;
- [ ] Team notification participation is enabled for team-targeted paging;
- [ ] a direct test policy reaches the user;
- [ ] the user can open and acknowledge the incident.

No automatic email fallback is added when a user has disabled every channel. OpsKnight creates the in-app notification and returns an external-delivery failure.

## Notification history

Notification History displays records in pages of 50 with:

- channel and status (`PENDING`, `SENT`, or `FAILED` in current filters);
- incident and message;
- creation, sent, delivered, or failure timing when recorded;
- attempt count, latency/pending duration, and error message;
- search, channel/status/date filters, totals, and manual refresh.

`SENT` means the configured sender accepted the request; it does not prove a human read the message. Twilio SMS/WhatsApp callbacks can advance records to delivered or failed. Providers without a receipt can leave `deliveredAt` empty.

There is no manual Retry button in the history page. Correct the provider or recipient, then use a controlled new notification/incident workflow. Do not repeatedly retrigger a live incident without incident-commander approval.

## Failure response

### No notification record

Check that the incident actually targeted the user/team/schedule, the policy ran, assignment and lifecycle event are correct, and the user was eligible. For LOW urgency, also check whether the user explicitly enabled Quiet Hours and the channel was intentionally suppressed. Review the incident timeline and escalation state.

### `FAILED` email

Check enabled provider, exact credentials, From identity/domain verification, SMTP TLS/port, SES region/permissions, recipient validity, and provider logs.

### `FAILED` SMS or WhatsApp

For Twilio, check credentials, sender capability, trial verification, regional permissions, and provider error text. For AWS SNS, check IAM permissions, region, sandbox/production status, origination requirements, opt-outs, and spending limits. For WhatsApp, also check Twilio templates and conversation-window rules.

### Push does not arrive

Check HTTPS, browser support and permission, service worker `/sw.js`, VAPID public/private pairing, saved subscription, user preference, Quiet Hours for LOW urgency, OS/browser background restrictions, and Test Push.

### Slack or webhook fails

Check the service event selection, workspace/service configuration, secret/signature, URL safety and reachability, provider rate limit, and the provider-specific guide.

### Notifications stop during provider outage

Provider calls use circuit breakers to avoid cascading failure. A circuit-open attempt is recorded as failed without incrementing a normal provider-attempt count. Restore the provider and verify with a fresh controlled test; Notification History does not automatically replay every failed record.

## Security and operations

- Store API keys, auth tokens, SMTP passwords, VAPID private keys, and webhook secrets only in approved secret storage.
- Restrict Notification Provider settings to Admins and audit changes.
- Rotate credentials with an overlap/test plan; avoid changing all channels at once.
- Remove device subscriptions and rotate exposed credentials during offboarding.
- Monitor failure rate and pending age, not only provider health.
- Avoid customer secrets in message fields sent to third parties.

## Related topics

- [Escalation policies](../core-concepts/escalation-policies.md)
- [Users](../core-concepts/users.md)
- [Teams](../core-concepts/teams.md)
- [Services](../core-concepts/services.md)
- [Integration catalog](../integrations/README.md)
