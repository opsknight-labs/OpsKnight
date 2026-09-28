---
title: Create and resolve your first incident
description: Verify the basic incident response lifecycle in a test service.
type: tutorial
product_area: incidents
audience: [responder, administrator]
verification:
  level: test
  verified_at: 2026-09-27
  evidence:
    - tests/docs/journeys/incident-lifecycle.spec.ts
    - generated/docs-evidence/current/incidents/list.png
    - src/app/(app)/incidents/actions.ts
---

# Create and resolve your first incident

Use a non-production service and responder so the exercise cannot page a real
team.

## Before you begin

Complete the quickstart, sign in, and create an active test responder.

1. Create a team, add an active responder, and make that team responsible for a
   test service.
2. Attach an escalation policy and confirm its first target and delay.
3. Open **Incidents**, select **Create incident**, choose the test service, and
   provide a unique title and operational description.
4. Open the new incident and select **Acknowledge**. Confirm the status and
   timeline record the acknowledgement.
5. In **Assignee**, choose the test responder and select **Assign**. Assignment
   establishes ownership but does not replace acknowledgement.
6. Select **Resolve**, enter a useful resolution summary, and confirm.
7. Verify that the incident is in **Resolved**, active escalation stopped, and
   the timeline retains creation, acknowledgement, assignment, and resolution.

If a step fails, use the focused guides for [creation](../guides/incidents/create),
[acknowledgement](../guides/incidents/acknowledge),
[assignment](../guides/incidents/assign), and
[resolution](../guides/incidents/resolve).

The automated evidence journey certifies listing, detail, and acknowledgement
against an isolated database. Creation, assignment, and resolution remain
source-verified until their runtime journey is added; the metadata deliberately
does not claim broader runtime coverage.
