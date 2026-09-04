---
title: Incident management
description: Create, triage, assign, escalate, communicate, and resolve incidents in OpsKnight.
order: 2
---

# Incident management

An incident is the operational record for a service disruption or other issue that needs coordinated response. It connects the alert, responders, service, escalation state, response timeline, communications, and follow-up work.

Use this guide for work in the OpsKnight interface. For supported automation, see the [Incidents API](../api/incidents.md) and [Events API](../api/events.md).

## Before you begin

- You must be signed in to view incidents.
- A **Responder** or **Admin** can create and change incidents. A **User** has read-only access to incident response controls.
- Create the affected [service](services.md) first. Assign an [escalation policy](escalation-policies.md) to the service if the incident should page responders.
- Configure integrations and notification providers before relying on them during a real incident.

## Incident lifecycle

| Status                 | Meaning                                             | Escalation behavior                                                                                   |
| ---------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Triggered (`OPEN`)** | New and not yet acknowledged; response is required. | The service policy can continue escalating.                                                           |
| **Acknowledged**       | A responder has taken ownership.                    | The active escalation is completed.                                                                   |
| **Snoozed**            | Response is paused temporarily.                     | Escalation is paused until the incident is returned to Open. A timed snooze can reopen automatically. |
| **Suppressed**         | The incident is intentionally muted.                | Escalation is paused until the incident is unsuppressed.                                              |
| **Resolved**           | Response is complete.                               | Escalation is completed and resolution time is recorded.                                              |

Returning a resolved incident to **Open** reopens it. Status changes are recorded in the timeline and may notify configured service channels, status-page subscribers, and webhooks.

## Create an incident

1. Open **Incidents** and select **Create incident**.
2. Enter a concise title and optional description.
3. Select the affected service.
4. Choose **High**, **Medium**, or **Low** urgency.
5. Optionally select priority **P1–P5**, an individual assignee or team, and public or private visibility.
6. Review any duplicate warning and submit the incident.

You can start from an [incident template](incident-templates.md). Templates prefill common fields but do not bypass validation or routing.

OpsKnight uses the event deduplication key for integration-created incidents. A matching active incident is reused; a recently resolved matching incident can be reopened. Treat the integration key and deduplication key as separate values: the integration key authenticates and routes the event, while the deduplication key identifies the alert condition.

### Public and private incidents

**Public** visibility makes the incident eligible for display through the configured status page. **Private** keeps it out of public incident views. Visibility alone does not publish a postmortem or override status-page privacy settings.

## Find and triage incidents

The Incidents page displays 50 records per page and provides counts for Mine, Active, Resolved, Snoozed, and Suppressed. Active is exactly Triggered (`OPEN`) plus Acknowledged; Snoozed and Suppressed are muted and excluded. Newly triggered incidents broadcast over the real-time stream are optimistically prepended to the top of the feed with an animated emerald `LIVE` indicator and an interactive alert toast.

Use the controls to:

- search incident title, description, or identifier;
- filter by status, priority, urgency, team, or incidents assigned to you;
- sort by creation time, title, priority, urgency, or status;
- select incidents for supported bulk operations.

Bulk controls can acknowledge, resolve, reassign, change status, change urgency or priority, snooze, unsnooze, suppress, or unsuppress selected incidents. Confirm the selection before applying an action: bulk changes update every selected record and can trigger downstream notifications.

## Respond from the incident page

Open an incident to see its service, current owner, status, urgency, priority, SLA state, escalation state, notes, timeline, tags, watchers, custom fields, and connected response tools.

### Acknowledge and assign

1. Select **Acknowledge** when you take responsibility.
2. Assign the incident to one active user or one team when ownership changes.
3. Check the escalation badge and next-step information.

An incident has either an individual assignee or a team assignment. Acknowledgement records `acknowledgedAt`, which is used for MTTA and acknowledgement-SLA calculations.

### Set urgency and priority

- **Urgency** is **High**, **Medium**, or **Low** and affects response attention and notification behavior.
- **Priority** is an optional business-impact classification from **P1** through **P5**.

They are separate fields. If priority-specific SLA targets are configured for the service, OpsKnight uses them; otherwise it uses the service's default acknowledgement and resolution targets. See [Urgency and severity mapping](urgency-mapping.md).

### Add response context

- Add notes for decisions, observations, commands run, and handoffs.
- Add or remove tags for later discovery.
- Set configured custom fields.
- Add watchers as follower, stakeholder, or executive participants.
- Review the event timeline for recorded status, assignment, escalation, and other changes. It is operational history, not a comprehensive immutable compliance ledger.

Do not place credentials or sensitive customer data in notes, tags, custom fields, or public incident content.

### Snooze or suppress

Use **Snooze** for a temporary pause, ideally with an end time and reason. Use **Suppress** when the alert should remain muted until a responder explicitly restores it. Both states pause escalation; neither resolves the underlying incident.

After returning the incident to **Open**, verify that an assignee or escalation path is available.

### Use Jira and a Slack war room

When Jira is enabled and the service has a project mapping, the incident page can create a Jira issue, link an existing issue, unlink it, and refresh its state. See [Jira integration](../integrations/issue-tracking/jira.md).

When Slack ChatOps is configured, eligible incidents can have a dedicated war-room channel and video bridge. Resolving the incident can archive the channel while retaining its identifiers for history. See [Slack ChatOps](../integrations/communication/slack-chatops.md).

## Resolve and follow up

1. Confirm service recovery and monitoring stability.
2. Select **Resolve** and add a useful resolution note.
3. Verify the status is **Resolved** and the resolution time is recorded.
4. Create or update the [postmortem](postmortems.md) when learning or accountability is required.
5. Track remediation in [action items](action-items.md).

A resolution note should state what changed, how recovery was verified, and any remaining risk. Resolution may notify configured service channels, status-page subscribers, and service webhooks. It also stops active escalation and can archive an associated Slack war room.

## Verify the workflow before production use

Run one test incident for each critical service:

1. Trigger it through the same inbound path production monitoring will use.
2. Confirm the correct service and urgency.
3. Confirm the expected user, team, or schedule receives the first notification.
4. Let a test escalation advance once, then acknowledge it.
5. Add a note, assign it, and resolve it.
6. Confirm the timeline, notification history, and any configured status-page or webhook update.

## Troubleshooting

### No responder is notified

- Confirm the service has an escalation policy.
- Confirm every policy step has a valid active user, team member, or current on-call schedule participant.
- Confirm the intended channel is enabled globally and for the target.
- Check **Notification History**, **Event Logs**, and system logs for provider errors.

### An integration creates duplicate incidents

- Use a stable deduplication key for the same alert condition.
- Confirm events use the same service integration key.
- Check whether the earlier incident was resolved outside the reopen window.

### Snoozed or suppressed response does not resume

Return the incident to **Open**, confirm its escalation state is active, and verify the service policy still has a resolvable target.

### The incident does not appear publicly

Confirm the incident is public, the status page is enabled, the service is included, and the status-page privacy controls permit incident details. See [Status page](status-page.md).

## Related topics

- [Services](services.md)
- [Escalation policies](escalation-policies.md)
- [On-call schedules](schedules.md)
- [Incident templates](incident-templates.md)
- [Postmortems](postmortems.md)
- [Events API](../api/events.md)
- [Troubleshooting](../troubleshooting.md)
