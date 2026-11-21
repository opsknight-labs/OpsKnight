---
title: Use Analytics
description: Choose a range, filter and compare; read each metric correctly; understand which timezone each number uses; and export the page as CSV.
type: how-to
product_area: analytics
audience: [administrator, responder, operator]
verification:
  level: source
  verified_at: 2026-11-20
  evidence:
    - src/components/analytics/AnalyticsFilters.tsx
    - src/lib/analytics/definitions.ts
    - src/lib/analytics/params.ts
    - src/lib/analytics/window.ts
    - src/lib/analytics-export.ts
    - src/app/api/insights/export/route.ts
---

# Use Analytics

Open **Analytics** from the navigation. On a phone, the same page opens from
**More → Analytics**.

## Choose a range

Pick **24 hours**, **7 days**, **30 days** (default), **90 days**, **6 months**, **12 months**,
**2 years** or **3 years**, or **Custom** for a start and end day (up to 3 years).

- Preset ranges are rolling: "7 days" means the 7 × 24 hours ending now.
- Custom ranges are whole calendar days, midnight to midnight in your timezone, and include the end
  day you pick.
- Charts bucket by hour (up to 2 days), day (up to ~3 months), week (up to ~13 months) or month.
- If the range reaches past the incident retention period, it starts at the oldest retained day and
  the page shows a notice.
- Every incident is counted by when it was **created**. An incident that started before the range
  is not in it, even if it was resolved inside it — except **Open now**, which counts everything
  open right now.

## Filter

Filter by **Teams**, **Services**, **Urgency**, **Status**, **Priority** and **Assignee**
(including _Unassigned_). Teams, services and priorities accept several values. Filters apply to
every section and are kept in the URL, so you can bookmark or share a view; unknown or invalid
values in a link are ignored. Selecting a row in **Services** filters the whole page to that
service — the incident page's **Service analytics** link opens exactly that view.

**Clear filters** removes the filters but keeps the range and comparison.

## Compare to the previous period

Turn on **Compare to previous period** to show change against the period of the same length that
ends where the current one starts (the two never overlap). Each tile shows the change in percent,
coloured by whether it is an improvement for that metric; there is no percentage when the previous
value is missing or zero. The Services table adds the change in incident count per service.

## Timezones

- Charts, the **When incidents happen** heatmap and custom range days use **your** timezone
  (your profile setting, UTC if unset).
- **Responder load** bands use **each responder's** own timezone: working hours are Mon–Fri
  08:00–18:00, evening is 18:00–22:00 or weekend daytime, overnight is 22:00–08:00.
- The **After hours** KPI uses the **workspace business-hours timezone** set by an administrator in
  the retention settings (`businessHoursTimeZone`, UTC by default), so it means the same thing
  for every viewer.

## Metric definitions

These are the same definitions shown in each tile's info popover and used as the CSV headers.
A metric with no qualifying incidents shows **No data**, never 0.

| Metric                | Definition                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Incidents             | Incidents created in the selected period that match the filters.                                                                                   |
| Open now              | Incidents matching the filters that are open, acknowledged or snoozed right now, whenever they were created.                                       |
| MTTA (median)         | Median time from creation to first acknowledgement, excluding SLA pauses. Unacknowledged incidents are excluded.                                   |
| MTTA (p90)            | 90th percentile time to acknowledge: nine in ten incidents were acknowledged faster.                                                               |
| MTTR (median)         | Median time from creation to resolution, excluding SLA pauses. Only resolved incidents count.                                                      |
| MTTR (p90)            | 90th percentile time to resolve: nine in ten resolved incidents closed faster.                                                                     |
| Ack SLA met           | Share of incidents acknowledged within the SLA target frozen on the incident at creation. Incidents still inside their target are not counted yet. |
| Resolve SLA met       | Share of incidents resolved within the SLA target frozen on the incident at creation. Open incidents count once they pass their target.            |
| Escalated             | Share of incidents with at least one escalation to a further responder or level.                                                                   |
| After hours           | Share of incidents created outside business hours (Mon–Fri 08:00–18:00 in the workspace business-hours timezone).                                  |
| Alerts per incident   | Alerts grouped into each incident on average. High values point at noisy, duplicated signals.                                                      |
| Auto-resolved         | Share of resolved incidents closed by the source recovering, an automation or a timeout rather than a person.                                      |
| Postmortems published | Share of resolved high-urgency incidents that have a published postmortem.                                                                         |
| Open action items     | Postmortem action items not yet completed for incidents in the period.                                                                             |
| Overdue action items  | Open action items whose due date has passed.                                                                                                       |
| On-call hours         | Scheduled on-call time in the period, from schedule layers and overrides.                                                                          |

## Export CSV

**Export CSV** (top right, needs `REPORT_EXPORT`) downloads the current view — same range, filters
and access scope — as a UTF-8 CSV that opens cleanly in Excel. The file reads the same data as the
page, so its totals match what you see. It contains:

1. A header block: generation time, period start and end, your timezone, the business-hours
   timezone, the active filters and a note if retention shortened the range.
2. **Summary**: every key metric with the current and previous-period value and its definition.
3. **Services**, **Trend** (one row per chart bucket), **Responders**, **Noise** (with loudest
   services and recurring titles) and **Follow-through**.
4. **Incidents**: the incidents in the period, newest first, capped at 10,000 rows. When the cap is
   reached the section title says so — narrow the filters to export the rest.

Durations are in minutes and percentages are 0–100, so the columns sort and chart as numbers.
Text cells that start with `=`, `+`, `-` or `@` are prefixed with `'` so a spreadsheet never runs
them as formulas.

## Troubleshooting

- **"No data" on a tile:** nothing in the range qualifies (for example no resolved incidents for
  MTTR). Widen the range or clear filters.
- **Totals differ from the incident list:** Analytics counts incidents _created_ in the range; the
  incident list may filter by status or activity instead.
- **A section shows an error:** use the retry button on that section; other sections are unaffected.
- **Export returns 403:** ask an administrator for a role with `REPORT_EXPORT`.
