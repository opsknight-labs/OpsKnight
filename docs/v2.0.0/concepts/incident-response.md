---
title: Incident response
description: How OpsKnight coordinates awareness, ownership, escalation, mitigation, resolution, and learning.
type: concept
product_area: incidents
audience: [responder, administrator]
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - src/lib/incidents/lifecycle.ts
    - src/lib/incidents/engagement.ts
    - src/lib/escalation/authorization.ts
    - src/lib/escalation/planner.ts
---

# Incident response

OpsKnight keeps one authoritative incident state and projects it into notification providers, ChatOps cards, war rooms, Jira, status pages, analytics, and postmortems. Responders should make lifecycle decisions against the incident page and treat external representations as potentially delayed views.

## Response model

A practical response moves through six concerns that may overlap:

1. **Awareness** — an integration or person creates the incident and responders receive context.
2. **Ownership** — somebody acknowledges response and an individual or team is assigned.
3. **Coordination** — responders use notes, watchers, action items, and an optional war room to share current truth.
4. **Mitigation** — the team reduces impact while escalation continues only as needed.
5. **Resolution** — verified recovery ends active response with an auditable note.
6. **Learning** — postmortems and action items turn evidence into owned improvements.

OpsKnight does not infer one concern from another. Assignment does not acknowledge; acknowledgement does not assign; a created war room does not change lifecycle state; a resolved incident does not automatically prove every remediation item is complete.

## Acknowledgement and assignment

Acknowledgement records that a responder accepted the response and preserves the first acknowledgement measurement. It completes the active escalation generation. Assignment records the current coordinating owner and can point to a user or team.

Either can happen first. During handoff, keep the acknowledgement history and change the assignee with a timeline note rather than unacknowledging solely to represent a new owner.

## Escalation generations

Escalation work belongs to a generation of the incident. Lifecycle transitions increment or complete that generation so a delayed worker cannot page targets from stale state.

- Open incidents can execute scheduled or authorized manual escalation.
- Acknowledgement completes active escalation work.
- Snooze and suppression pause response paging for their respective operational reasons.
- Unsnooze, unsuppress, unacknowledge, and reopen create a current generation with a new schedule.
- Resolution completes escalation and removes the next scheduled escalation time.

This is why responders should refresh after a concurrency conflict: the other action may have deliberately invalidated the work they were attempting.

## Snooze and suppression

Snooze is a time-bounded pause with a wake time and optional reason. Use it when work is intentionally waiting and the incident should return to active response automatically.

Suppression is an explicit operational hold without the same time-bounded meaning. Use it for known noise or a controlled condition that should remain paused until a person unsuppresses it.

Neither state resolves the incident. Record enough context that the next responder understands why paging is paused and what condition should end the pause.

## Communication and projections

The incident timeline is the durable response narrative. Record observations, decisions, mitigations, handoffs, and resolution evidence without placing secrets or unnecessary personal data in it.

Connected systems serve different purposes:

- Notifications attract attention and can expose delivery failures.
- Slack and Teams cards offer authenticated response actions and can create war-room collaboration spaces.
- Jira can mirror work according to configured mappings.
- Status pages communicate selected public impact; they do not replace the internal incident.
- Watchers follow the response but are not necessarily the owner.

A failed projection should be repaired from the canonical incident state. Do not toggle lifecycle state merely to refresh an external card.

## Resolution and reopening

Human resolution requires a meaningful note and any required custom fields. It records a terminal response event, completes escalation, and preserves timing history. Automated event resolution follows the ingestion contract and is not a substitute for human verification when an operator is closing the incident.

Reopening returns a resolved incident to active response with a new escalation generation while retaining earlier response history. Deduplicated inbound events may reopen a recently resolved matching incident; unrelated events should create a new record.

## Operating discipline

During a live response:

- Verify service, urgency, visibility, and scope before acting.
- Use the incident page to resolve disagreements between projections.
- Submit mutating actions once, then refresh before retrying.
- Treat authorization and concurrency errors as safety boundaries.
- Keep handoffs explicit and verify the incoming owner can access the incident.
- Confirm provider delivery separately from notification creation.
- Resolve only after recovery evidence is stable.
- Convert follow-up work into assigned action items and review it after the response.

## Continue reading

- [Create an incident](../guides/incidents/create.md)
- [Acknowledge an incident](../guides/incidents/acknowledge.md)
- [Assign an incident](../guides/incidents/assign.md)
- [Escalate an incident](../guides/incidents/escalate.md)
- [Resolve and reopen an incident](../guides/incidents/resolve.md)
- [Incident lifecycle](incidents.md)
