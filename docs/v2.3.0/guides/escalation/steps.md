---
title: Configure escalation policy steps
order: 4
description: Select escalation targets and channels, order fallbacks, and verify runtime target resolution.
type: how-to
product_area: escalation
audience: [administrator]
reader:
  status: READER_COMPLETE
  task: Configure and verify escalation policy steps.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/components/PolicyStepCreateForm.tsx, src/lib/escalation/target-resolution.ts, src/lib/escalation/policy-validation.ts]
---

# Configure escalation policy steps

## Before you begin

Prepare active targets and usable channel endpoints. A schedule needs effective coverage at incident time; a team needs eligible members/lead according to target mode.

## Open the feature

Open **Escalation policies → select policy → Steps**.

## Configure a step

1. Add or select a step position.
2. Choose target type and exact user/team/schedule.
3. Choose notification channel(s) supported by intended responders.
4. Configure delay/retries according to [timing](./retries-delays).
5. Save and add later fallback steps.

## What OpsKnight does

OpsKnight resolves targets at execution, filters ineligible recipients/endpoints, and creates delivery work with the policy/incident generation. Changes affect later execution according to current state; they do not recall already emitted pages.

## Verify it worked

Review every target and total path, then run a controlled test at a time the schedule/team resolution is known. Confirm actual recipient/channel matches.

## Remove or change a step

Preserve at least one viable route and review service impact before reordering/deleting. Retest the complete fallback chain after changes.

Incidents that are already escalating keep their place. Deleting a step, reordering steps in the console, or sending the API a step list that only removes or reorders existing steps moves each open incident so it still pages the next tier it was waiting for, without skipping a tier or repeating one. If you move a tier that has not paged yet above one that already has, the incident pages the moved tier next and the earlier tier pages again, because skipping a responder is the worse failure (paging someone twice is the safe direction for incident response). Before the console deletes, moves or reorders a step it tells you how many open incidents are mid-escalation on the policy and asks you to confirm; with none, it does not ask. Replacing steps through the API with edited or new steps does not move open incidents; they continue from their current position in the new list.

## Troubleshooting

**Step saves but no recipient:** inspect active user/team membership/schedule coverage and personal channel eligibility.

**Wrong member paged:** inspect execution timestamp and runtime team/schedule target resolution.

## Next steps

- [Configure retries and delays](./retries-delays)
- [Test policy](./test-policy)

