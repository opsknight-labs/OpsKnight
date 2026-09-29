---
title: Notification delivery states reference
description: Interpret logical intent, scheduled and attempted delivery, retryable or permanent failure, deferral, success, feedback, and supersession.
type: reference
product_area: notifications
audience: [operator, administrator, responder]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/lib/notification-delivery.ts, src/lib/notification-control-plane.ts, src/lib/notification-identity.ts]
---

# Notification delivery states reference

- **Intent:** durable logical event/recipient/channel identity exists; no provider receipt is implied.
- **Scheduled/queued:** work is eligible for later processing.
- **Deferred:** provider admission/capacity/rate limiting postponed the attempt.
- **Attempted/sent request:** OpsKnight called the provider; human receipt is not implied.
- **Retryable failure:** a bounded later attempt can still be valid.
- **Permanent failure:** configuration, credential, endpoint, or non-retryable provider outcome requires correction.
- **Successful/accepted:** provider accepted according to its API; final handset/inbox/device delivery may need feedback.
- **Feedback outcome:** provider callback/status supplies later delivery evidence.
- **Superseded/discarded:** current incident state or escalation generation made stale delivery inappropriate.

Always interpret state with incident generation, recipient endpoint, attempt count, provider ID, and current incident lifecycle. See [Inspect notification delivery](../../guides/notifications/inspect-delivery).

