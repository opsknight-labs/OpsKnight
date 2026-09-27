---
title: Inspect notification delivery
description: Trace notification intent, attempts, provider outcomes, and retries.
type: how-to
product_area: notifications
audience: [administrator, operator, responder]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/app/api/notifications/history/route.ts
    - src/lib/notification-provider-feedback.ts
---

# Inspect notification delivery

Open notification history from the incident or administration view. Follow the
record from recipient resolution through scheduled and attempted delivery to the
latest provider outcome. A sent request is not the same as confirmed delivery.

Before retrying, identify whether the failure is transient, permanent, capacity
related, or caused by an invalid endpoint. Preserve the delivery key and provider
identifier when escalating.
