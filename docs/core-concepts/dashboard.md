---
order: 1
---

# Dashboard

The dashboard is the command center for real-time incident response. It surfaces what is happening now, who is on-call, and which services need attention.

## What You See

- **Active incidents** with severity and ownership
- **Service health** by status
- **On-call coverage** by schedule
- **Trends** for MTTA/MTTR and incident volume
- **Recent activity** across incidents and settings

## Key Widgets

### Active Incidents

Shows the current actionable backlog: Triggered (`OPEN`) plus Acknowledged incidents. Snoozed, Suppressed, and Resolved incidents are excluded.

Dashboard scopes are explicit:

- **Current** applies to Active, Muted, current urgency, and unassigned Active counts.
- The displayed range applies to Total, Resolved, trends, MTTA, MTTR, and other historical analysis.
- Retention can clip historical analysis but does not hide current Active incidents.

The **Muted** card shows the current non-actionable backlog: Snoozed plus Suppressed incidents. Its drill-down preserves both states so the displayed total always matches the incident list.

Each active incident includes:

- Severity badge
- Service name
- Time since trigger
- Current assignee

### Service Health

Quick view of all services:

- 🟢 Operational
- 🟡 Degraded
- 🔴 Major Outage

### On-Call Now

Current on-call responders for each schedule.

### Incident Trends

Charts for:

- Incident volume over time
- MTTA/MTTR trends
- Breakdown by severity

### Recent Activity

Timeline of key events:

- New incidents
- Acknowledgements
- Resolutions
- Notes and changes

## Quick Actions

- **Create Incident** for manual entries
- **View Incidents** to jump into triage
- **Check On-Call** for current ownership

## Best Practices

- Review the dashboard at shift start.
- Keep it open during active incidents.
- Use trend charts to identify recurring issues.
