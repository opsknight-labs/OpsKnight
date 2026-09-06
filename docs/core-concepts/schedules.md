---
order: 5
---

# On-Call Schedules

Schedules define who is on-call and when. They are referenced by escalation policies.

## Create a Schedule

1. Go to **Schedules**
2. Click **+ New Schedule**
3. Configure the rotation and timezone

## Rotation Types

### Weekly

```
Week 1: Alice
Week 2: Bob
Week 3: Charlie
```

### Daily

```
Mon: Alice
Tue: Bob
Wed: Charlie
```

### Custom

Define start/end times for any rotation pattern.

## Schedule Layers

Layers allow complex coverage rules:

- Layer 1: Primary 24x7
- Layer 2: Business hours override
- Layer 3: Holiday coverage

Higher layers override lower layers.

## Overrides

Temporary changes for vacations or coverage swaps:

1. Open the schedule
2. Click the timeline
3. Select **Create Override**
4. Set the time window and assignee

## Timezone Behavior

Schedules are timezone-authoritative. All dates and times are interpreted in the schedule timezone, not the viewer's browser timezone.

## Best Practices

- Ensure 24x7 coverage for critical services.
- Use overrides for planned absences.
- Document handoff procedures.
- Align schedules with escalation policies.
