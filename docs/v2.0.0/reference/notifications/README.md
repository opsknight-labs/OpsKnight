---
title: Notification delivery reference
description: Durable notification identity, provider admission, retries, and terminal outcomes.
type: reference
product_area: notifications
audience: [operator, administrator, developer]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/notification-delivery.ts
    - src/lib/notification-control-plane.ts
    - src/lib/notification-identity.ts
---

# Notification delivery reference

The notification control plane creates durable, stable intents before provider
delivery. Lifecycle generation and event time are part of identity so retries
do not turn one logical incident event into multiple notifications.

Delivery outcomes are successful, retryable failure, permanent failure, or
deferred provider admission. Provider concurrency and rate limits can defer a
delivery without consuming it as a permanent failure. A `429`, an explicit
rate-limit result, or a provider retry hint schedules a later attempt; otherwise
the fallback deferral is 60 seconds.

Before a retry, OpsKnight checks whether the incident state or escalation
generation superseded the intent. Superseded work is discarded rather than
delivering stale acknowledgements, resolutions, or escalation messages.

Use **Settings → Notifications** for provider configuration and the operations
view for delivery outcomes. See [inspect notification delivery](../../guides/notifications/inspect-delivery)
for the operator workflow.
