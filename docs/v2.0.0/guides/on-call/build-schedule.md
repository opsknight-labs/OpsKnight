---
title: Build an on-call schedule
description: Create a schedule with a rotation layer and responders.
type: how-to
product_area: on-call
audience: [administrator, responder]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/lib/schedules/mutations.ts
    - src/lib/schedules/capabilities.ts
---

# Build an on-call schedule

## Before you begin

Activate the responders and choose the schedule's authoritative time zone.

1. Create the schedule and add an ordered rotation layer.
2. Preview a full rotation and verify current and boundary-time assignments.

![On-call schedules for a professional reliability team](/docs/v2.0.0/assets/on-call-schedules.png)

Create a uniquely named schedule, select its time zone, then add a layer with a
start time, rotation length, optional restrictions, and ordered responders.
Preview at least one full rotation before connecting the schedule to an
escalation policy.

Verify the effective on-call result at the current time and at daylight-saving
boundaries relevant to the schedule. A schedule without an active layer or
eligible responder cannot produce a useful escalation target.
