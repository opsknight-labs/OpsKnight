---
title: Notification rate limits and admission reference
description: Understand provider throttling, concurrency admission, retry hints, deferred delivery, and safe capacity response.
type: reference
product_area: notifications
audience: [operator, administrator]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/lib/notification-delivery.ts, src/lib/notification-control-plane.ts]
---

# Notification rate limits and admission reference

Provider concurrency/admission can defer delivery without consuming it as a permanent failure. Explicit rate-limit results, `429`, or provider retry hints schedule a later attempt; absent an explicit hint, the control-plane fallback deferral is 60 seconds.

Monitor per-provider attempts/outcomes, deferred count, oldest age, concurrency, retry volume, and worker health. Do not repeatedly run tests or manual sends during throttling. Provider capacity, queue capacity, database capacity, and policy timing are different bottlenecks.

A raised concurrency setting cannot exceed provider account limits safely and can amplify throttling. Change only after measuring throughput/oldest age and retaining critical-notification capacity.

