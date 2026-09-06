---
order: 4
---

# Escalation Policies

Escalation policies define who gets notified and how incidents escalate when there is no response.

## Policy Structure

Each policy contains steps with a target and delay.

Example:

```
Step 1: Primary On-Call Schedule  -> wait 5 min
Step 2: Secondary Schedule        -> wait 10 min
Step 3: Team Lead (User)          -> wait 15 min
Step 4: Manager                   -> repeat
```

## Target Types

| Target   | Description                |
| -------- | -------------------------- |
| User     | Notify a specific person   |
| Team     | Notify all team members    |
| Schedule | Notify the current on-call |

## Create a Policy

1. Go to **Escalation Policies**
2. Click **+ New Policy**
3. Add steps
4. Save

## Repeat Behavior

If no one acknowledges:

- **Repeat**: start over at Step 1
- **Stop**: end escalation chain

## Assign to Services

1. Open the service
2. Go to **Settings**
3. Select the escalation policy
4. Save

## Best Practices

- Keep initial delays short (5–10 minutes).
- Always include a fallback step.
- Test policies with non-critical incidents.
- Align policy timing to your SLAs.
