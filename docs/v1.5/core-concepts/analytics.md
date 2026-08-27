---
title: Analytics and SLA
description: Interpret incident, response, coverage, and SLA metrics and export the filtered data
order: 15
---

# Analytics and SLA

**Analytics & Insights** combines incident activity, response performance, SLA compliance, on-call coverage, service health, and workload for operational review. Use it to answer a specific question with explicit filters—not as a source of unexplained headline numbers.

## Access and permissions

Authenticated users can view Analytics. The CSV export requires a responder or administrator role because it can contain detailed incident and assignee data.

All timestamps are displayed in the signed-in user's profile time zone. The after-hours calculation uses the installation's configured business-hours time zone, which can differ from the viewer's time zone.

## Set the analysis scope

The Analytics URL supports these filters:

| Filter   | Values                                                                  |
| -------- | ----------------------------------------------------------------------- |
| Window   | 1, 3, 7, 14, 30, 60, 90, 180, or 365 days                               |
| Team     | One team or all teams                                                   |
| Service  | One service or all services; selecting a team narrows this list         |
| Assignee | One user or all users                                                   |
| Status   | Triggered (`OPEN`), Acknowledged, Snoozed, Suppressed, Resolved, or all |
| Urgency  | High, Medium, Low, or all                                               |

The default window is seven days. Active filter chips below the filter bar show the current scope.

When a requested window extends beyond incident retention, OpsKnight clips the query and displays a retention notice with the effective dates. Never compare a clipped period with an unclipped period without noting the difference.

## Metric definitions

| Metric                 | Meaning                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| Total incidents        | Incidents created in the effective filtered period                                          |
| Active incidents       | Current Triggered (`OPEN`) or Acknowledged work; no historical date cutoff                  |
| Unassigned active      | Active incidents with no user assignee                                                      |
| MTTA                   | Mean time from incident creation to `acknowledgedAt`, for incidents with an acknowledgement |
| MTTR                   | Mean time from incident creation to `resolvedAt`, for resolved incidents                    |
| MTBF                   | Mean time between failures: total operating time divided by failure count in window         |
| Acknowledgement rate   | Share of the relevant incident set with an acknowledgement                                  |
| Resolution rate        | Share of the relevant incident set that is resolved                                         |
| Acknowledge compliance | Incidents acknowledged at or before the service's acknowledge target                        |
| Resolve compliance     | Incidents resolved at or before the service's resolve target                                |
| Escalation rate        | Share of incidents with a recorded escalation event                                         |
| Reopen rate            | Share of incidents with a recorded reopen event                                             |
| Auto-resolve rate      | Share of resolved incidents classified as automatically resolved                            |
| Alerts per incident    | Stored inbound alerts divided by incidents in scope                                         |
| After-hours rate       | Share created outside Monday–Friday 08:00–18:00 in the configured business-hours time zone  |
| Coverage               | Scheduled on-call coverage calculated for the window                                        |

### Metric scope contract

- **Current** metrics describe the actionable backlog now. Active, unassigned active, and current urgency counts use only `OPEN` + `ACKNOWLEDGED` and are not cut off by historical retention.
- **Selected-period** metrics describe incidents created inside the effective filtered window. Total, resolved, status/urgency mix, MTTA, MTTR, SLA compliance, rates, trends, and heatmaps use this scope.
- **Muted** means `SNOOZED` + `SUPPRESSED`; muted incidents never count as Active or make a service unhealthy.
- **Triggered** is the user-facing name for the strict database state `OPEN`. It is not a synonym for Active.
- Incident drill-downs preserve the applicable team, service, assignee, urgency, status, and effective creation-date scope.

Service defaults are 15 minutes to acknowledge and 120 minutes to resolve unless the service has different targets. SLA calculations use service targets; urgency alone does not define the target.

When no qualifying sample exists, a time or compliance metric can display `--`/null. That is different from zero.

## What the page shows

The page groups data into operational sections that can include:

- incident totals, active work, MTTA, MTTR, and MTBF with previous-period comparisons;
- acknowledge/resolve compliance and breach counts;
- incident trend series;
- status and urgency distributions;
- top services and per-service health/SLA tables;
- assignee and on-call load;
- schedule coverage, gaps, on-call hours, users, and active overrides;
- recurring incident titles and event density;
- escalation, reopen, and auto/manual resolution activity;
- incident heatmap and status age;
- generated positive or negative insights when a rule has enough data;
- golden-signal values when the required telemetry exists.

Generated insights are prompts for investigation, not root-cause conclusions.

## Previous-period comparisons

Cards can compare the selected period with the immediately preceding period of equal length. A percentage delta is omitted when the previous value is missing or zero. An upward arrow is not universally good: higher incident volume, MTTA, or MTTR usually needs investigation.

## Export CSV

1. Set the window, team, service, assignee, status, and urgency filters.
2. Select **Export**.
3. Store the CSV according to your organization's incident-data policy.
4. Confirm the report header contains the expected filter values and effective dates.

The export contains a report header, applied filters, KPIs, status distribution, top services, and up to 10,000 matching incidents. It is CSV only. PDF, JSON, scheduled email reports, and a published analytics REST API are not v1.4 features.

### CSV Formula Injection Protections (CWE-1236)

To protect spreadsheet users against Formula Injection, OpsKnight automatically sanitizes cell values beginning with formula trigger characters (`=`, `+`, `-`, `@`, `\t`, `\r`, `|`, `%`) by prepending a single quote (`'`). Exports are encoded in UTF-8 with a Byte Order Mark (`\uFEFF`) for compatibility with Microsoft Excel and Apple Numbers.

Because the export includes incident titles and assignee information, do not attach it to public tickets or status pages without review.

## Reports & Dashboards

For user-owned layouts and role-specific templates, open **Reports & Dashboards** in the main navigation. It supports Executive Summary, SRE Operations, SLA Performance, Team Performance, and Minimal templates. See [Reports and Dashboards](./reports-dashboards) for its visibility and persistence limitations.

## Interpret metrics safely

- Compare like-for-like time windows and filters.
- Check retention clipping before interpreting a trend.
- Treat averages together with sample counts and percentiles where shown.
- Acknowledge that manual status changes affect lifecycle metrics.
- Investigate missing timestamps before treating a null value as success.
- Use service-specific targets when explaining SLA results.
- Pair workload metrics with schedules and team context; incident counts alone do not measure individual performance.
- Do not use analytics as a blame leaderboard.

## Troubleshooting

| Problem                                  | Check                                                                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Metrics are empty                        | Confirm incidents exist in the selected effective window and clear restrictive filters.                           |
| A service is missing                     | Clear the team filter or confirm the service belongs to the selected team.                                        |
| MTTA/MTTR is `--`                        | The filtered sample has no qualifying acknowledged/resolved timestamps.                                           |
| Values differ from an older report       | Compare effective dates, filters, user/business time zones, retention clipping, and product version.              |
| Export returns 403                       | CSV export requires a responder or administrator.                                                                 |
| Export has fewer than expected incidents | Check filters and retention; detailed rows are capped at 10,000.                                                  |
| Old data changed after an upgrade        | Historical rollups can be recalculated/backfilled; ask an administrator to check rollup health and release notes. |

## Related guides

- [Reports and Dashboards](./reports-dashboards)
- [Incidents](./incidents)
- [Services](./services)
- [Schedules](./schedules)
- [Data Retention](../administration/data-retention)
- [Postmortems](./postmortems)
