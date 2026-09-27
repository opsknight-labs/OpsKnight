---
title: Teams
description: Operational ownership and membership boundaries.
type: concept
product_area: teams
audience: [administrator, responder]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [prisma/schema.prisma, src/app/(app)/teams/]
---

# Teams

Teams express operational ownership and group users for routing and access.
Membership does not replace explicit permission checks or tenant isolation.

Team membership has a team-local role and can establish service ownership,
schedule participation, and eligible routing targets. Application roles and
capabilities remain separate: being on a team does not automatically grant
global administration.

Removal requires checking services, schedules, open incidents, and leadership
references so operational ownership does not become orphaned. Prefer transfer
and deactivation workflows over deleting an active responder during an event.
