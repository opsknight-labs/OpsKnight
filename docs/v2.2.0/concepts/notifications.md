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

## Bundled and rolled-up pages

Each user can turn on **Bundle low-urgency pages** (off by default) from the
noise card on the Insights page or the mobile Intelligence screen. With it on,
a page is bundled only when the incident is low urgency and not `P1` or `P2`.
The first such page on a channel arrives at once; further ones on that channel
within five minutes are held and arrive together as one notification marked
"Bundled low-urgency pages". Bundled pages are sent at normal responder
priority instead of responder-critical. High-urgency pages are never bundled.

When noise control groups an incident under a storm parent before paging, that
child has no escalation of its own. Its service notifications (Slack, Teams,
webhooks and other service channels) roll up under the parent incident instead
of posting separately.

Each page sent by an escalation step stores that step's index, which feeds the
per-step outcome analytics on escalation policies.
