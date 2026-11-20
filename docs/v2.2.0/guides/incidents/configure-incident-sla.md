---
title: Configure incident SLA and classification policy
order: 10
description: Design, configure, simulate, and safely roll out acknowledgement and resolution objectives, alert classification, and support hours.
type: how-to
product_area: incidents
audience: [administrator, operator]
reader: { status: READER_COMPLETE, task: Configure and verify incident classification and SLA policy from alert severity through breach behavior. }
verification:
  level: source
  verified_at: 2026-10-02
  evidence:
    - src/components/settings/incident-sla/IncidentSlaClientView.tsx
    - src/components/incident-sla/IncidentSlaPolicySettings.tsx
    - src/components/incident-sla/IncidentClassificationSettings.tsx
    - src/components/incident-sla/ResponsePolicyOperations.tsx
    - src/components/service/ServiceResponsePolicyHub.tsx
    - src/lib/incidents/classification.ts
    - src/lib/incident-sla/contract.ts
    - src/lib/incident-sla/README.md
---

# Configure incident SLA and classification policy

This workflow connects four separate decisions:

**provider severity → notification urgency → response priority → ACK/resolve targets**

Urgency controls engagement and paging behavior. Priority selects the business
response objective. They are deliberately separate: assigning `P1` does not
silently set urgency to `HIGH`, and setting urgency to `HIGH` produces a priority
only when the configured fallback permits it.

## Before you begin

Only an administrator can change the workspace policy. Prepare the policy with
service owners and responders before editing production:

1. Define what `P1` through `P5` mean for your organization.
2. Agree on separate acknowledgement and resolution targets for each required
   priority and on fallback targets when an incident has no priority rule.
3. Inventory the inbound severities emitted by every provider. OpsKnight's
   normalized values are `critical`, `error`, `warning`, and `info`.
4. Decide which severities page responders as `HIGH`, `MEDIUM`, or `LOW` urgency.
5. Identify services that genuinely require different targets, classification,
   or staffed hours. Prefer workspace inheritance when they do not.
6. Choose controlled test services and payloads. Policy changes affect future
   incidents only; never test by generating an uncontrolled production page.

Record the current policy version and values so the change can be reversed with
a new version. Existing incidents retain the targets, source, and policy version
captured when they were created.

## Open the feature

Open **Settings → Incident Response Policy** (`/settings/incident-sla`). The page
contains four tabs:

- **SLA Objectives (P1–P5):** fallback and priority-specific ACK/resolve targets.
- **Alert Classification:** severity-to-priority and severity-to-urgency rules.
- **Support & Schedules:** policy simulation, scheduler state, timezone, staffed
  windows, and date exceptions.
- **Semantics & Reference:** the implemented breach and classification rules.

Use **Services → service → Response Policy** for a service override. Its tabs
cover **Incident SLA**, **Alert Classification**, and **Support Hours & Coverage**.

## Design priority objectives

Priority describes business impact and selects an SLA contract:

| Priority | Product meaning | Example policy use—not a shipped default |
| --- | --- | --- |
| `P1` Crisis | Critical business impact requiring immediate response | Complete outage, safety/security crisis, or widespread customer failure |
| `P2` High | Major impact requiring rapid coordinated response | Major degradation with no acceptable workaround |
| `P3` Medium | Material impact handled through the normal response path | Partial degradation or important non-critical failure |
| `P4` Low | Limited impact with a lower response obligation | Minor defect or contained operational issue |
| `P5` Informational | Minimal impact tracked for visibility/follow-up | Informational event or low-risk follow-up |

The examples help policy design; they do not configure values automatically.
Define objective values that your staffing model can actually meet. An ACK target
measures time to the first qualifying acknowledgement. A resolution target
measures the incident-lifetime resolution obligation and is independent of ACK.

## Configure SLA objectives

Open **SLA Objectives (P1–P5)**:

1. Enter **Fallback acknowledgement** and **Fallback resolution** in minutes.
   These base targets apply when no enabled rule matches the incident priority.
2. Enable `P1` and enter both its ACK and resolution targets.
3. Repeat for every priority with a distinct objective. An enabled row requires
   both values; leaving one blank is rejected.
4. Leave a priority disabled only when it should use the fallback targets.
5. Review the effective-target summary, then select **Save SLA policy**.
6. Confirm the success message and new policy version.

For a service-specific policy:

1. Open the service's **Response Policy → Incident SLA**.
2. Leave **Inherit workspace defaults** enabled unless the service has an
   approved exception.
3. To create an exception, disable inheritance, enter service fallback targets,
   enable the necessary P1–P5 rows, and save.
