---
title: Roles, permissions and access requests
description: What each OpsKnight role and team role can do, why someone sees an Access denied page, how to request or grant access (including temporary and emergency access), and how administrators review and explain access.
type: concept
product_area: identity
audience: [administrator, responder, viewer]
reader:
  status: SOURCE_VERIFIED
  task: Understand who can do what in OpsKnight, and get or grant the access someone needs.
keywords:
  [
    roles,
    permissions,
    rbac,
    access denied,
    403,
    request access,
    team owner,
    team admin,
    break glass,
    emergency access,
    custom role,
    access review,
  ]
verification:
  level: source
  verified_at: 2026-11-12
  evidence:
    - src/lib/authorization.ts
    - src/lib/authorization-policy.ts
    - src/lib/access/pages.ts
    - src/lib/access/effective.ts
    - src/lib/access/requests.ts
    - src/lib/access/grants.ts
    - src/lib/access/admin.ts
    - src/lib/teams/administration.ts
    - prisma/migrations/20261112000200_access_control_overhaul/migration.sql
---

# Roles, permissions and access requests

Everyone in OpsKnight has one **role** for the whole organization, and a **team role** in each team
they belong to. Administrators can also give someone a **custom role** (extra permissions) or
**temporary access** that ends on its own.

Every page and action is checked on the server. When something is not allowed you see an
**Access denied** page that says what is needed, who can give it to you, and lets you ask for it.

## Organization roles

|                                                    | User                                                                    | Auditor                | Responder                           | Admin        |
| -------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------- | ----------------------------------- | ------------ |
| See incidents, services, schedules                 | Their teams, plus incidents assigned to or watched by them              | Everything (read-only) | Everything                          | Everything   |
| Acknowledge, add notes, escalate, resolve          | Incidents assigned to them, that page them, or on their teams' services | —                      | Any incident                        | Any incident |
| Create incidents; change urgency, reassign, snooze | —                                                                       | —                      | ✓                                   | ✓            |
| Run and approve runbooks                           | —                                                                       | —                      | ✓                                   | ✓            |
| Write and publish runbooks and automations         | —                                                                       | —                      | Edit automations                    | ✓            |
| Audit log, compliance, privacy, retention          | —                                                                       | Read and export        | —                                   | ✓            |
| Users, teams, settings, integrations, SSO          | Manage teams they own or administer                                     | —                      | Manage teams they own or administer | ✓            |

**My access** (**Settings → My Access**) always shows the exact list for you, in plain language,
together with a comparison of every role.

## Team roles

| Team role  | What it allows                                                                |
| ---------- | ----------------------------------------------------------------------------- |
| **Owner**  | Manage members, settings, services and the team lead, including other owners. |
| **Admin**  | Everything an owner can, except adding, changing or removing owners.          |
| **Member** | Work the team's incidents and see its services and schedules.                 |

Deleting a team is limited to organization Admins. Every team always keeps at least one active owner.

## When you see "Access denied"

The page tells you:

- what you tried to open and what it needs (for example "Requires Auditor or Admin");
- your role and teams;
- who can give you access: the owners and admins of the team that owns the item, or your
  organization's administrators;
- a **Request access** form.

For a specific incident, service or team outside your teams, OpsKnight shows only which team owns
it, never its contents.

## Request access

From the Access denied page or **Settings → My Access**, ask for a different role or to join a team.
Choose how long you need it (1 hour to 7 days, or permanently) and say why.

- Team requests go to that team's owners and admins; role requests go to administrators.
- Approvers review requests in **Settings → Access Requests**. They can change the duration,
  approve or decline, and add a note. You get a notification with a link back to where you were.
- You cannot approve your own request unless an administrator has allowed it in the access policy.
- Granting the Admin role requires the approver to have signed in within the last 15 minutes.
- If your role comes from your identity provider, change it there instead (the form says so).

Temporary access ends automatically. A banner shows while you have it, and you can end it early.

## Emergency access (break-glass)

If an incident can't wait for an approver, anyone can give themselves Responder access for a short
time (15 minutes to the organization's limit), for one incident or in general. It requires a reason
and a recent sign-in, is limited to three times a day, alerts every administrator immediately, and
everything done with it is in the audit log. Administrators can turn it off.

## For administrators

**Settings → Access Management** brings everything together:

- **Access checker** — choose a person and a page, permission, or incident action to see whether
  it is allowed and exactly why (role, teams, temporary access, relationship to the incident).
- **Who has access** — everyone holding a permission through their role, a custom role, or
  temporary access.
- **Temporary and emergency access** — see and end active grants.
- **Access reviews** — certify that everyone with Admin, Responder, Auditor, a custom role, or
  long temporary access still needs it. Completing a review removes what you marked, and the
  evidence can be downloaded for SOC 2 (CC6.2/CC6.3) or ISO 27001 (A.5.18) audits. Reviews can
  start automatically every month, quarter, half-year or year.
- **Custom roles** — add specific permissions to specific people without promoting them, for
  example letting an Auditor run runbooks. Organization administration can only be given with the
  Admin role.
- **Most denied** — the pages and actions people were blocked from most in the last 7 days, a
  quick way to spot someone who needs a team or role.
- **Access policy** — turn incident work for Users, access requests, and emergency access on or
  off, set the emergency access limit, and decide whether people may approve their own access
  requests (only useful with a single administrator). Access reviews never let anyone certify
  their own access.

Changes to roles, custom roles and the access policy require a recent sign-in. Every grant,
request, decision, denial and review is recorded in the audit log.
