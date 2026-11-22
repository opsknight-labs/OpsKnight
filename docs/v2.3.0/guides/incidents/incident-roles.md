---
title: Incident roles
order: 6
description: Give an incident a commander, ops lead, comms lead and scribe, and understand what each role may do.
type: how-to
product_area: incidents
audience: [responder, administrator]
verification:
  level: source
  verified_at: 2026-11-22
  evidence:
    - src/lib/incidents/roles.ts
    - src/lib/incidents/roles-command.ts
    - src/lib/incidents/role-authorization.ts
    - src/components/incident/detail/IncidentRoles.tsx
    - src/lib/chatops/slash-commands.ts
    - src/app/api/v2/incidents/[id]/roles/[roleKey]/route.ts
---

# Incident roles

Roles say who is doing what during a response. Each incident has four roles, and each role has
at most one holder. One person may hold several roles.

| Role                    | What they do                                      | Rights on the incident                                                                    |
| ----------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Incident commander**  | Owns the response, makes the calls, ends it       | Operate it like the assignee: acknowledge, note, escalate, resolve. Also hands out roles. |
| **Operations lead**     | Leads the technical investigation and the fix     | Operate it like the assignee                                                              |
| **Communications lead** | Keeps stakeholders and the status page up to date | Read it and add notes                                                                     |
| **Scribe**              | Records decisions and key events on the timeline  | Read it and add notes                                                                     |

The commander and ops lead keep these rights on **private** incidents, where team membership
alone is not enough. Roles never grant a permission the person's account role lacks: an Auditor
who is made commander still cannot acknowledge.

Assignment and roles are separate. The assignee is who the incident is routed to; the commander
is who runs the response. They are often the same person.

## Who can change roles

- **Responders and Admins** can set or clear any role.
- **Anyone who can work the incident** (assignee, on call for it, a member of the owning team, or
  the ops lead) can take a role themselves.
- **The commander** can hand any role to someone else.
- **A holder** can always step down from their own role.

## Assign a role in the web app

1. Open the incident. The roles strip sits under the title.
2. Select a role. Empty roles show **Assign**.
3. Choose **Take command** (or **Assign to me**), pick a teammate, or choose **Step down** /
   **Clear role**.

On a phone the strip shows two roles per row. **Take command** is also in the command bar on
desktop and in the **More** sheet on mobile while nobody else is commander.

When a role is set, OpsKnight:

- adds a **Role assigned** entry to the timeline and an audit record;
- makes the holder a **follower** if they were not watching, so they get the incident's updates;
- posts to the war room, invites the holder, and shows the commander in the Slack channel topic.

## Slack and Microsoft Teams

In a war-room channel:

```text
/incident role commander me
/incident role ops-lead @priya
/incident role scribe clear
/incident roles
```

`/incident who` lists the roles above the on-call steps. Role names accept `commander` (or `ic`),
`ops-lead`, `comms-lead` and `scribe`. A mentioned person must have a Slack email that matches an
active OpsKnight account.

Incident cards in Slack and Teams show the role holders and offer **Take command** until someone
is commander. In Teams, **Current responders** lists the roles too.

## Default roles on templates

An incident template can name a default holder for each role (**Incidents → Templates → New
template → Default Roles**). The roles are applied when an incident is declared from the template
in the web app or the mobile app. A default holder whose account is no longer active is skipped.

## API and MCP

| Operation                           | REST v2                                         | MCP tool               |
| ----------------------------------- | ----------------------------------------------- | ---------------------- |
| List roles and holders              | `GET /api/v2/incidents/{id}/roles`              | `incident_roles_list`  |
| Assign a role (`{ "userId": "…" }`) | `PUT /api/v2/incidents/{id}/roles/{roleKey}`    | `incident_role_assign` |
| Clear a role                        | `DELETE /api/v2/incidents/{id}/roles/{roleKey}` | discoverable operation |

`roleKey` is one of `COMMANDER`, `OPS_LEAD`, `COMMS_LEAD`, `SCRIBE`. Writes need an
`Idempotency-Key` and the `incidents:write` scope, and follow the same rules as the web app.
Templates accept `defaultRoles`, for example `{ "COMMANDER": "usr_123" }`.
