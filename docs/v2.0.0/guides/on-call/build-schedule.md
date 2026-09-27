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

Create a uniquely named schedule, select its time zone, then add a layer with a
start time, rotation length, optional restrictions, and ordered responders.
Preview at least one full rotation before connecting the schedule to an
escalation policy.

Verify the effective on-call result at the current time and at daylight-saving
boundaries relevant to the schedule. A schedule without an active layer or
eligible responder cannot produce a useful escalation target.
