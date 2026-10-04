---
title: Reports and dashboards
description: Build, filter, interpret, share, and maintain operational dashboards in OpsKnight.
type: concept
product_area: analytics
audience: [responder, administrator, operator]
reader:
  status: READER_COMPLETE
verification:
  level: source
  verified_at: 2026-10-01
  evidence: ["src/app/(app)/reports/page.tsx", "src/app/(app)/reports/executive/DashboardViewer.tsx", "src/app/api/dashboards/route.ts", "src/app/api/dashboards/[id]/route.ts"]
---

# Reports and dashboards

Use **Reports & Dashboards** to turn incident, response, SLA, service, team, and on-call data into a reusable operational view. A dashboard is not a static export: its widgets recalculate from the selected time, team, and service filters whenever you open it.

## Choose the task

- [Create a dashboard](./create-dashboard) — start blank or clone one of the five built-in templates.
- [Read and filter a dashboard](./read-dashboard) — understand scope, empty states, charts, tables, and SLA values.
- [Manage a saved dashboard](./manage-dashboard) — configure widgets, save, share, export, present, and control visibility.
- [Troubleshoot reports](./troubleshooting) — diagnose missing dashboards, empty widgets, denied access, and failed saves.

For metric definitions and aggregation rules, use the [metrics reference](../../reference/metrics). For the underlying measurement model, read [Analytics](../../concepts/analytics).

## Access model

The **Reports** landing page lists dashboards owned by the signed-in user. Inside the dashboard selector, OpsKnight can also show team-visible dashboards for the user's teams and public dashboards. A private dashboard is available only to its owner. Opening an inaccessible or nonexistent dashboard returns the not-found view rather than revealing its metadata.

## Live, share, and presentation controls

Use **Live** to refresh a dashboard manually or every 30 seconds, 1 minute, or
5 minutes. **Presentation Mode** provides a fullscreen NOC/TV view with a live
clock and enables a 60-second refresh when refresh was previously off.

**Export PDF** opens the browser's print/PDF layout. **Share** copies a URL that
retains the current time, team, and service filters. For a saved dashboard, its
owner can also change visibility to **Private**, **Team**, or **Organization
(Public)** in the Share dialog. A link never bypasses the selected visibility or
the viewer's normal access controls.

Dashboard filters are URL state, not saved dashboard defaults. Auto-refresh and
presentation mode are viewer-session controls, not persisted dashboard settings.
