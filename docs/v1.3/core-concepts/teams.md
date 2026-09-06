---
order: 6
title: Teams
description: Organize users, assign service ownership, and route incidents effectively
---

# Teams

Teams are the organizational unit for grouping users by responsibility. They provide ownership boundaries for services, enable efficient incident routing, and help manage permissions at scale.

<!-- placeholder:teams-overview -->
<!-- Add: Screenshot of the Teams page showing team cards -->

---

## Why Teams Matter

| Without Teams             | With Teams                              |
| ------------------------- | --------------------------------------- |
| Unclear service ownership | Every service has an accountable team   |
| Manual incident routing   | Escalation policies target entire teams |
| Individual permissions    | Role-based access at team level         |
| No workload visibility    | Team dashboards show incident load      |

---

## Team Structure

### Team Model

| Field           | Description                                           |
| --------------- | ----------------------------------------------------- |
| **Name**        | Unique team identifier (e.g., "Platform Engineering") |
| **Description** | Brief description of team responsibilities            |
| **Team Lead**   | Optional designated lead for escalation purposes      |
| **Members**     | Users assigned to the team with roles                 |
| **Services**    | Services owned by this team                           |

---

## Team Roles

Each team member has one of three roles determining their permissions:

| Role       | Permissions                                                       |
| ---------- | ----------------------------------------------------------------- |
| **OWNER**  | Full control — can manage all settings, assign roles, delete team |
| **ADMIN**  | Can add/remove members, but cannot assign OWNER/ADMIN roles       |
| **MEMBER** | Standard access — receives team notifications, can view team info |

### Role Hierarchy

- Only **OWNER** can assign OWNER or ADMIN roles to other members
- Only system **ADMIN** users or team **OWNER** can modify team settings
- Every team must have at least one OWNER (enforced by system)

---

## Creating a Team

### Via UI

1. Go to **Teams** in the sidebar
2. Click **Create Team**
3. Enter team details:
   - **Name**: Unique name (e.g., "Backend Services")
   - **Description**: What the team is responsible for
4. Click **Create**

<!-- placeholder:team-create-form -->
<!-- Add: Screenshot of team creation form -->

### Initial Setup

After creating a team:

