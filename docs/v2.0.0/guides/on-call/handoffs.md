---
title: Verify on-call handoffs
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
