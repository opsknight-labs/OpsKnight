---
title: Notifications are not delivered
description: Trace recipient eligibility, endpoint state, worker attempts, and provider feedback.
type: troubleshooting
reader:
  status: READER_COMPLETE
  task: Diagnose, recover, and verify not delivered.
product_area: notifications
audience: [operator, administrator]
keywords: [notification failed, notification not delivered, missing page, provider failure, delivery troubleshooting]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/user-notifications.ts, src/lib/notification-provider-feedback.ts]
---

# Notifications are not delivered

Confirm that the event is enabled for the service, the escalation target resolves,
the recipient and channel are eligible, and the endpoint is healthy. Then inspect
the notification intent, worker claim, attempt history, provider response, and
feedback status. Check quiet hours, opt-out, capacity limits, and retry schedule.
Retry only transient failures; repair or replace invalid endpoints first.

## Trace one durable notification

1. In **Settings → Notifications → Operations**, filter by incident, recipient,
   channel, and the event time.
2. If no intent exists, verify service routing, escalation target resolution,
   event type, user preferences, and endpoint eligibility.
3. If an intent is deferred, inspect quiet hours and provider admission capacity.
4. If attempts are retrying, inspect the provider code and next-attempt time.
5. If permanently failed, repair credentials or the recipient endpoint before retrying.

Use this decision table for one notification ID:

| Last durable state | Interpretation | Next action |
| --- | --- | --- |
| no intent | routing or eligibility rejected it before enqueue | inspect service event settings, escalation target, preferences |
| pending with no claim | notification worker/lane is unavailable | follow worker runbook |
| deferred | quiet hours, policy delay, or provider capacity admission | verify scheduled next-attempt time |
| retrying | transient provider/network response | inspect status code and backoff; do not create another intent |
| permanent failure | invalid endpoint, credentials, template, or provider rejection | repair endpoint/configuration, then use supported retry |
| provider accepted, user did not receive | downstream provider/device/destination issue | use provider message ID and feedback receipt |

Channel-specific checks:

- **Email:** validate the recipient address, SMTP/API credentials, sender domain,
  suppression/bounce feedback, and provider message ID.
- **SMS and voice:** validate E.164 format, country permissions, sender/caller
  configuration, and Twilio status callbacks. An accepted API request is not a
  completed call.
- **Push:** validate that the device endpoint remains registered and inspect
  invalid-token feedback before retrying.
- **Slack/Teams:** confirm the service destination still exists, the app remains
  installed, and the bot can post there. Test each configured destination.

Never test a production escalation by repeatedly triggering a live incident.
Use a non-production service and a consenting test recipient.

For voice, verify an enabled international-format phone endpoint and inspect both
Twilio gather and status callbacks. For Slack or Teams, verify every service
destination independently; one invalid channel must not be confused with the
three-destination service configuration.

Recovery is complete when the original intent reaches a terminal successful
state or a corrected retry succeeds without creating a duplicate intent. Record
notification ID, attempt IDs, provider message ID, redacted destination, status
codes, retry time, and worker lane for escalation.