1. Add members (you're automatically added as OWNER)
2. Assign a team lead (optional)
3. Link services to the team

---

## Managing Team Members

### Adding Members

1. Open the team detail page
2. Click **Add Member**
3. Search for users by name or email
4. Select a role (OWNER, ADMIN, or MEMBER)
5. Click **Add**

### Changing Roles

1. Open the team member list
2. Click the role dropdown next to a member
3. Select the new role
4. Confirm the change

> **Note**: You can only assign roles equal to or below your own role level.

### Removing Members

1. Open the team member list
2. Click the remove button next to a member
3. Confirm removal

> **Warning**: The last OWNER cannot be removed. Transfer ownership first.

---

## Team Lead

The **Team Lead** is an optional designation with special significance:

### Purpose

- Used in escalation policies with "Notify Team Lead Only" option
- Provides clear point of contact for the team
- Can be used for management reporting

### Setting Team Lead

1. Open the team settings
2. Select a member as **Team Lead**
3. Save changes

The team lead must be a current member of the team.

---

## Team Notification Preferences

Each team member can control whether they receive team-level notifications:

### Per-Member Settings

| Setting                        | Default | Description                                            |
| ------------------------------ | ------- | ------------------------------------------------------ |
| **Receive Team Notifications** | `true`  | Whether to receive notifications when team is targeted |

### How It Works

When an escalation policy targets a team:

1. System fetches all team members
2. Filters to members with notifications enabled
3. Sends notifications to filtered list

### Opting Out

Members can disable team notifications:

1. Go to **Profile** → **Teams**
2. Toggle **Receive Notifications** for each team
3. Changes take effect immediately

---

## Assigning Services to Teams

Teams provide ownership for services, enabling:

- Clear accountability
- Team-based incident filtering
- Automatic incident routing

### Linking a Service

1. Open the service settings
2. Select **Owner Team** from the dropdown
3. Save changes

### Viewing Team Services

On the team detail page:

- See all services owned by the team
- View service health status
- Quick link to service configuration

---

## Teams in Escalation Policies

Teams are one of three target types for escalation steps:

| Target Type  | Behavior                                       |
| ------------ | ---------------------------------------------- |
| **User**     | Notify a specific individual                   |
| **Team**     | Notify team members with notifications enabled |
| **Schedule** | Notify current on-call from schedule           |

### Team Targeting Options

When targeting a team in an escalation policy:

| Option                    | Behavior                                            |
| ------------------------- | --------------------------------------------------- |
| **Notify All Members**    | All members with notifications enabled are notified |
| **Notify Team Lead Only** | Only the designated team lead is notified           |

### Example Policy

```
Step 1: Primary On-Call (Schedule) → wait 5 min
Step 2: Backend Services Team (Team Lead Only) → wait 10 min
Step 3: Backend Services Team (All Members) → wait 15 min
```

---

## Team Filtering & Search

### Filters Available

| Filter           | Description                        |
| ---------------- | ---------------------------------- |
| **Search**       | Filter by team name or description |
| **Min Members**  | Teams with at least N members      |
| **Min Services** | Teams with at least N services     |

### Sorting Options

| Sort              | Description               |
| ----------------- | ------------------------- |
| **Name (A-Z)**    | Alphabetical by team name |
| **Created Date**  | Newest or oldest first    |
| **Member Count**  | Most or fewest members    |
| **Service Count** | Most or fewest services   |

---

## Team Activity & Audit

All team operations are logged for audit purposes:

| Action             | Logged Details                      |
| ------------------ | ----------------------------------- |
| **Team Created**   | Creator, team name                  |
| **Team Updated**   | Updater, changed fields             |
| **Team Deleted**   | Deleter, team name                  |
| **Member Added**   | Adder, new member, role             |
| **Member Removed** | Remover, removed member             |
| **Role Changed**   | Changer, member, old role, new role |

### Viewing Activity

1. Open the team detail page
2. Scroll to **Activity** section
3. View recent team operations

---

## Teams on Dashboard

Teams appear in several dashboard contexts:

### Team Filter

Filter incidents and metrics by team:

- Incident list can filter by team
- Analytics can filter by team
- On-call schedules show team context

### My Teams

Quick access to teams you belong to:

- Profile shows your team memberships
- Incident filters include "My Teams" option

---

## Best Practices

### Team Structure

- **Align with organizational structure** — Teams should match real ownership boundaries
- **Keep teams focused** — 5-15 members is ideal for most teams
- **Avoid overlap** — Each service should have one owning team

### Membership

- **Assign every production service** to a team
- **Include all responders** who may handle team incidents
- **Set up team leads** for clear escalation paths

### Notifications

- **Enable notifications** for active responders
- **Disable for managers** who don't handle incidents directly
- **Use team targeting** in escalation policies for redundancy

### Naming Conventions

| Good                   | Bad          |
| ---------------------- | ------------ |
| "Platform Engineering" | "Team 1"     |
| "Payment Services"     | "Bob's Team" |
| "Customer Success"     | "CS"         |

---

## Incidents Assigned to Teams

Incidents can be assigned to teams (not just individual users):

### How It Works

1. When an incident is assigned to a team:
   - All team members see it in "My Queue" (if they have team notifications enabled)
   - Any team member can acknowledge or resolve
   - Team appears as assignee in incident list

2. Reassigning from team to user:
   - Any team member can reassign to themselves
   - Or reassign to another team member

### When to Use Team Assignment

- **Uncertain owner**: Let the team decide who handles it
- **Shared responsibility**: Multiple people may need to collaborate
- **Triage**: Initial assignment before investigation

---

## Related Topics

- [Users](./users) — User management and roles
- [Services](./services) — Service configuration
- [Escalation Policies](./escalation-policies) — Notification routing
- [Schedules](./schedules) — On-call rotations
