---
title: Action Items
description: Own and track corrective work from incident postmortems
order: 10
---

# Action Items

Action items turn a postmortem into owned follow-up work. Each item belongs to a postmortem and its incident, and can carry an owner, due date, priority, status, description, and Jira link.

## Action-item fields

| Field       | Values or behavior                                                |
| ----------- | ----------------------------------------------------------------- |
| Title       | Required description of the corrective work                       |
| Description | Optional detail or acceptance criteria                            |
| Owner       | An active OpsKnight user, or unassigned                           |
| Due date    | Optional date; incomplete items past this date are marked overdue |
| Priority    | High, Medium, or Low                                              |
| Status      | Open, In Progress, Completed, or Blocked                          |
| Source      | Postmortem for items created in the v1.3 postmortem workflow      |
| Jira        | Optional linked Jira issue when Jira is configured                |

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

You can switch between board and list views; filter by status, owner, or priority; open the originating postmortem and incident; and identify overdue items. The totals describe the unfiltered collection; filters change the displayed items.

## Update an item

Responders and administrators can manage action items. Update the owner, due date, priority, description, or status from the postmortem. Set the status to **Completed** only after the corrective work and its validation are finished.

## Jira workflow

When the workspace Jira integration and the incident service's Jira mapping are configured, an item can create a Jira issue, link an existing issue by key, refresh the linked issue's status and assignee, or unlink it.

Creating an issue requires a valid Jira project and action-item issue type on the service mapping. Linking is one-to-one: an issue already linked elsewhere cannot be linked again. See [Jira Cloud](../integrations/issue-tracking/jira).

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
