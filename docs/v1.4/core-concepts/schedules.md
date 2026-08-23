---
title: On-call schedules
description: Build timezone-aware rotations, layered coverage, and temporary overrides for escalation.
order: 5
---

# On-call schedules

A schedule answers “who is on call now?” for an escalation-policy step. Each schedule has an IANA timezone, one or more ordered layers, responders in rotation order, and optional temporary overrides.

## Permissions

Signed-in users can view schedules they are allowed to see. Application **Responders** and **Admins** can create and edit schedules, layers, participants, and overrides.

## Scheduling model

| Element         | Purpose                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Schedule        | Named timezone boundary referenced by escalation policies.                                                                    |
| Layer           | A repeating rotation with start/end bounds, participants, restrictions, and priority.                                         |
| Rotation length | Hours before responsibility moves to the next participant. Must be greater than zero.                                         |
| Shift length    | Optional active portion within a rotation slot. It cannot exceed rotation length; a shorter value intentionally creates gaps. |
| Restriction     | Optional days of week and start/end hours when a layer can apply.                                                             |
| Override        | Temporary assignment, optionally replacing a particular user for an exact time range.                                         |

Layers are evaluated by priority. Higher-priority layers override lower ones in the final effective schedule. The calendar can also show all raw layers simultaneously, so distinguish the layer view from final coverage.

## Create a schedule

1. Open **Schedules** and select **Create Schedule**.
2. Enter a unique name.
3. Select the schedule timezone.
4. Open the new schedule and add its first layer.

All layer dates, restrictions, overrides, calendars, and handoff displays use the schedule timezone. Changing it changes how existing instants are displayed; review coverage around the change, especially near daylight-saving transitions.

## Add a rotation layer

1. Select **Add layer**.
2. Enter the layer name and start time; optionally add an end time.
3. Enter a positive rotation length in hours.
4. Optionally set a shift length to create an active portion shorter than the rotation slot.
5. Optionally restrict days of week and start/end hours.
6. Save, add responders, and put them in the intended rotation order.

The end time must be after the start. Hours use `0` through `23`; week-day values are interpreted in the schedule timezone. Use an unrestricted baseline layer for continuous coverage, then add higher-priority restricted layers for business hours or special coverage.

### Rotation examples

- Daily handoff: rotation length `24`, no shorter shift length.
- Weekly handoff: rotation length `168`.
- Twelve-hour rotation: rotation length `12`.
- Business-hours-only slot: set a restriction and confirm final coverage is supplied by another layer outside it.

These values are examples, not presets. Preview the result rather than assuming a duration produces the intended local handoff through daylight-saving changes.

## Manage participants

Add active users to a layer and order them in the sequence they should rotate. Moving a participant changes future rotation order. Removing the only participant leaves the layer without coverage.

The schedule health panel flags missing layers, empty or single-person layers, ended or soon-ending layers, and uncovered days in its preview window. Treat warnings as prompts for manual verification, not as proof that every escalation path works.

## Create an override

Use an override for leave, a one-time swap, or exceptional coverage:

1. Select **Add override**.
2. Choose the replacement user.
3. Optionally choose the user being replaced.
4. Set start and end in the schedule timezone.
5. Save and verify the timeline and calendar.

The end must be after the start. OpsKnight notifies the affected replacement and replaced user through in-app schedule notifications. Remove an override when it is no longer valid; past overrides remain visible in history according to application retention.

## Connect a schedule to escalation

1. Open or create an [escalation policy](escalation-policies.md).
2. Add a step with target type **Schedule**.
3. Select this schedule and the desired channels.
4. Save the policy and attach it to a service.
5. Trigger a test incident during a known slot.

At execution time OpsKnight resolves the effective current user from the schedule. An empty layer, intentional shift gap, expired layer, invalid override, or disabled user can leave the step without a usable target.

## Verify coverage

Before using a schedule for production:

- [ ] Confirm the timezone and expected daylight-saving behavior.
- [ ] Inspect the timeline, final coverage, and monthly calendar.
- [ ] Check at least the next 90 days, including weekends and holidays.
- [ ] Resolve every health warning or document the intentional gap.
- [ ] Confirm each responder is active and has working notification channels.
- [ ] Test a policy during a normal slot and an override.
- [ ] Verify the next handoff time and next responder.
- [ ] Confirm an operational owner reviews upcoming override and layer end dates.

## Troubleshooting

### No one is on call

Check that a layer has started and not ended, contains an active participant, applies on the current day/hour, and has no gap caused by a shorter shift length. Then inspect higher-priority layers and overrides.

### The wrong responder is selected

Verify participant order, rotation start, rotation length, schedule timezone, layer priority, restrictions, and active overrides. Do not calculate from browser timezone.

### Handoff is an hour early or late

Confirm the IANA timezone and inspect the date for a daylight-saving transition. Avoid treating a fixed UTC offset as a timezone.

### An override has no effect

Confirm its schedule, start/end range, replacement user, optional replaced user, and overlap with the effective layer. Reload the timeline after saving.

## Related topics

- [Escalation policies](escalation-policies.md)
- [Users](users.md)
- [Teams](teams.md)
- [Incidents](incidents.md)
- [Troubleshooting](../troubleshooting.md)
