---
title: Use the Command Center
order: 2
description: Scope, interpret, verify, and export the operational information on the OpsKnight home dashboard.
type: how-to
product_area: analytics
audience: [responder, administrator]
reader: { status: READER_COMPLETE, task: Use the Command Center to assess operational state and select the next incident-response action. }
verification:
  level: source
  verified_at: 2026-10-02
  evidence:
    - src/app/(app)/page.tsx
    - src/components/dashboard/DashboardCommandCenter.tsx
    - src/components/dashboard/widgets/SLABreachAlertsWidget.tsx
    - src/components/dashboard/OnCallWidget.tsx
    - src/components/DashboardExport.tsx
---

# Use the Command Center

## Before you begin

Sign in and confirm that your team membership and incident permissions are
current. Counts are authorization-scoped: two users can legitimately see
different results. Choose a known incident and service if you need to validate
the dashboard against source records.

## Open the feature

Select **Dashboard** in the main navigation or open `/`. Read the system-status
indicator first, then confirm the displayed time range and active filters before
interpreting any number.

## Configure the view

1. Select the required preset or custom time range.
2. Narrow the population by service, assignee, urgency, or text search when the
   controls are available to your role.
3. Clear filters before treating a number as workspace-wide.
4. Follow a metric card or queue item into its incident list and preserve the
   resulting query parameters when sharing the view.

The headline cards distinguish incidents in the selected range from current
state. Active combines triggered and acknowledged incidents; muted state can
include snoozed and suppressed incidents. Resolved is measured for the selected
window. Unassigned identifies incidents without an assignee.

## How the Command Center works

- **System status** summarizes the current operational condition.
- **Ops Pulse** groups the most immediate responder signals.
- **My Queue** prioritizes incidents assigned to the signed-in responder.
- **Critical Focus** surfaces high-impact work requiring attention.
- **Services at Risk** groups services affected by active incident pressure.
- **Smart Insights** provides computed observations; validate an insight against
  the underlying incidents before using it in a decision or report.
- **On-call context** shows current coverage based on schedules visible to you.
- **SLA Alerts** shows approaching or breached acknowledgement/resolution targets
  and links the responder to the affected work.

Realtime updates can refresh current incident metrics after incident events.
When population filters are active, the client requests filtered metrics so a
live workspace-wide count does not silently replace the scoped count. The view
also exposes an “as of”/data-state context where the metric contract supplies
one. Retention can clip historical ranges; a clipped result is not a complete
all-time record.

## Verify the result

1. Open a headline count and compare the returned incident list with its label,
   selected range, and filters.
2. Change one controlled test incident and confirm the current-state card updates
   after the realtime event or a manual refresh.
3. Compare **My Queue** with the same assignee filter on the Incidents page.
4. Open an SLA warning and verify the incident deadline and state.
5. If your role permits export, export the selected view and confirm its scope
   matches the visible filters rather than assuming it is workspace-wide.

## Change or undo the view

Filters and ranges change the view, not incident records. Clear each filter or
return to the default range to restore the baseline. An incident action reached
through a dashboard link is a separate mutation and must be reversed, where the
incident workflow permits, from the incident itself.

## Troubleshooting

- **A count differs from another user's count:** compare roles, team membership,
  service access, filters, range, timezone, and retention clipping.
- **A count looks stale:** wait for the live update, use refresh, then verify the
  source incident. A degraded live channel must not be treated as proof that no
  incident changed.
- **A panel is empty:** clear filters and confirm relevant seeded or production
  records exist and are visible to the user.
- **Export is unavailable:** the current role or visibility scope may not allow
  export. Ask an administrator to review permissions; do not broaden access only
  to obtain a report.
- **An SLA number is unexpected:** compare the incident's immutable selected SLA
  targets and lifecycle timestamps with the current policy; later policy changes
  do not rewrite an existing incident's contract.

## Next steps

- [Respond to an incident](../incidents/README)
- [Use Analytics](../analytics/use-analytics)
- [Read a saved dashboard](../reports/read-dashboard)
- [Understand permissions](../../reference/permissions)

