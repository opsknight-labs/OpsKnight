---
title: Read and filter a dashboard
description: Apply report scope correctly and interpret dashboard metrics, charts, tables, and empty states.
type: how-to
product_area: analytics
audience: [responder, administrator, operator]
reader:
  status: READER_COMPLETE
  task: Filter and interpret an operational dashboard.
verification:
  level: source
  verified_at: 2026-10-01
  evidence: ["src/app/(app)/reports/executive/page.tsx", "src/app/(app)/reports/executive/[id]/page.tsx", "src/components/reports/DashboardGrid.tsx", "src/components/reports/widgets/ChartWidget.tsx", "src/lib/metric-contract.ts"]
---

# Read and filter a dashboard

## Before you begin

Confirm the reporting question, desired time window, and team or service scope. You need read access to the underlying operational records.

## Open the feature

Open **Reports & Dashboards**, then choose a saved dashboard or select a built-in template to preview it.

## Configure the reporting scope

At the top of a dashboard, set:

1. **Time range** for the reporting window.
2. **Team** to restrict calculations to a readable team.
3. **Service** to restrict calculations to a readable service. When a team is selected, the service list is narrowed to that team.

The filters are encoded in the URL. Switching between a saved dashboard and a template keeps the current filters. They are not persisted as the dashboard's default configuration.

## Read each widget family

- **Metric cards** show one aggregate for the selected scope. A comparison is meaningful only when both periods contain comparable data.
- **Gauges** show rates or compliance percentages. Read them with their denominator; a percentage over very few incidents is not a stable trend.
- **Trend charts** use buckets inside the selected time window. Incident count, MTTA/MTTR, and SLA compliance are different series and should not be treated as interchangeable.
- **Distribution charts** group incidents by urgency or status.
- **Incident Heatmap** is a calendar-style incident-volume view, not an hourly latency heatmap.
- **Tables** rank or break down services, assignees, on-call load, SLA results, and other scoped entities.
- **Smart Insights** summarizes notable patterns from the same authorized metrics.

Use the [metrics reference](../../reference/metrics) for the precise population, unit, labels, and aggregation caveats behind a metric.

## How dashboard calculation works

The server calculates metrics from records the current authorization actor can read, using the selected window, team, service, and user time zone. Widgets then render different views of that serialized metric set; a similar title does not make two widget definitions semantically identical.

## Empty and partial results

An empty chart is not automatically a runtime failure. It can mean no matching incidents exist in the selected window, the team/service combination has no matching records, the user cannot read those records, or the metric has no valid samples (for example, no resolved incidents for MTTR). Widen the time range, clear team/service filters, and compare with the incident list before escalating.

The **Updated** timestamp reports when the server rendered the current view. It is not a background refresh guarantee. Reload the page when you need a newly computed snapshot.

## Switch views safely

Use **Select dashboard** to switch among **My Dashboards**, accessible **Team & Shared** dashboards, and built-in **Templates**. Templates are previews until cloned. A saved dashboard name followed by `Team` or `Public` identifies its visibility; it does not imply edit ownership.

## Verify the interpretation

Record the time, team, and service filters with any reported value. Cross-check a count against the incident list for the same scope and confirm a rate's qualifying population in the metrics reference. Success means the scope survives a dashboard switch in the URL and the displayed values match the intended population.

## Undo filter changes

Set **Team** and **Service** back to **All**, restore the desired time range, or reopen the dashboard without query parameters. Because filters are not saved defaults, this does not alter the dashboard definition.

## Troubleshooting

If values are empty, contradictory, or stale, follow [Troubleshoot reports](./troubleshooting) and verify authorization, samples, scope, and refresh time.

## Next steps

- [Manage a saved dashboard](./manage-dashboard)
- [Metrics reference](../../reference/metrics)
