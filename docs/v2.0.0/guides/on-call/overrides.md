---
title: Add an on-call override
description: Temporarily replace scheduled coverage without rewriting the rotation.
type: how-to
product_area: on-call
audience: [administrator, responder]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/schedules/capabilities.ts
    - prisma/schema.prisma
---

# Add an on-call override

Open the schedule, create an override with replacement responder, start, and end
times, and verify the resulting coverage preview. Use an override for a bounded
exception; edit the layer only when the recurring rotation itself is wrong.

Avoid overlapping overrides for the same responder and interval. Record times in
the schedule's displayed time zone and verify their stored UTC boundaries.

