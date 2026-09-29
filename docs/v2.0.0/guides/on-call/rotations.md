---
title: Configure on-call rotations
description: Add responders, handoff intervals, coverage restrictions, and layer precedence to an on-call schedule.
type: how-to
product_area: on-call
audience: [administrator, responder]
reader:
  status: READER_COMPLETE
  task: Configure and verify an on-call rotation layer.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/app/(app)/schedules/actions.ts, src/components/schedules/LayerTimingFields.tsx, src/lib/schedules/]
---

# Configure on-call rotations

## Before you begin

Create the schedule and define responder order, handoff interval, first handoff, time zone, and required daily/weekly coverage.

## Open the feature

Open **Schedules → select schedule → Layers/rotation controls**.

## Configure a rotation

1. Add a layer with a descriptive name.
2. Add active responders in intended order.
3. Set the rotation start and handoff interval.
4. Configure any supported coverage restrictions deliberately.
5. Save and inspect the effective preview.
6. Add another layer only for a distinct coverage purpose; document overlap/precedence.

## What OpsKnight does

OpsKnight computes effective ownership at a timestamp from active layers, responder order, handoff interval, restrictions, time zone, and overrides. Layer membership is recurring; overrides are temporary.

## Verify it worked

Check representative timestamps across several handoffs, coverage boundaries, weekends, and a DST transition. Confirm current and next responder and ensure no accidental overlap/gap.

## Change or undo it

Use [overrides](./overrides) for temporary swaps. For a recurring change, update the layer and verify past/current/future preview before relying on it. Remove a layer only when another layer/policy preserves coverage.

## Troubleshooting

**Same responder remains on call:** inspect responder count/order, interval, layer start, and eligible active accounts.

**Layers overlap unexpectedly:** review restrictions and precedence; simplify rather than relying on ambiguous overlap.

## Next steps

- [Verify handoffs](./handoffs)
- [Test on-call routing](./test-on-call)

