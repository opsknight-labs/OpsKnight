---
title: Respond to an incident end to end
order: 2
description: Follow the complete OpsKnight response journey from alert receipt through acknowledgement, ownership, communication, escalation, resolution, and follow-up.
type: tutorial
product_area: incidents
audience: [responder, administrator]
keywords: [incident response workflow, acknowledge, assign, escalate, resolve]
reader:
  status: READER_COMPLETE
  task: Respond to and close an OpsKnight incident end to end.
verification:
  level: test
  verified_at: 2026-09-29
  evidence: [tests/docs/journeys/incident-lifecycle.spec.ts, src/lib/incidents/lifecycle.ts, src/lib/incidents/engagement.ts]
---

# Respond to an incident end to end

Use this workflow during a real response or controlled exercise. OpsKnight is the authoritative incident state even when you receive and act through email, Slack, Teams, or another notification channel.

## Before you begin

Sign in as a responder who can view/manage the service incident. Ensure your notification and ChatOps identities are current. Know the service runbook, current on-call/escalation policy, communication destination, and authority for resolving the event.

## 1. Open and identify the incident

1. Follow the notification link or open **Incidents**.
2. Match title, service, environment/context, urgency, priority, and creation time.
3. Read the description, integration payload/context, timeline, SLA/response target, current escalation step, and recent related incidents.
4. Confirm whether the incident is a new failure, duplicate, recurrence, or controlled exercise.

Do not act from an old provider message without confirming the current OpsKnight state.

### Where things are on the incident page

- **Title card:** title, status, a deduplication chip (for example **6 alerts · first in 41 days**: the alert count opens the Timeline's activity graph and dedup details, and the gap links to the last earlier incident on the same dedup key), ID and link copy buttons, SLA chips (**Ack** and **Resolve**, each showing time left, time overdue, or **Met**, plus **Clock paused** while the SLA clock is paused), impacted business services, **Notify stakeholders**, and the **Roles** chips.
- **Details card:** the first card in the right-hand column lists **Priority**, **Urgency**, **Visibility**, **Service**, **Assignee**, **Incident policy**, **Escalation** and **Opened**, one per row; the ones you can change are dropdowns. On narrower screens, where the right-hand column moves below the tabs, these fields sit along the bottom of the title card instead. Under **Escalation**, a line such as **✓ 3/3 steps ran** opens the escalation step list; when a step failed or needs review, the full **Escalation Execution Health** panel appears below the action bar instead, already open (see [Escalate an incident](./escalate)).
- **Action bar:** tags (two shown, **+N** for the rest), the war room button, **Jira**, and **Post status update** on the left; **Acknowledge**, **Resolve**, **Take command** and the **⋯** menu (Unacknowledge, Snooze, Suppress) on the right.
- **Description card:** the verified **Context** first, as key/value pills with a **Verified · automation vN** badge (a dashed pill is a field that is missing or whose value was not recognised; only recognised fields drive runbook triggers and Agent targeting), then the description or raw alert payload. When intelligence is on for the service and has something to report, the compact **AI briefing** card sits directly under the title card; **Open investigation** opens the **Investigation** panel (see [Use Intelligence suggestions](../intelligence/use-suggestions)).
- **Tabs:** **Notes** (with the note count), **Timeline** (an **Events** list with an activity graph, or the **Response path** view), **Runbooks & automation** (runbooks first, then the automation decision and alert context; the tab is named **Automation** when you cannot read runbooks), and **Postmortem** once the incident is resolved. The tab bar stays in view while you scroll.

### Read the alert payload

When the incident's description is an alert payload, the **Description & Context** card shows it as a
readable view instead of raw text. OpsKnight builds this view with fixed rules, not AI, so it works with AI
turned off and the payload never leaves your OpsKnight:

- **What fired:** the sending tool (for example Datadog, Grafana, Alertmanager, CloudWatch, Azure Monitor,
  Google Cloud Monitoring, New Relic, Sentry, PagerDuty, Zabbix, Nagios, uptime checkers, GitHub or
  Kubernetes), firing or resolved, the severity, the title, and the condition with the measured value and
  threshold where the tool sends them.
- **Query**, labelled with its language (PromQL, SQL, NRQL, LogQL, SPL, KQL or Datadog) when one is present.
- **Where and when:** host, service, env, region and similar fields, and the start and resolve times in your
  time zone.
- **Message, links and tags:** the tool's own message, its links (dashboard, runbook, the alert in the
  source tool; only `http` and `https` links are shown) and graph images, and the alert's tags.
- **Other fields:** everything else, as readable paths such as **Monitor › Priority**.

Payloads from tools without a dedicated reader are still read by key names and value shapes. JSON,
ClickHouse-style values (`{'A':5400}`), XML, logfmt, form data, `Key: value` text, Markdown and plain text
are all recognised, as is JSON nested inside a string. Credential-looking fields are masked before anything
is shown. The **Raw alert payload** row below the view shows the format and size; **View raw** shows the
payload as received and **Copy** copies it.

### Read the timeline

