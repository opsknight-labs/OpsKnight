---
title: Inspect notification delivery
description: Trace notification intent, attempts, provider outcomes, and retries.
type: tutorial
product_area: notifications
audience: [administrator, operator, responder]
reader:
  status: READER_COMPLETE
  task: Trace and verify a notification from intent through provider outcome.
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/app/api/notifications/history/route.ts
    - src/lib/notification-provider-feedback.ts
---

# Inspect notification delivery

## Before you begin

Identify the incident, recipient, channel, and approximate delivery time.

Open notification history from the incident or administration view. Follow the
record from recipient resolution through scheduled and attempted delivery to the
latest provider outcome. A sent request is not the same as confirmed delivery.

Before retrying, identify whether the failure is transient, permanent, capacity
related, or caused by an invalid endpoint. Preserve the delivery key and provider
identifier when escalating.

## Trace the operation

1. Open **Settings → Notifications → Operations**.
2. Filter by incident, channel, status, recipient, or provider.
3. Open the operation and record its notification ID and logical event time.
4. Read attempts oldest to newest. Distinguish provider acceptance from a later
   delivery callback, rejection, expiry, or recipient feedback.
5. Compare `next attempt` with retry guidance before taking manual action.

`Deferred` means admission or capacity postponed work without consuming it as a
permanent failure. `Retrying` means a transient attempt failed. `Permanent
failure` requires correcting credentials, configuration, or the endpoint before
retry. A superseded intent is intentionally discarded because a newer incident
state or escalation generation made it stale.

## Retry and verify

Use the supported retry action only after correcting the cause. Do not create a
new incident to force delivery. Confirm the same durable intent receives a new
attempt, reaches the expected terminal outcome, and does not notify an obsolete
recipient or deliver a stale lifecycle event.

For escalation, provide the notification ID, attempt IDs, channel, provider key,
redacted recipient, provider message ID, HTTP/provider result, callback time,
next-attempt time, and worker lane. Never include API tokens or message bodies
containing sensitive incident data.
