---
title: Create a dashboard
description: Create an operational dashboard from a blank canvas or a built-in template and verify its data.
type: how-to
product_area: analytics
audience: [responder, administrator, operator]
reader:
  status: READER_COMPLETE
  task: Create and verify a saved dashboard.
verification:
  level: source
  verified_at: 2026-10-01
  evidence: ["src/app/(app)/reports/page.tsx", "src/app/(app)/reports/executive/new/page.tsx", "src/app/(app)/reports/executive/DashboardViewer.tsx", "src/app/(app)/reports/executive/new/CreateBlankDashboardButton.tsx", "src/lib/reports/dashboard-templates.ts"]
---

# Create a dashboard

## Before you begin

Sign in and confirm you can read the teams, services, and incidents the dashboard should summarize. Dashboard metrics respect that authorization scope; creating a dashboard does not grant access to additional operational data.

## Open the feature

Open **Reports & Dashboards**, then select **Create Dashboard**.

## Configure the starting point

1. Open **Reports & Dashboards**.
2. Select **Create Dashboard**.
3. Choose one starting point:
   - **Blank Dashboard** creates an empty private dashboard for manual widget selection.
   - **Executive Summary** emphasizes incident volume, active work, MTTR, SLA compliance, trends, insights, and service health.
   - **SRE Operations** emphasizes active/unassigned incidents, coverage, escalations, response trends, urgency, calendar heatmap, on-call load, and noisy services.
   - **SLA Performance** emphasizes acknowledgment/resolution compliance and breaches.
   - **Team Performance** emphasizes team workload, response, resolution, and coverage.
   - **Minimal** provides a small general-purpose starting set.

Selecting a template opens a live preview. It does not create a saved dashboard yet.

![Populated SRE Operations template preview with operational metric cards and charts](/docs/v2.0.0/assets/dashboard-template.png)

## Create from a template

1. Review the preview with the default seven-day, all-team, all-service scope.
2. Change **Time range**, **Team**, or **Service** to verify the template answers the intended question.
3. Select **Clone Dashboard**.
4. Wait for navigation to the new saved dashboard.
5. Open the settings menu and select **Edit Dashboard**.
6. Replace the generated name and description with a purpose that states the audience and decision, for example `Payments weekly reliability review`.
7. Add, remove, or reorder widgets as described in [Manage a saved dashboard](./manage-dashboard).
8. Select **Save Changes**.

Success means the dashboard has a stable `/reports/executive/<id>` URL, appears under **My Dashboards**, and remains after a reload.

![Saved Production Reliability Overview dashboard populated with incident, SLA, trend, and service-health data](/docs/v2.0.0/assets/dashboard-saved.png)

## Create from scratch

1. On **Create New Dashboard**, select **Create Blank Dashboard**.
2. The newly created private dashboard opens with no widgets.
3. Select **Add Widget**.
4. Search or filter the widget library by **Metric Cards & Gauges**, **Charts & Graphs**, **Data Tables**, or **Special Widgets**.
5. Select each required widget once. A check mark means that widget definition is already present and cannot be added again.
6. Select **Done** in the library, arrange the widgets, set the dashboard name and description, and select **Save Changes**.

## Verify the result

Reload the page, then return to **Reports & Dashboards**. Confirm the card shows the expected name and widget count. Reopen it and verify the title, description, widget order, and widget set persisted. Change one filter and confirm the URL and displayed metrics update together.

If the dashboard is empty or a save fails, use [Troubleshoot reports](./troubleshooting).

## What OpsKnight does

OpsKnight creates a dashboard owned by the signed-in user and persists each widget's definition, metric, visual type, position, and configuration. Cloning copies a template into independent saved state; later template changes do not rewrite the clone.

## Delete or replace the dashboard

To undo creation, open the saved dashboard, select the gear menu, and choose **Delete Dashboard**. To restart without losing the original immediately, create and verify the replacement first, then delete the obsolete dashboard.

## Troubleshooting

- If cloning does not navigate to a saved URL, do not assume the dashboard exists; return to **Reports** and check **My Dashboards**.
- If a template is empty, clear filters and widen the time range.
- If saving is denied, confirm you own the saved dashboard.

## Next steps

- [Read and filter the dashboard](./read-dashboard)
- [Manage widgets and layout](./manage-dashboard)
