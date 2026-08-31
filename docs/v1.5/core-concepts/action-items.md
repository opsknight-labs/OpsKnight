---
title: Action Items
description: Own and track corrective work from incident postmortems
order: 10
---

# Action Items

Action items turn a postmortem into owned follow-up work. Each item belongs to a postmortem and its incident, and can carry an owner, due date, priority, status, description, and external ticket link (Jira / GitHub).

## Action-item fields

| Field         | Values or behavior                                                                   |
| ------------- | ------------------------------------------------------------------------------------ |
| Title         | Required description of the corrective work                                          |
| Description   | Optional detail or acceptance criteria                                               |
| Owner         | An active OpsKnight user, or unassigned                                              |
| Due date      | Smart countdown badge (`Overdue`, `Due in X days`, `Due [Date]`, `Completed [Date]`) |
| Priority      | High, Medium, or Low with color-coded badges                                         |
| Status        | Open, In Progress, Completed, or Blocked with one-click transitions                  |
| Source        | Postmortem for items created in the incident learning workflow                       |
| External link | Optional linked Jira or GitHub issue with live sync state                            |

## Add action items to a postmortem

1. Open a postmortem you can manage.
2. In **Action Items**, enter a title.
3. Set priority and status.
4. Optionally add a description, owner, and due date.
5. Select **Add Action Item**.
6. Save the postmortem.

Use a title that describes a verifiable outcome. Put implementation detail and the completion test in the description. Assign an owner and due date before publishing the postmortem whenever possible.

## Use the organization-wide board

Open **Action Items** from the main navigation. The page combines action items from all postmortems and shows totals for open, in-progress, completed, blocked, overdue, and high-priority work.

- **Board vs. List view**: Toggle between a 4-column drag-and-drop/interactive Kanban board and a compact tabular list.
- **One-click status transitions**: Responders can move cards between columns (`Open` ➔ `In Progress` ➔ `Completed` / `Blocked`) directly from the board or list without opening the full postmortem editor.
- **Smart Due Date Badges**:
  - 🔴 **Overdue** (pulsing red badge with days elapsed)
  - 🟡 **Due Soon** (amber badge for items due within 3 days)
  - 🟢 **On Track** (calendar date)
  - ✅ **Completed** (timestamp of completion)
- **Centralized search and filters**: Debounced search across action item titles, postmortems, and owners; filter by Status, Owner, or Priority; export filtered views to CSV.

## Update an item

Responders and administrators can manage action items. Update the status instantly using the card quick-action menu or change owner, due date, priority, and description from the postmortem.

## Ticket integrations (Jira & GitHub)

When the workspace Jira or GitHub integration is configured, an item can link to an external issue, display the issue key and status, and open the external issue with one click.

## Troubleshooting

| Problem                                       | Check                                                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| An item is absent from the board              | Confirm the postmortem was saved and clear the status, owner, and priority filters.                      |
| An item is marked overdue                     | Its due date is in the past and it is not Completed.                                                     |
| **Create Jira** fails                         | Configure workspace Jira, then configure the incident service's Jira project and action-item issue type. |
| Jira reports an invalid project or issue type | Verify the project key, API-token permissions, and issue type in **Service Settings → Jira Mapping**.    |
| A Jira issue cannot be linked                 | Confirm the key exists and is not already linked to another incident or action item.                     |

## Related guides

- [Postmortems](./postmortems)
- [Incidents](./incidents)
- [Jira Cloud](../integrations/issue-tracking/jira)
