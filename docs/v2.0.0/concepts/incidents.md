---
title: Incidents and lifecycle state
description: Understand incident identity, classification, assignment, lifecycle transitions, SLA clocks, and response projections.
type: concept
product_area: incidents
audience: [responder, administrator]
keywords: [incident lifecycle, acknowledge, resolve, snooze, suppress, reopen, incident priority]
verification:
  level: source
  verified_at: 2026-09-29
  evidence:
    - src/lib/incidents/creation.ts
    - src/lib/incidents/lifecycle.ts
    - src/lib/incidents/operator-lifecycle.ts
    - src/lib/incidents/priority.ts
    - src/lib/incidents/engagement.ts
    - src/lib/incidents/idempotent-commands.ts
    - prisma/schema.prisma
---

# Incidents and lifecycle state

An incident is the durable coordination record for an operational disruption.
It belongs to one service and records lifecycle state, assignment, urgency,
priority, visibility, SLA contract, escalation generation, custom fields,
timeline events, notes, watchers, notifications, external links, action items,
war rooms, and postmortem context.

The incident row and lifecycle engine are authoritative. Slack/Teams cards,
status pages, Jira issues, notifications, dashboards, and reports are
projections that can lag or fail independently. When they disagree, inspect the
OpsKnight incident and its delivery/job history before changing state again.

## Identity, correlation, and creation outcomes

Every incident has an OpsKnight ID. Inbound sources can also provide a
deduplication/correlation identity. Creation can produce three outcomes:

- `CREATED` — a new incident was opened;
- `MERGED` — an event matched an existing active incident; or
- `REOPENED` — a matching recently resolved incident was reopened within the
  supported correlation window.

For direct web/mobile creation, title, service, and urgency are required by the
creation contract; optional values include description, priority, deduplication
key, one assignee or one team, visibility, and configured custom fields.
Assignment is mutually exclusive: an incident cannot be initially assigned to
both a user and team.

The selected service must exist. A user assignee must be active, and a team
target must still exist. Custom field values are validated and normalized
according to their configured types; defaults can be applied during creation.

## Urgency and priority are different

Urgency controls interruption behavior:

| Urgency | Engagement behavior |
| --- | --- |
| `HIGH` | Critical traffic that can bypass normal interruption deferral |
| `MEDIUM` | Standard responder paging and notification behavior |
| `LOW` | Deferable behavior that can wait until configured support hours |

Priority expresses business impact:

| Priority | Meaning |
| --- | --- |
| `P1` | Crisis; critical business impact requiring immediate response |
| `P2` | High; major impact requiring rapid coordinated response |
| `P3` | Medium; material impact on the normal response path |
| `P4` | Low; limited impact with lower response obligation |
| `P5` | Informational; minimal impact retained for visibility/follow-up |

Priority is not inferred permanently from urgency. Provider adapters can map a
source severity into initial classification, but responders should preserve the
distinction. Changing priority does not silently change urgency, support-hours
behavior, or the frozen SLA contract.

For LOW urgency outside support hours, OpsKnight can defer engagement until the
next resolvable staffed interval. HIGH urgency uses the critical path. If
support-hours policy cannot resolve a future interval, the system rejects that
decision instead of silently dropping work.

## Visibility

Visibility is `PUBLIC` or `PRIVATE`. The service supplies the default for new
manual and integration incidents, and responders can make an intentional
per-incident choice.

- Public incidents can participate in status-page/customer communication when
  the relevant status configuration includes the service.
- Private incidents remain internal and have tighter scoped-user visibility.

Public does not mean anonymous access to the full internal incident. Status
pages expose their own selected projection. Changing service default visibility
does not rewrite existing incidents.

## Assignment, acknowledgement, and watching

These signals are independent:

- **Assignment** identifies the current responsible user or team.
- **Acknowledgement** records that response awareness has been accepted and
  stops active escalation for that generation.
- **Watching** gives a user a relationship to updates and can contribute to
  scoped incident visibility.

An incident can be acknowledged while unassigned, or assigned while still
open/unacknowledged. Reports and automations must not infer one state from the
other. Reassignment does not acknowledge on the new owner's behalf.

## Lifecycle states

The supported operational states are:

| State | Meaning |
| --- | --- |
| `OPEN` | Active and unacknowledged; escalation can run |
| `ACKNOWLEDGED` | Active response accepted; escalation completed/stopped |
| `SNOOZED` | Active but temporarily paused until a future time |
| `SUPPRESSED` | Active but intentionally excluded from active escalation |
| `RESOLVED` | Active response ended with resolution context |

Supported commands are Acknowledge, Resolve, Reopen, Unacknowledge, Snooze,
Unsnooze, Suppress, and Unsuppress. Lifecycle updates use serializable database
transactions, expected-state checks where supplied, and idempotency boundaries.
Repeating a command that is already applied returns unchanged rather than
creating another transition; a conflicting stale update tells the caller to
refresh.

### Acknowledge

Acknowledge moves an active incident to `ACKNOWLEDGED`, records the first
acknowledgement time if absent, completes escalation, clears its next due time,
and closes any active SLA pause. The first acknowledgement SLA sample is
incident-lifetime truth and is not replaced by later reopen/unacknowledge cycles.

### Unacknowledge

Unacknowledge returns an acknowledged incident to `OPEN`, clears current
acknowledgement state, increments the escalation generation, and schedules the
current escalation step using its configured delay. It does not erase the first
acknowledgement SLA capture.

### Snooze and unsnooze

