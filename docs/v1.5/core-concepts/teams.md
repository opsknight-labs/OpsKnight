---
title: Teams
description: Organize responders, service ownership, team paging, roles, and notification participation.
order: 4
---

# Teams

Teams group users for service ownership, filtering, assignment, and escalation. A team has members with team-specific roles, an optional lead, owned services, a notification-participation setting for each member, and an activity history.

Application roles and team roles are separate. An application **Responder** may manage many team operations without being an Owner of that team; a team **Owner** does not automatically become an application Admin.

## Permissions

| Task                                        | Who can perform it                         |
| ------------------------------------------- | ------------------------------------------ |
| View teams, members, services, and activity | Signed-in users                            |
| Create or edit a team                       | Application Admin or Responder             |
| Add a member with Member role               | Application Admin or Responder             |
| Assign Owner or Admin team role             | Application Admin or an Owner of that team |
| Change per-member team notifications        | Application Admin or an Owner of that team |
| Remove a member                             | Application Admin or an Owner of that team |
| Delete a team                               | Application Admin                          |

OpsKnight prevents removal or demotion of the last Owner. Keep at least two Owners for production teams so access does not depend on one account.

## Team roles

| Team role  | Intended responsibility                                                  |
| ---------- | ------------------------------------------------------------------------ |
| **Owner**  | Governs membership, elevated team roles, and notification participation. |
| **Admin**  | Elevated membership classification for team operations and organization. |
| **Member** | Participates in the team and can be included in team routing.            |

The optional **Team Lead** is another designation, not a fourth role. The lead must already be a member. An escalation step targeting a team can use **Notify only team lead** to route only to this user.

## Create and configure a team

1. Open **Teams**.
2. Select **Create Team** and provide a unique name and useful mission description.
3. Expand the team card and add active users.
4. Assign at least one Owner.
5. Edit the team to choose an optional Team Lead.
6. Assign services to this team from each [service's settings](services.md).

Creating a team does not automatically add its creator as an Owner. Verify ownership immediately after creation.

## Manage members

Use the member controls inside the team card to add users, search the member list, change roles, update team-notification participation, or remove users. Adding or removing a member creates an in-app notification for that user and records an audit event.

### Team notification participation

`Receive team notifications` decides whether a member participates when a notification targets the whole team. It is team-specific and defaults to enabled. It does not override the user's channel configuration: the selected person must still have a usable email, phone, device, Slack, WhatsApp, or other applicable provider setup.

Review this setting after role changes and during on-call readiness checks. Disabling it can be appropriate for observers, but it can also silently reduce paging coverage.

### Remove or deactivate a user safely

Before removing a member or disabling their account:

1. Check schedules, escalation policies, assigned incidents, team-lead designation, and owned follow-up work.
2. Add or promote replacement coverage.
3. Transfer active assignments.
4. Remove or deactivate the user.
5. Run a test escalation.

Removing a Team Lead clears the lead field. Removing the last Owner is blocked.

## Use teams for ownership and response

### Service ownership

Assign one owning team from **Service → Settings**. The association drives directory filters and responsibility displays; it does not by itself page the team's members.

### Incident assignment

An incident can be assigned to an individual or to a team. Team assignment makes ownership visible, while the service's escalation policy controls automated paging.

### Escalation target

A policy step can target a team and either notify eligible team members or only the configured Team Lead. Verify the team has active users, appropriate notification participation, working channel configuration, and a lead when lead-only mode is selected.

See [Escalation policies](escalation-policies.md).

## Find and audit teams

The Teams page supports name/description search, minimum member and service counts, sorting by creation time, name, member count, or service count, and 10 teams per page. Each card shows members, services, team statistics, and recent team/member audit activity.

Use the workspace **Audit Log** for broader investigation and retention-based history. The activity panel is an operational convenience, not a separate audit store.

## Delete a team

Only an application Admin can delete a team. Deletion removes its memberships and clears the team association from its services. Review incident ownership, dashboards shared with the team, templates, policies that target it, and other linked records before proceeding; database constraints may block deletion while required references remain.

After deletion, explicitly reassign orphaned services and test their escalation policies. Team deletion does not delete the user accounts.

## Readiness checklist

- [ ] The team has a clear name and responsibility description.
- [ ] At least two appropriate members are Owners.
- [ ] The Team Lead is current if lead-only escalation is used.
- [ ] Disabled or former users have been removed from response paths.
- [ ] Team-notification participation is intentional for every member.
- [ ] Owned services and active incidents are accurate.
- [ ] A test policy reaches the expected recipients.

## Troubleshooting

### A team escalation notifies nobody

Confirm the team has active members, recipients have team notifications enabled, their required channel is usable, and the policy step is not set to lead-only without a Team Lead.

### An Owner cannot change workspace settings

Team Owner is a team-scoped role. The user also needs the required application role for workspace-wide administration.

### A user cannot be removed or demoted

Add another Owner first if this is the team's last Owner. Transfer Team Lead and active response responsibilities before retrying.

## Related topics

- [Users](users.md)
- [Services](services.md)
- [Escalation policies](escalation-policies.md)
- [On-call schedules](schedules.md)
- [Authentication and security](authentication-security.md)
