---
title: Create an on-call schedule
description: Create a timezone-aware schedule, add initial coverage, and verify the current and next responder.
type: how-to
product_area: on-call
audience: [administrator, responder]
reader:
  status: READER_COMPLETE
  task: Create and verify an on-call schedule.
  evidence: [docs/v2.0.0/assets/on-call-schedules.png, docs/v2.0.0/assets/on-call-schedule-detail.png]
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - src/app/(app)/schedules/actions.ts
    - src/app/(app)/schedules/[id]/page.tsx
---

# Create an on-call schedule

![On-call schedule directory with multiple production rotations](/docs/v2.0.0/assets/on-call-schedules.png)

## Before you begin

Activate intended responders and choose the authoritative IANA time zone, coverage window, handoff time, and responder order. The schedule time zone controls local entry and daylight-saving behavior.

## Open the feature

Open **Schedules** and expand **Create Schedule**.

## Configure the schedule

![Schedule detail with rotation coverage and responder ownership](/docs/v2.0.0/assets/on-call-schedule-detail.png)

1. Enter a unique operational name such as `Payments Primary`.
2. Select the schedule time zone.
3. Create the schedule and open it from the directory.
4. Add the first [rotation layer](./rotations) and active responders.
5. Save the layer.

## What OpsKnight does

A schedule resolves effective on-call ownership from active rotation layers and temporary overrides. A newly created schedule has no coverage until an active layer contains eligible responders.

## Verify it worked

Inspect the schedule at the current time, immediately before/after a handoff, and during required coverage hours. Confirm the expected current/next responder and no unintended gap. Then [test on-call routing](./test-on-call).

## Change or undo it

Use an override for a bounded exception; change a layer only when recurring rotation is wrong. Before deleting or replacing a schedule, detach or update escalation policies and verify services retain a valid route.

## Troubleshooting

**No one is on call:** add/activate a layer and eligible responders; inspect restrictions and time zone.

**Handoff occurs at wrong local time:** verify IANA time zone, layer start, interval, and DST transition preview.

## Next steps

- [Configure rotations](./rotations)
- [Configure escalation policy](../escalation/create-policy)
