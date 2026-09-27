---
title: Notifications are not delivered
description: Trace recipient eligibility, endpoint state, worker attempts, and provider feedback.
type: troubleshooting
product_area: notifications
audience: [operator, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/user-notifications.ts, src/lib/notification-provider-feedback.ts]
---

# Notifications are not delivered

Confirm that the event is enabled for the service, the escalation target resolves,
the recipient and channel are eligible, and the endpoint is healthy. Then inspect
the notification intent, worker claim, attempt history, provider response, and
feedback status. Check quiet hours, opt-out, capacity limits, and retry schedule.
Retry only transient failures; repair or replace invalid endpoints first.

