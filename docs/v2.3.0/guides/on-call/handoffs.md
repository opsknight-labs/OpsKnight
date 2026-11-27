---
title: Verify on-call handoffs
order: 5
description: Validate responder transitions, time-zone behavior, gaps, overlaps, and operational handoff readiness.
type: how-to
product_area: on-call
audience: [administrator, responder]
reader:
  status: READER_COMPLETE
  task: Verify an on-call handoff and correct gaps or wrong ownership.
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - src/lib/schedules/
    - src/app/(app)/schedules/[id]/page.tsx
---

# Verify on-call handoffs

## Before you begin

Know the schedule time zone, next handoff time, outgoing/incoming responders, active overrides, and required coverage.

## Open the feature

Open **Schedules → select schedule** and inspect the effective on-call preview around the handoff.

## Configure the handoff

1. Verify the incoming responder is active and has usable notification destinations.
2. Inspect current, immediately-before, and immediately-after timestamps.
3. Review overrides/restrictions and the next several rotations.
4. Coordinate operational context outside the schedule state as required by team practice.

## What OpsKnight does

Schedule computation changes effective ownership at the configured boundary; it does not confirm the incoming human read a handoff message or that their provider endpoint works.

Within 60 minutes before a shift starts, the incoming responder (when not already on call on that schedule) gets an **Upcoming On-Call Shift** reminder. A responder gets at most one reminder per schedule in any 45 minutes. Only an earlier reminder suppresses the next one: other schedule notices, such as an override being set or being added to a layer, do not.

The **on call until** time shown on mobile, in the dashboard on-call widget and in reminder emails is the real handoff: where the rotation or the next override takes over, even when that is days away (a weekly rotation with five days left shows the end of those five days). OpsKnight looks up to a year ahead to find it.

Taking a responder out of a layer, or deactivating a user who is in one, moves later handoffs to other people because the layer picks responders by position. The console previews that for the next 4 weeks before it asks you to confirm; see [Build a schedule](./build-schedule).

## Verify it worked

At/after the boundary, confirm current on-call is the expected responder and run a controlled [on-call test](./test-on-call). Check timeline/delivery evidence rather than only preview.

## Change or undo it

Use a bounded override to correct an immediate handoff without rewriting recurring rotation. Remove/expire the override after the coverage exception ends and verify ownership returns to the layer.

## Troubleshooting

**Preview differs from expectation:** inspect time zone, DST, layer start/interval/order, restrictions, and overlapping overrides.

**Correct responder but no delivery:** diagnose notification preferences/provider/delivery history separately.

## Next steps

- [Add an override](./overrides)
- [Test on-call](./test-on-call)
