---
title: Configure notification routing
description: Enable channels and route incident events to eligible endpoints.
type: how-to
product_area: notifications
audience: [administrator, responder]
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
