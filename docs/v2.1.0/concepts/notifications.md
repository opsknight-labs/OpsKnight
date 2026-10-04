---
title: Notifications
description: Notification intent, routing, delivery, and provider feedback.
type: concept
product_area: notifications
audience: [administrator, responder, operator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/notification-control-plane.ts, src/lib/notification-delivery.ts]
---

# Notifications

Notification intent is distinct from provider delivery. Routing selects an
eligible endpoint; delivery records provider attempts, outcomes, retry state,
and feedback without rewriting the incident lifecycle.

The control plane stores one logical intent and provider-specific attempts.
Stable identity makes retries safe, while provider admission protects shared
capacity. Retryable, permanent, deferred, and successful outcomes have different
operator actions; a queued intent is not proof that a human received it.

Endpoint verification, user preferences, service routing, provider configuration,
and incident urgency all participate in eligibility. Provider callbacks update
delivery evidence but cannot move the incident lifecycle. See the
[delivery reference](../reference/notifications/) and [inspection guide](../guides/notifications/inspect-delivery).