4. To remove the exception, re-enable inheritance and save. Future incidents use
   workspace values; existing incident contracts do not change.

## Configure alert classification

Open **Alert Classification**. Each row maps one normalized inbound severity to
an SLA priority and a notification urgency.

### Choose the priority mode

| Mode | Result |
| --- | --- |
| A specific `P1`–`P5` value | `SET`: assign that priority when the row applies. |
| **Use urgency fallback** | `FALLBACK`: derive priority from the resolved urgency for this row. |
| **No automatic priority** | `CLEAR`: deliberately leave priority empty and block the general fallback. |
| **Inherit workspace** | `INHERIT`: on a scoped service/integration rule, continue to the parent rule. |

When urgency fallback is used, the implemented mapping is `HIGH → P1`,
`MEDIUM → P3`, and `LOW → P5`. It never produces `P2` or `P4`; assign those
explicitly when required.

### Choose the urgency mode

| Mode | Result |
| --- | --- |
| `HIGH`, `MEDIUM`, or `LOW` | `SET`: assign that notification urgency. |
| **Severity default** | `DEFAULT`: critical→HIGH, error→MEDIUM, warning→MEDIUM, info→LOW. |
| **Inherit workspace** | `INHERIT`: on a scoped rule, continue to the parent urgency rule. |

### Choose the general fallback

**Urgency Fallback Behavior** controls alerts that reach fallback without an
explicit priority:

- **Enabled:** derive `P1`/`P3`/`P5` from urgency.
- **Disabled:** do not assign an automatic priority.
- **Inherit workspace fallback setting:** available on scoped policies.

An individual row set to **No automatic priority** overrides an enabled general
fallback. Select **Use urgency fallback** on that row when you want derivation.

Configure all four severity rows, review the fallback selection, and select
**Save classification policy**. Rules apply when future alert signals are
processed; they do not reclassify existing incidents.

## Understand classification precedence

OpsKnight resolves priority and urgency independently. Use this order when
explaining an unexpected result:

1. A valid explicit priority or urgency supplied by the incident-creation path
   is retained.
2. Applicable scoped rules are evaluated before inherited/parent behavior.
3. A rule can set, inherit, derive/fallback, default, or explicitly clear its
   field as described above.
4. If urgency is still absent, the normalized severity default is used; without
   a usable severity, urgency falls back to `MEDIUM`.
5. Priority is derived from urgency only when the matched rule requests fallback
   or the applicable general fallback is enabled and priority was not cleared.
6. If nothing assigns priority, the incident remains without a priority and uses
   the base SLA targets.

The incident stores classification provenance and the selected SLA policy
source, version, rule, and priority. Inspect those captured values rather than
guessing from today's settings.

## Configure support hours

Open **Support & Schedules** and find **Support Hours & Operations**:

1. Choose an IANA timezone used to interpret local windows and date exceptions.
2. Choose **24×7 Continuous Coverage** or **Scheduled**. A service can instead
   **Inherit workspace schedule**.
3. For scheduled coverage, add at least one recurring staffed window.
4. Add date exceptions for holidays, maintenance coverage, or exceptional
   staffed periods.
5. Check overnight windows, week boundaries, and daylight-saving changes using
   concrete local dates.
6. Save and confirm the new support-policy version.

Support hours affect engagement, not SLA clock duration. `LOW` urgency outside a
scheduled window can be deferred until the next resolvable staffed interval.
`HIGH` urgency bypasses that interruption deferral; `MEDIUM` uses the standard
path. Support hours never pause incident SLA clocks. Snooze and suppression are
separate lifecycle actions that pause the canonical SLA clock and shift the
incident-lifetime deadline by accumulated pause time.

## Simulate the effective policy

Use **Support & Schedules → Effective Policy Simulation** before sending a test:

1. Select the target service.
2. Select an eligible **Integration Override**, or leave **No integration
   override** selected.
3. Select `critical`, `error`, `warning`, or `info`.
4. Select **Run simulation**.
5. Record **Resolved Priority**, **Notification Urgency**, policy/provenance
   labels, **Target SLA Clocks**, and **Support & Engagement**.
6. Repeat every severity used by the provider, plus every service exception and
   an inside/outside-hours case.

The simulator is the preferred pre-production check because it resolves the
same policy layers without creating an incident or paging a responder. It does
not replace a controlled end-to-end event after configuration.

## How SLA selection and breaches work

At incident creation, OpsKnight classifies the signal, selects the service or
workspace priority rule (or base targets), and freezes the result. Both phases
breach only when elapsed SLA time is strictly greater than the target.

