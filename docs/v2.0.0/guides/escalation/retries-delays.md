---
title: Configure escalation retries and delays
description: Set and validate escalation timing without creating alert storms, dead time, or impossible response objectives.
type: how-to
product_area: escalation
audience: [administrator]
reader:
  status: READER_COMPLETE
  task: Configure and validate escalation step retries and delays.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/lib/escalation/planner.ts, src/lib/escalation/policy-validation.ts, src/lib/escalation/worker.ts]
---

# Configure escalation retries and delays

## Before you begin

Know incident response objective, provider delivery characteristics, responder expectations, and total acceptable time before each fallback.

## Open the feature

Open **Escalation policies → select policy → Steps**, then edit the intended step timing.

## Configure timing

1. Set the wait/delay before advancement according to product fields.
2. Configure bounded retry behavior only where it improves delivery without duplicate storm risk.
3. Calculate cumulative elapsed time through all preceding steps/retries.
4. Save and review the full timeline.

## What OpsKnight does

The escalation planner schedules eligible work for the current incident/policy generation. Acknowledgement or terminal state changes suppress/complete later work according to lifecycle rules. Provider retry and policy advancement are distinct concerns.

## Verify it worked

Run a controlled test with timestamps. Confirm first delivery, retry/advance time, acknowledgement stopping behavior, and no unexpected duplicate provider messages.

## Change or undo timing

Restore the prior reviewed timing values and retest. Already emitted notifications cannot be recalled; communicate accidental pages.

## Troubleshooting

**Next step is late:** inspect scheduler/queue oldest age, configured cumulative delays, provider retries, and incident acknowledgement state.

**Duplicate storm:** stop the test through correct incident lifecycle, inspect retry versus policy scheduling, and reduce unsafe repeated paths.

## Next steps

- [Attach policy to service](./attach-policy-to-service)
- [Test policy](./test-policy)

