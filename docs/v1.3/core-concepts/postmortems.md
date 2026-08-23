---
title: Postmortems
description: Document resolved incidents and turn lessons into owned corrective work
order: 11
---

# Postmortems

OpsKnight postmortems capture what happened, the impact, why it happened, how service was restored, what the team learned, and which corrective actions have owners. A postmortem belongs to exactly one resolved incident, and an incident can have at most one postmortem.

## Permissions and lifecycle

- Any authenticated user can view the Postmortems list.
- Responders and administrators can create, edit, publish, archive, and delete postmortems.
- A postmortem can be created only for an incident whose status is **Resolved**.
- The supported statuses are **Draft**, **Published**, and **Archived**.
- There is no separate `IN_REVIEW` state or approval workflow in v1.3.

The `isPublic` setting controls whether a published review is eligible for the public status-page postmortem view. Review its content for secrets, personal data, internal URLs, and exploitable implementation details before making it public.

## Choose incidents that need a review

OpsKnight does not force a postmortem policy. Define one for your organization. Strong candidates include customer-impacting incidents, security or data events, missed SLA targets, repeated failure modes, long incidents, difficult handoffs, and useful near misses.

Do not use the postmortem to assign blame. Describe system conditions, signals, decisions, constraints, and opportunities for improvement.

## Create a postmortem

1. Resolve the incident.
2. Open **Postmortems**.
3. Select **Create Postmortem**.
4. Choose one of the most recent resolved incidents without a postmortem. The chooser loads up to 100 incidents.
5. Enter a title (maximum 100 characters).
6. Complete the relevant sections described below.
7. Leave the status as **Draft** while the content is being reviewed.
8. Save, reopen the postmortem, and check the rendered result.

You can also create or open a postmortem from its incident page when that action is available.

## Use Auto-Draft carefully

**Auto-Draft** builds a starting point from the incident's stored data and timeline. It is a deterministic product helper, not an external assertion that the generated root cause is correct.

After generating a draft:

1. Check every timestamp and actor.
2. Replace inferred root-cause language with evidence.
3. Quantify impact from authoritative data.
4. Remove irrelevant or sensitive timeline entries.
5. Add owners and due dates to corrective actions.

## Fields and sections

| Section           | What to record                                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Title             | A short identifier for this incident review                                                                                               |
| Executive Summary | What happened, impact, duration, and restoration in plain language                                                                        |
| Timeline          | Detection, escalation, mitigation, and resolution events with timestamps, titles, descriptions, and optional actors                       |
| Impact            | Users affected, downtime, error rate, services affected, SLA breaches, revenue impact, API errors, and performance degradation when known |
| Root Cause        | The technical and organizational conditions that produced the incident                                                                    |
| Resolution        | What restored service and how recovery was verified                                                                                       |
| Action Items      | Corrective work with owner, due date, priority, and status                                                                                |
| Lessons Learned   | What helped, what hindered, and what should change                                                                                        |
| Status            | Draft, Published, or Archived                                                                                                             |
| Visibility        | Public or private status-page eligibility                                                                                                 |

Only the title is enforced as required by the form. Your organization's review policy may require additional fields.

## Build the timeline

Timeline entries support four types:

- Detection
- Escalation
- Mitigation
- Resolution

Use the user's configured time zone consistently. Record why a decision was made, not only that a button was clicked. Preserve uncertainty where the team did not know something at the time.

## Quantify impact

Use measured values when available and label estimates. The form supports users affected, downtime minutes, error rate, affected services, SLA breaches, revenue impact, API errors, and performance degradation.

Avoid double-counting. For example, API errors and affected users measure different things and should not be summed into one impact number.

## Track corrective actions

Each action item supports:

- title and description;
- one active-user owner or no owner;
- due date;
- High, Medium, or Low priority;
- Open, In Progress, Completed, or Blocked status;
- an optional Jira issue link.

The postmortem shows completion progress and marks past-due, incomplete items as overdue. The main **Action Items** page provides the organization-wide board and filters. See [Action Items](./action-items).

## Publish or archive

Before setting **Published**:

1. Confirm the incident is the correct one.
2. Verify the summary, timeline, impact, root cause, and resolution.
3. Give each required action item an accountable owner and realistic due date.
4. Decide whether the postmortem is safe for public status-page display.
5. Save and review the rendered page.

Published postmortems receive a publication timestamp. Use **Archived** for a historical record that should no longer appear as active review work.

## Find and manage postmortems

The list shows totals for all, published, draft, and archived records. Filter by status and move through paginated results. The standard page size is 50.

Deleting a postmortem also deletes its normalized action items and their links through database relations. This is destructive and cannot be undone through the UI. Preserve required records before deletion.

## Public status-page view

A public, published postmortem can be displayed at the status-page postmortem route for its incident when status-page settings allow post-incident reviews. This is not a generic unauthenticated share link for every private postmortem.

## Not supported as public v1.3 contracts

- There is no published Postmortems REST API in v1.3.
- There is no postmortem approval/comment/reviewer workflow.
- There is no custom postmortem-template editor.
- There is no built-in postmortem meeting scheduler.
- PDF, Markdown, HTML, and JSON postmortem exports are not published features.
- Jira is the documented issue-tracker integration for action items; GitHub Issues, Linear, and Asana action-item sync are not published features.

## Troubleshooting

| Problem                                               | Check                                                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Create Postmortem** is unavailable                  | Your account must be a responder or administrator.                                                        |
| An incident is not in the chooser                     | It must be Resolved, have no existing postmortem, and fall within the 100 most recent eligible incidents. |
| Save says the incident is not resolved                | Reopen the incident, complete response work, and resolve it before creating the review.                   |
| An action item is missing from the organization board | Save the postmortem and clear board filters.                                                              |
| A postmortem is absent from the public status page    | Confirm it is Published, marked public, and the status page allows post-incident reviews.                 |
| Jira actions fail                                     | Configure workspace Jira and the incident service's Jira mapping.                                         |

## Related guides

- [Incidents](./incidents)
- [Action Items](./action-items)
- [Status Page](./status-page)
- [Jira Cloud](../integrations/issue-tracking/jira)
- [Analytics](./analytics)