| Incident outcome | ACK result | Resolution result |
| --- | --- | --- |
| Acknowledged within target, resolved within target | Met | Met |
| Acknowledged after ACK target | Breached | Determined independently at resolution |
| Source recovers before ACK deadline | Not required | Determined by the resolution clock |
| Source recovers after ACK deadline without ACK | Breached | Determined by the resolution clock |
| Manually resolved without ACK | Breached | Determined by the resolution clock |
| Snoozed or suppressed | Clock is paused while the canonical pause is open | Lifetime deadline shifts by accumulated pause time |
| Reopened | First-ACK historical capture is preserved | Resolution continues from the original creation epoch, including pauses |

Unacknowledging or reopening does not erase first-ACK historical truth. Do not
recompute old compliance from the current policy.

## Verify the policy end to end

Use a controlled non-production service or approved test window:

1. Simulate all normalized severities and save the expected priority, urgency,
   target source, and support state.
2. Send one representative provider event and open the created incident.
3. Confirm service, severity-derived urgency, priority, policy source/version,
   ACK deadline, and resolution deadline match the simulation.
4. Acknowledge within the target and resolve within the target; confirm both
   results are met.
5. Test one approved late-ACK case and confirm only the correct phase breaches.
6. Test automatic recovery before ACK and verify ACK becomes not required.
7. Test a service override and a service inheriting workspace policy.
8. Test scheduled coverage inside and outside the staffed window, including LOW
   urgency deferral without assuming that its SLA clock paused.
9. Inspect incident timeline/audit evidence and dashboard/metrics projections.
10. Monitor scheduler health before declaring the rollout complete.

## Production rollout checklist

- Policy meanings and achievable targets are approved by service owners.
- Every provider severity is mapped and simulated.
- Priority and urgency are explained separately to responders.
- Workspace inheritance is the default; every service exception has an owner.
- Timezone, holidays, overnight windows, and DST boundaries are tested.
- At least one controlled end-to-end event matches the simulator.
- Dashboards and alerts monitor approaching breaches and scheduler health.
- Responders know that support hours do not pause SLA clocks.
- The previous values and policy version are recorded for rollback.

## Roll back or change

To roll back, save a new policy version using the previous values. There is no
safe way to rewrite the contract of incidents already created under the changed
version. Validate rollback with a newly created controlled incident. Remove a
service exception by restoring inheritance, and restore the previous scoped
classification/fallback selections explicitly.

Policy configuration is separate from the scheduler implementation mode. Do not
switch `LEGACY`, `SHADOW`, or `INDEXED` as a content rollback. Follow the
[scheduler migration runbook](./migrate-sla-scheduler) for that operational
change.

## Troubleshooting

- **Wrong priority:** inspect explicit payload priority, the matched scoped rule,
  priority mode, clear semantics, fallback mode, and captured provenance.
- **Wrong urgency:** inspect explicit urgency, scoped inheritance, severity
  normalization, the row's urgency mode, and the severity default.
- **P2 or P4 never appears:** urgency fallback only produces P1, P3, or P5; set
  P2/P4 explicitly for the appropriate severity or creation workflow.
- **Priority is empty although fallback is enabled:** a matching row set to
  **No automatic priority** explicitly blocks fallback.
- **Unexpected target:** compare captured priority, service inheritance/override,
  selected rule (`P1`–`P5` or `BASE`), policy source, and version.
- **A changed target did not update an incident:** expected; the incident contract
  is immutable. Create a controlled new incident to verify the new version.
- **LOW notification arrived later but SLA breached:** support hours can defer
  engagement and do not pause the clock.
- **Deadline moved:** inspect snooze/suppression pause history and accumulated
  paused duration; support-hour windows themselves are not pauses.
- **ACK breached after recovery:** recovery occurred strictly after the ACK
  target, or the incident was manually/otherwise resolved without ACK.
- **Simulator differs from a real event:** compare selected integration override,
  normalized provider severity, explicit payload fields, service, policy version,
  and creation time/support window.
- **Save reports a conflict:** another administrator saved a newer version.
  Reload, compare the new policy, and reapply only the intended changes.
- **Scheduled coverage is invalid:** verify an IANA timezone, non-overlapping
  recurring windows, valid exceptions, and a resolvable future staffed interval.
- **Transitions are late or missing:** inspect scheduler mode, due transitions,
  missing hints, logs, queue/job cadence, and SLA scheduler metrics; do not change
  target values to hide an operational scheduler fault.

## Next steps

- [Understand the incident SLA contract](../../concepts/incident-sla)
- [Create and verify an incident](./create)
- [Acknowledge an incident](./acknowledge)
- [Resolve an incident](./resolve)
- [Migrate the SLA scheduler](./migrate-sla-scheduler)
- [Monitor SLA and response-policy metrics](../../reference/metrics)