Snooze requires a valid future end time and accepts a reason up to the current
limit. It changes status to `SNOOZED`, pauses escalation and the effective SLA
clock, and clears the next escalation time. Updating an existing snooze is
treated as a real change when end time or reason differs.

Unsnooze closes the pause, returns to `OPEN`, increments escalation generation,
and reschedules the current step with its delay. Expiry automation must still
confirm the incident generation and current state before acting.

### Suppress and unsuppress

Suppress changes the incident to `SUPPRESSED`, pauses escalation and effective
SLA time, and removes a scheduled next escalation. It is for deliberate
operational suppression, not resolution.

Unsuppress closes the pause, returns to `OPEN`, increments escalation
generation, and makes escalation eligible immediately. Review the reason and
current impact before unsuppressing a large alert stream.

### Resolve

Human/operator resolution requires a meaningful resolution note between 10 and
1,000 characters and completion of every required custom field. It records
resolution time/kind, materializes resolve elapsed time, completes escalation,
clears snooze state, appends lifecycle/timeline events, and stores the
resolution note for later review.

An authoritative upstream recovery event can auto-resolve without being blocked
by custom fields that only a human can fill. That transition is recorded as
source recovery rather than a manual resolution.

### Reopen

Reopen is valid from `RESOLVED`. It clears current acknowledgement/resolution
state, retains incident-lifetime first-ack truth, clears the previous resolve
elapsed sample, starts a new escalation generation at step zero, and schedules
the first step's delay.

Reopening does not erase earlier timeline, notifications, response history, or
resolution evidence. Treat it as a new active generation of the same correlated
incident.

## Escalation generations prevent stale work

Lifecycle transitions that resume/restart response increment an escalation
generation. Workers re-check this token before assignment, delivery, and final
mutation. Work claimed for an earlier generation must become stale rather than
page after acknowledgement, resolution, snooze, suppression, or a newer reopen.

This is why operators should avoid repeated clicks while a command is pending.
Idempotency protects the durable transition, but duplicate human actions make
delivery diagnosis and external projections harder.

## SLA contract and clocks

At creation, OpsKnight resolves the incident's SLA targets from current policy
and stores a contract on the incident. Later edits to service tier or SLA policy
must not rewrite historical targets silently.

The lifecycle maintains:

- immutable first-ack elapsed time;
- current/final resolve elapsed time;
- accumulated paused time;
- an open pause start when snoozed/suppressed; and
- indexed next-transition hints rebuilt after lifecycle changes.

Snooze and suppression pause effective materialized SLA time. Acknowledge,
resolve, reopen, unsnooze, and unsuppress close an active pause. Read
[incident SLA](incident-sla/) for the full timing contract.

## Timeline and side effects

Every meaningful transition appends a timeline event. Resolution with a human
note also creates retained note/comment context. In the same transaction,
OpsKnight enqueues lifecycle side effects for downstream processing.

Downstream work can include notification delivery, service notifications,
ChatOps card refresh, war-room lifecycle, Jira synchronization, status
projection, SLA scheduling, and analytics updates. A successful incident
transition does not guarantee every external provider completed synchronously.
Use delivery/job diagnostics for those projections rather than repeating the
lifecycle action.

## Sources and authorization

Lifecycle commands can originate from web, mobile, REST API, bulk operations,
ChatOps, voice, inbound events, or system automation. The shared lifecycle
engine enforces transition invariants; each adapter must authenticate and
authorize the actor before calling it.

Interactive responders need the relevant incident capability and resource
scope. API keys also need the corresponding explicit scope. ChatOps resolves
the linked OpsKnight identity and current authorization inside the command—not
from a display name in Slack or Teams.

Bulk lifecycle requests are limited to 100 incidents per request and apply the
same lifecycle rules. Review partial/individual results rather than assuming a
bulk click bypasses conflicts or required fields.

## Operational verification

For a synthetic incident, verify this sequence:

1. Create it on a test service and confirm exactly one ID/timeline creation.
2. Assign a user or team; confirm assignment without acknowledgement.
3. Acknowledge; confirm first-ack time and escalation completion.
4. Add a note and watcher; verify scoped visibility and notifications.
5. Snooze with a future time; confirm pause state and no due escalation.
6. Unsnooze; confirm a new escalation generation and scheduled step.
7. Resolve with required fields and a useful note.
8. Confirm provider/status/Jira projections separately.
9. Reopen; confirm old history remains and a new active generation begins.
10. Resolve again and confirm first-ack history was not rewritten.

## Troubleshooting

### The incident changed on another device

A status update using an older expected state returns a conflict. Refresh the
incident, read the new timeline/state, and decide whether the intended action is
still valid. Do not blindly retry.

### Acknowledgement succeeded but a provider card looks open

Check the OpsKnight incident and timeline first, then inspect outbox/provider
delivery and war-room/card diagnostics. Re-acknowledging an already acknowledged
incident will not repair an external projection.

### Resolution is rejected

Provide 10–1,000 characters and complete every required custom field. Confirm
the incident remains in a state from which resolution is allowed and the actor
has responder authority.

### A snoozed incident still affects reporting

Snooze pauses active escalation and effective SLA time; it does not erase the
incident or its history. Confirm which report metric is being viewed.

### Reopened incident retains its first acknowledgement

Expected: the first acknowledgement SLA sample is incident-lifetime truth.
Reopen clears current acknowledgement and restarts operational escalation but
does not falsify the earlier response record.

Continue with the [incident response model](incident-response/) and
[create an incident](../guides/incidents/create/).
