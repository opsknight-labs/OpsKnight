---
order: 4
title: Escalation Policies
description: Define who gets notified, when, and how incidents escalate
---

# Escalation Policies

Escalation policies are the rules that determine who gets notified when an incident occurs and how alerts escalate if no one responds. They're the backbone of reliable incident response.

![Escalation policies list](/escalation-policies.png)

---

## Why Escalation Policies Matter

| Without Policies         | With Policies                      |
| ------------------------ | ---------------------------------- |
| Alerts go to fixed users | Dynamic routing to on-call         |
| No escalation if ignored | Automatic escalation after timeout |
| Single point of failure  | Multi-tier redundancy              |
| Manual notification      | Automated multi-channel delivery   |

---

## Policy Structure

An escalation policy consists of:

1. **Name**: Unique identifier for the policy
2. **Description**: What this policy is for
3. **Steps**: Ordered list of escalation rules
4. **Services**: Which services use this policy

```
Payment API Escalation Policy
├── Step 1: Primary On-Call (Schedule) → wait 5 min
├── Step 2: Secondary On-Call (Schedule) → wait 10 min
├── Step 3: Platform Team Lead (User) → wait 10 min
└── Step 4: Entire Platform Team (Team) → repeat
```

---

## Escalation Steps

Each step in a policy defines:

| Field                     | Description                                | Required |
| ------------------------- | ------------------------------------------ | -------- |
| **Target Type**           | USER, TEAM, or SCHEDULE                    | Yes      |
| **Target**                | The specific user, team, or schedule       | Yes      |
| **Delay**                 | Minutes to wait before moving to next step | Yes      |
| **Notification Channels** | Override default channels (optional)       | No       |
| **Notify Team Lead Only** | For TEAM targets, only notify the lead     | No       |

### Step Order

Steps execute in order (0-indexed internally):

- **Step 1** executes immediately when incident triggers
- **Step 2** executes after Step 1's delay (if not acknowledged)
- And so on...

---

## Target Types

### USER

Notify a specific individual directly.

| Use Case              | Example                               |
| --------------------- | ------------------------------------- |
| Backup escalation     | Notify team lead after primary fails  |
| Subject matter expert | Notify database admin for DB issues   |
| Management escalation | Notify manager for critical incidents |

```
Target Type: USER
Target: jane.doe@company.com
Delay: 10 minutes
```

### TEAM

Notify team members who have team notifications enabled.

| Option             | Behavior                                     |
| ------------------ | -------------------------------------------- |
| **All Members**    | Every team member with notifications enabled |
| **Team Lead Only** | Only the designated team lead                |

```
Target Type: TEAM
Target: Platform Engineering
Notify Team Lead Only: false
Delay: 15 minutes
```

**Important**: Only members with `receiveTeamNotifications: true` are notified.

### SCHEDULE

Notify whoever is currently on-call in a schedule.

| Behavior                 | Description                           |
| ------------------------ | ------------------------------------- |
| **Real-time Resolution** | Determines on-call at escalation time |
| **Layer Support**        | Considers all schedule layers         |
| **Override Support**     | Respects active overrides             |

```
Target Type: SCHEDULE
Target: Primary On-Call Schedule
Delay: 5 minutes
```

This is the most common target type for initial escalation steps.

---

## Delay Configuration

The **delay** determines how long to wait before escalating to the next step:

| Delay           | Behavior                                           |
| --------------- | -------------------------------------------------- |
| **0 minutes**   | Execute immediately (no delay after previous step) |
| **5 minutes**   | Wait 5 minutes before escalating                   |
| **10+ minutes** | Standard escalation window                         |

### Timing Guidelines

| Step   | Recommended Delay | Rationale                    |
| ------ | ----------------- | ---------------------------- |
| Step 1 | 0 min             | Immediate notification       |
| Step 2 | 5-10 min          | Give primary time to respond |
| Step 3 | 10-15 min         | Backup escalation            |
| Final  | 15-30 min         | Management/team-wide         |

### What Stops Escalation

Escalation stops when:

- Incident is **acknowledged**
- Incident is **resolved**
- Incident is **snoozed**
- Incident is **suppressed**

---

## Notification Channel Overrides

By default, users receive notifications via their personal preferences. Steps can override this:

### Available Channels

| Channel      | Description         |
| ------------ | ------------------- |
| **EMAIL**    | Email notification  |
| **SMS**      | Text message        |
| **PUSH**     | Mobile/browser push |
| **SLACK**    | Slack message       |
| **WEBHOOK**  | Custom webhook      |
| **WHATSAPP** | WhatsApp message    |

### Per-Step Override

Configure specific channels for a step:

```
Step 2: Backup On-Call
├── Target: Secondary Schedule
├── Delay: 10 minutes
└── Channels: [SMS, PUSH]  ← Override
```

When channels are specified, only those channels are used (user preferences ignored for this step).

### When to Override

- **Critical escalations**: Force SMS + Push for urgent steps
- **Quiet hours**: Use only SMS for after-hours escalation
- **Slack-first**: Use only Slack for non-urgent teams

---

## Creating a Policy

### Step 1: Basic Info

1. Go to **Policies** in the sidebar
2. Click **Create Policy**
3. Enter:
   - **Name**: "Payment API Escalation"
   - **Description**: "Primary → Secondary → Team"

### Step 2: Add Steps

1. Click **Add Step**
2. Configure the step:
   - Select target type (USER, TEAM, SCHEDULE)
   - Choose the target
   - Set delay in minutes
   - Optionally override notification channels
