---
title: Create an escalation policy
description: Create an ordered escalation policy with valid targets, channels, delays, retries, and a testable fallback path.
type: how-to
product_area: escalation
audience: [administrator]
reader:
  status: READER_COMPLETE
  task: Create and verify an escalation policy.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/app/(app)/policies/actions.ts, src/components/PolicyStepCreateForm.tsx, src/lib/escalation/policy-validation.ts]
---

# Create an escalation policy

## Before you begin

Only administrators can change policies. Prepare active user/team/schedule targets, usable personal endpoints, intended channel order, delays/retries, and fallback coverage.

## Open the feature

Open **Escalation policies** and select **Create policy**.

## Configure the policy

1. Enter a unique operational name/description.
2. Add the first [policy step](./steps) with target, channel, and timing.
3. Add fallback steps for non-response/provider failure according to policy design.
4. Save and review total timing/order.
5. [Attach the policy to a service](./attach-policy-to-service).

## What OpsKnight does

For an open incident, OpsKnight evaluates the attached policy generation, resolves user/team/schedule targets at execution, and enqueues eligible personal notifications. Invalid targets/endpoints can yield skips/failures; a saved policy is not proof of deliverability.

## Verify it worked

Inspect policy order/targets/timing, attach it to a non-production service, and complete [Test an escalation policy](./test-policy). Confirm notification, acknowledgement, and later-step suppression/advance behavior.

## Change or undo it

Edit only with impact review. Before deleting/replacing, identify every attached service and move it to a valid policy. Retest after target, schedule, channel, timing, or provider changes.

## Troubleshooting

**Target unavailable:** activate/fix the user/team/schedule and endpoint; do not rely on an empty step.

**Timing unexpected:** review per-step delay/retry semantics and total elapsed path.

## Next steps

- [Configure steps](./steps)
- [Test policy](./test-policy)

