---
title: Twilio voice, SMS, and WhatsApp
description: Configure and validate Twilio voice calls, SMS, and WhatsApp incident notifications.
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

# Twilio voice, SMS, and WhatsApp

OpsKnight can use one Twilio provider record for SMS and voice, plus independent
WhatsApp enablement and credentials. Each channel still requires an eligible
responder endpoint and routing selection; configuring Twilio alone does not send
incident notifications.

## Before you begin

You need administrator access to **Settings → Notifications**, a Twilio account,
and an HTTPS OpsKnight URL reachable by Twilio for delivery and voice callbacks.
Use E.164 phone numbers. Twilio trial-account recipient restrictions and channel
enablement still apply.

The stored secrets are the account SID and auth token. WhatsApp may reuse those
credentials or use its own account SID and auth token. Configure an SMS-capable
Twilio sender for SMS; a WhatsApp-only number is not a valid SMS sender. Configure
the Twilio WhatsApp sender separately and, when required for outbound templates,
the Twilio Content SID.

## Configure SMS and WhatsApp

1. Open **Settings → Notifications** and configure the Twilio account SID, auth
   token, and SMS sender number.
2. Enable Twilio SMS and run the provider test to an authorized test number.
3. In the WhatsApp section, configure the WhatsApp sender, optional channel-
   specific credentials, and optional Content SID, then enable WhatsApp.
4. Run the WhatsApp provider test. The recipient uses the responder phone number;
   it is normalized to the `whatsapp:+E164` form sent to Twilio.
5. On each responder profile, save the phone number and enable the intended SMS,
   voice, or WhatsApp preferences.
6. Add the corresponding channels to the escalation step, then trigger a
   non-production incident and inspect **Settings → Notifications → Operations**.

Twilio delivery callbacks are sent to
`/api/webhooks/notifications/twilio`. OpsKnight validates the
`X-Twilio-Signature` against a configured Twilio auth token before applying a
delivery update. A callback for an older provider attempt does not overwrite the
current attempt.

WhatsApp messages use a configured Content SID when present; otherwise OpsKnight
sends session text. The implementation limits generated WhatsApp message text to
1,600 characters. Provider and control-plane admission, retry, and terminal
outcomes are described in the [notification delivery reference](../../reference/notifications/).

## Verify SMS and WhatsApp

For each enabled channel, confirm the provider test is delivered, trigger one
synthetic incident, and verify that the operations view contains the expected
channel, Twilio provider, attempt, and terminal outcome. A successful settings
save is not delivery verification.

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

- SMS reports an invalid sender: use an SMS-capable Twilio number rather than a
  WhatsApp-only sender.
- A trial-account send is rejected: verify the recipient in Twilio or use an
  account permitted to contact that recipient.
- WhatsApp is unavailable: confirm its independent enablement, sender number,
  credentials, and responder preference.
- A delivery callback is rejected: confirm the public callback URL and Twilio
  auth token; OpsKnight requires a valid `X-Twilio-Signature`.
- No call created: confirm Twilio and voice are enabled, the escalation step
  includes `VOICE`, and the user has an enabled phone endpoint.
- Callback rejected: verify the public URL, callback signing secret, proxy host
  headers, and that the callback token was not altered.
- Call remains active: inspect Twilio status callbacks and worker health. The
  reconciliation worker closes stale active outcomes rather than leaving them
  indefinitely in flight.
- Duplicate-looking calls: compare notification identity and attempt numbers;
  retries belong to one durable notification intent.

After recovery, repeat the provider test and one synthetic trigger, then confirm
the latest operation reaches a terminal successful state.
