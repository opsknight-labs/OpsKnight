---
title: Reports and Dashboards
description: Build role-focused operational dashboards from OpsKnight metrics
order: 16
---

# Reports and Dashboards

**Reports & Dashboards** provides reusable, role-focused views of OpsKnight's incident and SLA metrics. It is separate from the main [Command Center](./dashboard): the Command Center is the shared operational landing page, while report dashboards are user-owned metric layouts.

## Start from a template

OpsKnight v1.4 includes five dashboard templates:

| Template          | Intended use                                           |
| ----------------- | ------------------------------------------------------ |
| Executive Summary | High-level operational health for leadership           |
| SRE Operations    | Active work, coverage, escalation, trends, and load    |
| SLA Performance   | Acknowledge/resolve compliance and breach analysis     |
| Team Performance  | Workload, coverage, response performance, and insights |
| Minimal           | A small starting layout                                |

1. Open **Reports & Dashboards**.
2. Select a template to preview it.
3. Set the time window, team, and service filters.
4. Select **Clone Dashboard** to create a user-owned copy.

## Create a dashboard

1. Open **Reports & Dashboards → Create Dashboard**.
2. Start with a blank dashboard or preview a template.
3. A blank dashboard is created as **My Dashboard** and can be populated from the widget library.
4. In edit mode, add, remove, and rearrange widgets.

Dashboard records support Private, Team, and Public visibility. A team dashboard is available to members of its selected team; a public dashboard is readable by authenticated users. Only the owner can edit or delete a dashboard.

## Filter the data

Available time windows are 24 hours, 3, 7, 14, 30, 60, and 90 days. You can also filter by team and service. When a team is selected, the service list is narrowed to services owned by that team.

Filters change the metric query for the current view. Confirm the filter bar before comparing two screenshots or exporting numbers elsewhere.

## Widgets

The widget library groups metric cards, gauges, charts, tables, and insight panels. Templates use metrics such as total and active incidents, unassigned incidents, MTTA, MTTR, SLA compliance, escalation and resolution rates, urgency/status mix, coverage, on-call load, service health, assignee load, heatmaps, and generated insights.

Metric definitions and limitations live in [Analytics](./analytics). A widget does not create a second definition of a metric.

## Important v1.4 limitations

- **Export as PDF** and **Share Dashboard** are visible but disabled in the current UI.
- Template previews are not saved until cloned.
- The edit toolbar can change the current browser view, but do not rely on layout edits being durable unless a reload confirms they were saved by your build. The dashboard API supports updating owned dashboards, while the current v1.4 viewer does not persist every edit-mode change.
- The Reports landing page lists the signed-in user's dashboards. Team/public visibility is enforced by the dashboard API, but discoverability can differ by view.

## Delete a dashboard

Open a dashboard you own, open its settings menu, and choose **Delete Dashboard**. Confirm carefully: deletion removes the dashboard and its widgets and cannot be undone. System templates cannot be deleted.

## Troubleshooting

| Problem                                    | Check                                                                                        |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| A widget is empty                          | Confirm the time, team, and service filters include incidents with the required fields.      |
| A service disappears after choosing a team | Only services owned by that team remain in the service filter.                               |
| You cannot edit/delete a dashboard         | Only its owner can edit or delete it.                                                        |
| Layout changes disappear after reload      | See the v1.4 persistence limitation above; verify changes before relying on the layout.      |
| PDF/share is unavailable                   | Those menu items are disabled in v1.4. Use the supported analytics export where appropriate. |

## Related guides

- [Command Center](./dashboard)
- [Analytics and SLA](./analytics)
- [Services](./services)
- [Teams](./teams)
