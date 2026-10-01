---
title: Configure notification routing
description: Enable channels and route incident events to eligible endpoints.
type: tutorial
product_area: notifications
audience: [administrator, responder]
reader:
  status: READER_COMPLETE
  task: Configure and validate an end-to-end notification route.
  evidence: [docs/v2.0.0/assets/notification-settings.png]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/service-notification-settings.ts
    - src/lib/user-notification-endpoints.ts
---

# Configure notification routing

![Notification provider configuration and delivery controls](/docs/v2.0.0/assets/notification-settings.png)

Enable the intended service events and channels, then confirm each recipient has
an enabled, healthy endpoint for those channels. Test with a synthetic incident
and inspect notification history rather than assuming a successful save means a
provider delivery occurred.

Quiet hours, opt-out state, endpoint health, provider capacity, retry policy, and
event-specific service settings can all affect delivery eligibility.

## Before you begin

You need administrator access to provider settings and permission to edit the
service and escalation policy. Configure and test the provider first. Responders
must have healthy personal endpoints for email, SMS, voice, push, or WhatsApp;
Slack and Teams instead use service destinations, with up to three linked
channels for each provider per service.

## Configure the route

1. Open **Services**, select the service, and open **Notifications**.
2. Select the lifecycle events that should notify: trigger, acknowledgement,
   escalation, or resolution as offered by that channel.
3. Enable the required channels. Avoid enabling a channel simply because a
   provider exists; the escalation target must also resolve to an eligible endpoint.
4. For Slack or Teams, link and test each destination. All linked destinations
   receive the lifecycle message—they are not ordered fallbacks.
5. Open the escalation policy and confirm each step uses the intended personal
   channels and target users/schedules.
6. Save, then reload the service to confirm the persisted selection.

## Validate with a synthetic incident

Trigger a non-production incident against this service. Confirm the expected
recipients and service destinations, acknowledge it, and resolve it. In
**Settings → Notifications → Operations**, verify one durable intent per logical
recipient/channel/event and inspect every attempt. For voice, only the triggered
event creates a call; use the call input to validate acknowledgement.

If no intent exists, inspect event selection, escalation resolution, preferences,
and endpoint health. If an intent is deferred, inspect quiet hours and provider
capacity. If it failed, follow [Notifications are not delivered](../../troubleshooting/notifications/not-delivered).