3. Repeat for additional steps

<!-- placeholder:policy-step-form -->

![Escalation step configuration](/escalation-step.png)

### Step 3: Review & Save

1. Review the step order
2. Drag to reorder if needed
3. Click **Create Policy**

---

## Managing Steps

### Reordering Steps

Two methods to reorder:

1. **Drag and Drop**: Grab the handle and drag to new position
2. **Menu Actions**: Click **⋮** → Move Up / Move Down

> **Note**: When reordering, delay values are preserved (not recalculated).

### Editing Steps

1. Click the **Edit** button on a step
2. Modify target, delay, or channels
3. Save changes

### Deleting Steps

1. Click **⋮** → **Delete**
2. Confirm deletion
3. Remaining steps are automatically renumbered

---

## Assigning Policies to Services

Policies must be linked to services to take effect:

### Link via Service Settings

1. Open the service
2. Go to **Settings**
3. Select **Escalation Policy** from dropdown
4. Save

### Link via Policy Page

1. Open the policy
2. View **Services Using This Policy**
3. Click **Add Service**
4. Select services to link

---

## Repeat Behavior

The final step can be configured to repeat:

| Behavior   | Description                      |
| ---------- | -------------------------------- |
| **Stop**   | Escalation ends after final step |
| **Repeat** | Loop back to Step 1 and continue |

### Repeat Configuration

```
Step 1: Primary On-Call → wait 5 min
Step 2: Secondary On-Call → wait 10 min
Step 3: Team → wait 15 min → REPEAT
```

With repeat enabled:

- After Step 3 delay, escalation returns to Step 1
- Continues until acknowledged/resolved
- Ensures someone eventually responds

---

## How Escalation Executes

When an incident triggers:

```
Incident Created
       │
       ▼
┌──────────────────────┐
│ Find Service's       │
│ Escalation Policy    │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Execute Step 1       │
│ (delay = 0, immediate)│
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Resolve Target       │──► USER: Return user ID
│ (at current time)    │──► TEAM: Return member IDs
│                      │──► SCHEDULE: Return on-call IDs
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Send Notifications   │
│ (via configured      │
│  channels)           │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ Schedule Next Step   │
│ (wait delay minutes) │
└──────────┬───────────┘
           │
    [Not acknowledged]
           │
           ▼
┌──────────────────────┐
│ Execute Step 2...    │
└──────────────────────┘
```

### Schedule Resolution

When a step targets a SCHEDULE:

1. **Query schedule layers** at current time
2. **Apply layer priority** (higher layers override lower)
3. **Apply overrides** (temporary substitutions)
4. **Return all on-call users** from final result

This ensures the right person is notified even if schedules change.

---

## Example Policies

### Simple: Direct User

```
Policy: "CEO Direct Line"
└── Step 1: CEO (User) → no delay
```

### Standard: Primary/Secondary

```
Policy: "Standard Escalation"
├── Step 1: Primary On-Call (Schedule) → wait 5 min
├── Step 2: Secondary On-Call (Schedule) → wait 10 min
└── Step 3: Team Lead (User) → wait 15 min
```

### Complex: Multi-Tier

```
Policy: "Critical Infrastructure"
├── Step 1: Primary On-Call (Schedule) → wait 3 min
│   └── Channels: [SMS, PUSH]
├── Step 2: Secondary On-Call (Schedule) → wait 5 min
│   └── Channels: [SMS, PUSH, EMAIL]
├── Step 3: Platform Team Lead (Team Lead Only) → wait 10 min
├── Step 4: Entire Platform Team (Team) → wait 15 min
└── Step 5: VP Engineering (User) → repeat
```

### Follow-the-Sun

```
Policy: "Global Support"
├── Step 1: Regional On-Call (Schedule) → wait 10 min
│   (Schedule has timezone-based layers)
├── Step 2: Global Support Lead (User) → wait 15 min
└── Step 3: All Regions On-Call (Team) → wait 20 min
```

---

## Best Practices

### Step Design

- **Start with schedules** — First step should target on-call
- **Add redundancy** — Include backup escalation path
- **End with team** — Final step should be team-wide or management
- **Keep delays short** — 5-10 minutes between steps

### Channel Strategy

| Step    | Channels        | Rationale             |
| ------- | --------------- | --------------------- |
| Initial | User preference | Respect user settings |
| Backup  | SMS + Push      | Ensure delivery       |
| Final   | All channels    | Maximum reach         |

### Policy Organization

- **One policy per service tier** — Different SLAs need different escalation
- **Name clearly** — "Payment API - P1" vs "Payment API - P2"
- **Document the rationale** — Use description field

### Testing

1. Create a test incident for the service
2. Verify Step 1 notifications arrive
3. Let it escalate to verify timing
4. Acknowledge to confirm escalation stops

---

## Troubleshooting

### Notifications Not Sending

1. Verify policy is assigned to service
2. Check target user/team/schedule exists
3. Verify users have contact methods configured
4. Check notification channel is enabled for user

### Wrong Person Notified

1. Check schedule for correct on-call at incident time
2. Verify overrides are set correctly
3. Check team member notification preferences

### Escalation Not Progressing

1. Verify incident is not acknowledged/resolved
2. Check delays are configured correctly
3. Look at incident timeline for escalation events

---

## Related Topics

- [Schedules](./schedules) — On-call rotation configuration
- [Teams](./teams) — Team management
- [Services](./services) — Service configuration
- [Notifications](../administration/notifications) — Channel setup
- [Incidents](./incidents) — Incident lifecycle
