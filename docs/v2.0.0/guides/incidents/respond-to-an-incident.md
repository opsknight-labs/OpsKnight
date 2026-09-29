---
title: Respond to an incident end to end
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

## 2. Acknowledge active response

Use **Acknowledge** when you accept response responsibility. Confirm the timeline attributes you and acknowledgement timing/escalation behavior is correct. Acknowledgement is not assignment or resolution.

Follow [Acknowledge an incident](./acknowledge) for valid states, concurrency, channel actions, and unacknowledgement.

## 3. Assign operational ownership

Set one responsible user or team. Assignment communicates coordination ownership but does not prove the assignee has seen/accepted the incident. For handoff, change assignment and record context in the timeline.

Follow [Assign an incident](./assign).

## 4. Diagnose and communicate

Use the service runbook and observability evidence to bound impact, time, affected users/components, and mitigations. Add concise timeline notes for decisions and results.

Use routine Slack/Teams destination cards for distributed awareness. Create a [war room](../chatops/create-war-room) when the response needs an incident-scoped coordination space. Keep authoritative status in OpsKnight; provider chat history is collaboration evidence, not the lifecycle source of truth.

## 5. Escalate when needed

Escalate when the current response requires broader/faster attention and the next policy step is appropriate. Inspect the current target/step before acting. Do not repeatedly escalate after an ambiguous response.

Follow [Escalate an incident](./escalate) and verify the timeline plus notification delivery.

## 6. Track follow-up work

During response, keep immediate operational steps in the timeline/coordination channel. Create [action items](./action-items) for durable remediation, ownership, due dates, and optional Jira tracking. Do not hide unresolved response-critical work in a future action item.

## 7. Resolve with evidence

Resolve only after service health/trigger condition is verified and the observation period has passed. Complete required custom fields, record impact/mitigation/resolution summary, assign remaining action items, and confirm active escalation should end.

Follow [Resolve and reopen](./resolve).

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