The **Timeline** tab has two views. **Response path** shows routing, paging, remediation, verification and recovery as lanes. **Events** lists every event and shows an **Activity** graph above the list:

- Bars count alerts per time bucket; the bucket size adapts to the incident's length. A dashed line marks when the incident triggered.
- Coloured dots mark key events: changes before onset, the trigger, escalations, acknowledgement and resolution, notes, and runbook runs. Select a dot to jump to its row in the list; the row is highlighted and the filter resets to **All**.
- On a long incident, **Onset** (the default) zooms to the alert burst and what led up to it, and **All** shows the whole incident. Events outside the window collect at the edges as **‹ N earlier** and **N later ›**; **N later ›** switches to **All**.
- **N alerts → 1 incident** opens **Deduplication**: the dedup key (with a copy button), how many alerts are still firing, the severity mix, distinct fingerprints when the source sends them, and when alerts were first and last seen. An incident with no alerts shows **No alerts · opened by hand or by API**.

Filter chips with no events are hidden. When intelligence events exist, **Show intelligence events** is a switch at the end of the chip row.

Links from earlier releases still open the right place: `?tab=overview` opens **Notes**, `?tab=response` and `#response-activity` open the **Timeline** tab in its **Response path** view, and `?tab=runbooks` and `#runbook-…` links open **Runbooks & automation**.

## 2. Acknowledge active response

Use **Acknowledge** when you accept response responsibility. Confirm the timeline attributes you and acknowledgement timing/escalation behavior is correct. Acknowledgement is not assignment or resolution.

Follow [Acknowledge an incident](./acknowledge) for valid states, concurrency, channel actions, and unacknowledgement.

## 3. Assign operational ownership

Set one responsible user or team. Assignment communicates coordination ownership but does not prove the assignee has seen/accepted the incident. For handoff, change assignment and record context in the timeline.

Follow [Assign an incident](./assign).

## 4. Diagnose and communicate

Use the service runbook and observability evidence to bound impact, time, affected users/components, and mitigations. Add concise notes for decisions and results on the **Notes** tab; the box is one line until you select it, then shows formatting, **Preview** and **Post**. The **Timeline** tab's **Activity** graph shows when alerts arrived relative to the trigger, and **N alerts → 1 incident** shows how they were deduplicated. To run a runbook that is not attached to the service, use **Run another runbook** on the **Runbooks & automation** tab (see [Bind Runbooks and respond to incidents](../runbooks/respond)).

Use routine Slack/Teams destination cards for distributed awareness. Create a [war room](../chatops/create-war-room) when the response needs an incident-scoped coordination space. Keep authoritative status in OpsKnight; provider chat history is collaboration evidence, not the lifecycle source of truth.

## 5. Escalate from a supported Teams card when needed

Escalate when the current response requires broader/faster attention and the next policy step is appropriate. In 2.0, manual escalation is available only from a capability-enabled Microsoft Teams Adaptive Card—the Web incident page has no manual **Escalate** control and standard Slack actions do not expose manual escalation. Outside Teams, assign or reassign the incident for immediate handoff. Inspect the current target/step before acting and do not repeatedly escalate after an ambiguous response.

Follow [Escalate an incident](./escalate) and verify the timeline plus notification delivery.

## 6. Track follow-up work

During response, keep immediate operational steps in the timeline/coordination channel. Create [action items](./action-items) for durable remediation, ownership, due dates, and optional Jira tracking. Do not hide unresolved response-critical work in a future action item.

## 7. Resolve with evidence

Resolve only after service health/trigger condition is verified and the observation period has passed. Complete required custom fields, record impact/mitigation/resolution summary, assign remaining action items, and confirm active escalation should end.

Follow [Resolve an incident](./resolve). The **Postmortem** tab appears once the incident is resolved; until then a wide screen shows **Postmortem after resolve** at the right of the tab bar. If the condition later returns, report a new manual incident with the matching deduplication key within 30 minutes or use an authorized public API status update; the Web incident page has no direct manual Reopen action. Normal automated alert ingestion creates a new incident.

## Verify the completed response

Confirm:

- final incident state and actor attribution are correct;
- acknowledgement/assignment/escalation/resolution timeline is complete;
- notifications and Slack/Teams projections converged;
- status-page projection is correct when applicable;
- action items have owners/dates;
- SLA/response measurements and audit history are retained;
- responders/customers receive the required closure communication.

## Troubleshooting

**Action is unavailable:** verify incident current state, user permission/scope, required fields, and concurrent changes.

**Provider message differs from OpsKnight:** treat OpsKnight as authoritative, inspect delivery/projection operation, and reconcile rather than manually fabricating a second message.

**Escalation or notification is delayed:** inspect lane/provider delivery state and oldest queue age; do not resolve only to stop paging.

**Resolution is blocked:** complete required custom fields and verify the incident is in a resolvable state.

## Next steps

- Review the postmortem/follow-up workflow and [action items](./action-items).
- Test the service's [on-call](../on-call/build-schedule), [escalation](../escalation/configure-policy), and [notification delivery](../notifications/inspect-delivery) before the next event.
