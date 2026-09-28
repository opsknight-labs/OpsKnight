---
title: Assign an incident
description: Assign an incident to an eligible responder or team.
type: how-to
product_area: incidents
audience: [responder, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/components/AssigneePicker.tsx
    - src/app/(app)/incidents/actions.ts
---

# Assign an incident

## Before you begin

Open an active incident and confirm the intended user or team is eligible.

1. Select the assignee and apply the change.
2. Verify the incident header and timeline show the new owner.

Open the incident, locate **Assignee**, choose an eligible user or team, and
select **Assign**. Verify that the header and timeline show the new owner.

Assignment establishes responsibility; it does not acknowledge the incident on
the responder's behalf. If a user is missing, check active status, team scope,
and permission policy before changing the incident.
