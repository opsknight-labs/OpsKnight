---
title: Voice paging
description: Configure and validate Twilio voice calls for urgent incident notification.
type: integration
product_area: notifications
audience: [administrator, operator, responder]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/voice/twilio.ts
    - src/app/api/webhooks/notifications/twilio/voice/status/route.ts
---

# Voice paging

Voice paging uses the configured Twilio provider to call a responder for a
triggered incident. Voice is an urgent notification channel: acknowledgement
input is collected during the call, while later acknowledgement and resolution
events are not sent as new voice calls.

## Configure the provider

In **Settings → Notifications**, configure Twilio credentials, the outbound
number, and voice delivery. Set `VOICE_CALLBACK_SIGNING_SECRET` to an independent
random value of at least 32 characters; when it is absent, the callback token
code falls back to a sufficiently long `NEXTAUTH_SECRET`. The externally visible
application URL must allow Twilio to reach the voice gather and status callback
routes over HTTPS.

In the responder profile, save a phone number in international format and enable
voice notifications. Enable `VOICE` in the relevant escalation step. A service
notification selection alone does not supply a responder phone number.

## Validate safely

Use a non-production service and an authorized test number. Trigger one incident,
confirm the call identifies the service and incident, and exercise the documented
acknowledgement input. Then inspect **Settings → Notifications → Operations** for
provider admission, attempts, callback outcome, and terminal state.

## Troubleshoot

- No call created: confirm Twilio and voice are enabled, the escalation step
  includes `VOICE`, and the user has an enabled phone endpoint.
- Callback rejected: verify the public URL, callback signing secret, proxy host
  headers, and that the callback token was not altered.
- Call remains active: inspect Twilio status callbacks and worker health. The
  reconciliation worker closes stale active outcomes rather than leaving them
  indefinitely in flight.
- Duplicate-looking calls: compare notification identity and attempt numbers;
  retries belong to one durable notification intent.
