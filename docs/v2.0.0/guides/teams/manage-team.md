---
title: Create and manage a team
description: Create a team, manage members and service ownership, offboard responders, and delete safely.
type: how-to
product_area: teams
audience: [administrator, responder]
reader:
  status: READER_COMPLETE
  task: Create, configure, verify, and safely remove an OpsKnight team.
  evidence: [docs/v2.0.0/assets/teams.png]
verification:
  level: source
  verified_at: 2026-10-02
  evidence:
    - src/app/(app)/teams/page.tsx
    - src/app/(app)/teams/[id]/page.tsx
    - src/app/(app)/teams/[id]/EditTeamForm.tsx
    - src/app/(app)/teams/[id]/DeleteTeamCard.tsx
---

# Create and manage a team

![Teams with member and service ownership context](/docs/v2.0.0/assets/teams.png)

## Before you begin

Identify the team owner/lead, responders, services, on-call participation, and
whether SCIM or OpsKnight owns membership.

## Open the feature

Open **Teams**, select a team, or choose the create action.

## Configure the team

1. Enter a unique team name and operational description.
2. Add intended members and confirm each user is active.
3. Set supported team leadership/ownership fields.
4. Assign services and verify the team can read and operate them.
5. Confirm members appear in on-call, notification, and collaboration selectors
   where their roles permit it.
6. Save and reload the team detail.

## How membership works

Team membership scopes service access and ownership but does not itself grant an
administrator or responder system role. When SCIM Groups own membership, change
the provider assignment and let provisioning reconcile it.

## Verify the team

Sign in as a representative member and confirm intended services are visible,
unowned services remain inaccessible, and notification/on-call participation is
correct.

## Remove members or delete the team

Before offboarding a member, transfer active incident assignments, schedules,
action items, and ownership. Before deleting a team, reassign services,
incidents, escalation targets, dashboards, and integrations. SCIM group DELETE
can also delete the mapped team; review that policy first.

## Troubleshooting

- **Member cannot see a service:** verify both team assignment and system role.
- **Member returns after removal:** SCIM is likely authoritative.
- **Delete is unsafe or blocked:** inventory and reassign dependent objects.
- **On-call is wrong:** membership alone does not place a user in a rotation.

## Next steps

- [Manage services](../services/manage-service)
- [Manage users](../administration/manage-users)
- [Configure SCIM](../identity/configure-scim)
