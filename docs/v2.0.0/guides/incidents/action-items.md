---
title: Track incident action items
description: Create, assign, complete, and review follow-up work from incidents and postmortems.
type: how-to
product_area: incidents
audience: [responder, administrator]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [src/app/(app)/action-items, src/lib/action-items.ts]
---

# Track incident action items

## Before you begin

Identify the incident or postmortem, the accountable owner, and the measurable
outcome of the follow-up work.

1. Open **Action items** or the parent incident/postmortem.
2. Create the item with an owner, outcome, and due date where appropriate.
3. Update its status as work progresses.
4. Close it only after verifying the stated outcome.

Use action items for owned follow-up work, not live incident commands. Record a
clear outcome, assign an owner, set a due date when appropriate, and link the
item to its incident or postmortem. Update status when work begins and when the
outcome is verified.

Review overdue and unassigned items regularly. Deleting or closing an incident
does not make remediation unnecessary; confirm retention and linkage behavior
before changing parent records. Jira-connected installations should also verify
sync status and resolve conflicts in the Jira troubleshooting guide.
