---
title: Action Items
description: Own and track corrective work from incident postmortems
order: 10
---

# Action Items

Action items turn a postmortem into owned follow-up work. Each item belongs to a postmortem and its incident, and can carry an owner, due date, priority, status, description, and optional Jira issue link.

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
| External link | Optional linked Jira issue with stored key, status, assignee, and sync state         |

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

## Jira integration

When the workspace Jira integration is enabled, a persisted action item can create a Jira issue from its incident service mapping or link an existing Jira issue. OpsKnight displays the stored Jira key and supported metadata and can open the provider issue directly.

A Jira issue can belong to only one OpsKnight incident or action item. Competing attempts to link the same Jira issue are rejected rather than merging two OpsKnight owners into one external link.

Jira status synchronization mirrors only completion state for action items: a Jira status categorized as Done marks a non-completed item `COMPLETED`; if the Jira issue later leaves Done, a currently `COMPLETED` item is reopened to `OPEN`. Existing `IN_PROGRESS` and `BLOCKED` action items are not replaced by other non-Done Jira statuses.

Jira metadata shown in OpsKnight is stored state refreshed by authenticated webhooks or an explicit Sync action; rendering the action item does not require a live Jira request.

GitHub Issues do not have an equivalent native action-item issue-sync workflow in v1.5.

## Troubleshooting

| Problem                                       | Check                                                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| An item is absent from the board              | Confirm the postmortem was saved and clear the status, owner, and priority filters.                      |
| An item is marked overdue                     | Its due date is in the past and it is not Completed.                                                     |
| **Create Jira** fails                         | Configure workspace Jira, then configure the incident service's Jira project and action-item issue type. |
| Jira reports an invalid project or issue type | Verify the project key, API-token permissions, and issue type in **Service Settings → Jira Mapping**.    |
| A Jira issue cannot be linked                 | Confirm the key exists and is not already linked to another incident or action item.                     |
| Jira status appears stale                     | Use Sync if permitted, confirm service sync is enabled, and verify Jira webhook delivery.                |
| Jira link shows `Deleted in Jira`             | The provider issue was deleted; OpsKnight preserves the historical reference instead of deleting it.    |

## Related guides

- [Postmortems](./postmortems)
- [Incidents](./incidents)
- [Jira Cloud](../integrations/issue-tracking/jira)
